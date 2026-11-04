/**
 * Утилита извлечения текста из вложений для /analyze-attachments
 * (change cli-smart-commands, design D3).
 *
 * Поддерживаемые форматы:
 * - Текстовые (txt/csv/json/html/htm/eml) — чтение как UTF-8 (HTML — stripping тегов).
 * - PDF — `pdf-parse` (класс `PDFParse`).
 * - DOCX — `mammoth.extractRawText`.
 * - XLSX — `xlsx` (чтение листов в CSV-текст).
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

  // DOCX — mammoth.
  if (ext === '.docx') {
    try {
      const mammoth = await import('mammoth');
      const result = await mammoth.extractRawText({ path: filePath });
      return { filename, text: result.value, skipped: false as const };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      return { filename, skipped: true as const, reason: `ошибка DOCX: ${reason}` };
    }
  }

  // XLSX — xlsx.
  if (ext === '.xlsx') {
    try {
      const XLSX = await import('xlsx');
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
      return { filename, skipped: true as const, reason: `ошибка XLSX: ${reason}` };
    }
  }

  // Прочее — бинарный/неизвестный формат.
  return { filename, skipped: true as const, reason: 'неподдерживаемый формат' };
}
