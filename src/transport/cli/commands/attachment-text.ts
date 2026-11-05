/**
 * Утилита извлечения текста из вложений для /analyze-attachments
 * (change cli-smart-commands, design D3).
 *
 * Поддерживаемые форматы:
 * - Текстовые (txt/csv/json/html/htm/eml) — чтение как UTF-8 (HTML — stripping тегов).
 * - PDF — `pdf-parse` (класс `PDFParse`).
 * - DOC/DOCX — `word-extractor` (legacy OLE .doc и OOXML .docx).
 * - XLS/XLSX — `xlsx` (чтение листов в CSV-текст).
 * - PPTX — `jszip` (распаковка слайдов, извлечение текста из `<a:t>`).
 *
 * Изображения и прочие бинарные форматы — `{ skipped: true, reason }` (анализатор
 * их не получает; команда выводит пометку). Не используется мультимодальный
 * vision — вне scope (design D3).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

/** Результат извлечения: либо текст, либо пропуск с причиной. */
export type AttachmentTextResult =
  | { filename: string; text: string; skipped: false }
  | { filename: string; skipped: true; reason: string };

/** Расширения текстовых форматов, читаемых как UTF-8. */
const TEXT_EXTENSIONS = new Set(['.txt', '.csv', '.json', '.html', '.htm', '.eml', '.log', '.md']);

/** Расширения изображений (пропускаются — нет vision). */
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg', '.tiff']);

/** Извлекает расширение файла в нижнем регистре. */
function extOf(filePath: string): string {
  return path.extname(filePath).toLowerCase();
}

/** Удаляет HTML-теги и схлопывает пробелы (упрощённый stripping). */
function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Извлекает текст из файла вложения.
 *
 * Возвращает `{ filename, text }` для поддерживаемых форматов или
 * `{ filename, skipped: true, reason }` для изображений/бинарных/неизвестных.
 * При ошибке извлечения (битый файл и т.п.) — `{ skipped: true, reason }` с
 * описанием ошибки, не роняя команду.
 */
export async function extractAttachmentText(filePath: string): Promise<AttachmentTextResult> {
  const filename = path.basename(filePath);
  const ext = extOf(filePath);

  // Текстовые форматы — UTF-8.
  if (TEXT_EXTENSIONS.has(ext)) {
    try {
      let text = fs.readFileSync(filePath, 'utf-8');
      if (ext === '.html' || ext === '.htm') {
        text = stripHtml(text);
      }
      return { filename, text, skipped: false as const };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      return { filename, skipped: true as const, reason: `ошибка чтения: ${reason}` };
    }
  }

  // Изображения — пропуск (нет vision).
  if (IMAGE_EXTENSIONS.has(ext)) {
    return { filename, skipped: true as const, reason: 'неподдерживаемый формат (изображение)' };
  }

  // PDF — pdf-parse.
  if (ext === '.pdf') {
    try {
      const { PDFParse } = await import('pdf-parse');
      const data = fs.readFileSync(filePath);
      const parser = new PDFParse({ data: new Uint8Array(data) });
      try {
        const result = await parser.getText();
        return { filename, text: result.text ?? '', skipped: false as const };
      } finally {
        await parser.destroy();
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      return { filename, skipped: true as const, reason: `ошибка PDF: ${reason}` };
    }
  }

  // DOC/DOCX — word-extractor (legacy OLE .doc и OOXML .docx).
  if (ext === '.doc' || ext === '.docx') {
    try {
      const WordExtractor = (await import('word-extractor')).default;
      const extractor = new WordExtractor();
      const doc = await extractor.extract(filePath);
      const text = doc.getBody();
      return { filename, text: text ?? '', skipped: false as const };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      return { filename, skipped: true as const, reason: `ошибка DOC/DOCX: ${reason}` };
    }
  }

  // XLS/XLSX — xlsx (BIFF8 .xls и OOXML .xlsx).
  if (ext === '.xls' || ext === '.xlsx') {
    try {
      // xlsx — CommonJS-пакет: при `await import('xlsx')` в ESM-контексте Node
      // кладёт API на `.default`, а на самом namespace остаются только часть
      // методов. Берём `.default` с fallback на сам namespace для совместимости.
      const imported = await import('xlsx');
      const XLSX = (imported as unknown as { default?: typeof imported }).default ?? imported;
      const wb = XLSX.readFile(filePath);
      const sheets: string[] = [];
      for (const name of wb.SheetNames) {
        const ws = wb.Sheets[name];
        if (!ws) continue;
        const csv = XLSX.utils.sheet_to_csv(ws);
        sheets.push(`=== Лист: ${name} ===\n${csv}`);
      }
      return { filename, text: sheets.join('\n\n'), skipped: false as const };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      return { filename, skipped: true as const, reason: `ошибка XLS/XLSX: ${reason}` };
    }
  }

  // PPTX — jszip (распаковка слайдов, извлечение текста из <a:t>).
  if (ext === '.pptx') {
    try {
      const JSZip = (await import('jszip')).default;
      const data = fs.readFileSync(filePath);
      const zip = await JSZip.loadAsync(data);
      // Слайды: ppt/slides/slideN.xml. Сортируем по номеру слайда.
      const slideNames = Object.keys(zip.files)
        .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
        .sort((a, b) => {
          const na = Number(/slide(\d+)/.exec(a)?.[1] ?? 0);
          const nb = Number(/slide(\d+)/.exec(b)?.[1] ?? 0);
          return na - nb;
        });
      const slides: string[] = [];
      for (const name of slideNames) {
        const entry = zip.files[name];
        if (!entry) continue;
        const xml = await entry.async('string');
        // Текстовые фрагменты в DrawingML — внутри <a:t>...</a:t>.
        const texts = [...xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((m) => m[1]);
        const slideLabel = name.split('/').pop()?.replace('.xml', '') ?? name;
        slides.push(`=== ${slideLabel} ===\n${texts.join('\n')}`);
      }
      return { filename, text: slides.join('\n\n'), skipped: false as const };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      return { filename, skipped: true as const, reason: `ошибка PPTX: ${reason}` };
    }
  }

  // Прочее — бинарный/неизвестный формат.
  return { filename, skipped: true as const, reason: 'неподдерживаемый формат' };
}
