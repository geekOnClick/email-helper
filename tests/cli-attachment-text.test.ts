import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extractAttachmentText } from '../src/transport/cli/commands/attachment-text.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'attachment-text-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('extractAttachmentText', () => {
  it('txt — чтение UTF-8', async () => {
    const p = join(dir, 'note.txt');
    await writeFile(p, 'Текст заметки про договор.', 'utf8');
    const r = await extractAttachmentText(p);
    expect(r.skipped).toBe(false);
    if (!r.skipped) {
      expect(r.text).toContain('договор');
    }
  });

  it('csv — чтение UTF-8', async () => {
    const p = join(dir, 'data.csv');
    await writeFile(p, 'name,value\nalpha,1\n', 'utf8');
    const r = await extractAttachmentText(p);
    expect(r.skipped).toBe(false);
    if (!r.skipped) {
      expect(r.text).toContain('alpha');
    }
  });

  it('html — stripping тегов', async () => {
    const p = join(dir, 'page.html');
    await writeFile(p, '<html><body><p>Привет <b>мир</b></p></body></html>', 'utf8');
    const r = await extractAttachmentText(p);
    expect(r.skipped).toBe(false);
    if (!r.skipped) {
      expect(r.text).toContain('Привет');
      expect(r.text).toContain('мир');
      expect(r.text).not.toContain('<');
    }
  });

  it('изображение (png) — пропуск с пометкой', async () => {
    const p = join(dir, 'photo.png');
    await writeFile(p, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const r = await extractAttachmentText(p);
    expect(r.skipped).toBe(true);
    if (r.skipped) {
      expect(r.reason).toContain('изображение');
    }
  });

  it('бинарный/неизвестный формат (zip) — пропуск', async () => {
    const p = join(dir, 'archive.zip');
    await writeFile(p, Buffer.from([0x50, 0x4b, 0x03, 0x04]));
    const r = await extractAttachmentText(p);
    expect(r.skipped).toBe(true);
    if (r.skipped) {
      expect(r.reason).toContain('неподдерживаемый формат');
    }
  });

  it('xlsx — извлечение текста листа', async () => {
    // Создаём валидный xlsx через саму библиотеку.
    const XLSX = await import('xlsx');
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([['name', 'value'], ['alpha', '1']]);
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    const p = join(dir, 'data.xlsx');
    XLSX.writeFile(wb, p);
    const r = await extractAttachmentText(p);
    expect(r.skipped).toBe(false);
    if (!r.skipped) {
      expect(r.text).toContain('alpha');
      expect(r.text).toContain('Sheet1');
    }
  });

  it('xls (legacy BIFF8) — извлечение текста листа через xlsx', async () => {
    // SheetJS умеет читать старый .xls (BIFF8). Создаём .xls через writeFile с bookType.
    const XLSX = await import('xlsx');
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([['товар', 'цена'], ['книга', '250']]);
    XLSX.utils.book_append_sheet(wb, ws, 'Лист1');
    const p = join(dir, 'data.xls');
    XLSX.writeFile(wb, p, { bookType: 'biff8' });
    const r = await extractAttachmentText(p);
    expect(r.skipped).toBe(false);
    if (!r.skipped) {
      expect(r.text).toContain('книга');
      expect(r.text).toContain('Лист1');
    }
  });

  it('docx — извлечение текста через word-extractor', async () => {
    // Создаём минимальный валидный docx (OOXML) через jszip.
    const JSZip = (await import('jszip')).default;
    const zip = new JSZip();
    zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
    zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
    zip.file('word/document.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Договор поставки оборудования</w:t></w:r></w:p></w:body></w:document>');
    const buf = await zip.generateAsync({ type: 'nodebuffer' });
    const p = join(dir, 'doc.docx');
    const { writeFile } = await import('node:fs/promises');
    await writeFile(p, buf);
    const r = await extractAttachmentText(p);
    expect(r.skipped).toBe(false);
    if (!r.skipped) {
      expect(r.text).toContain('Договор поставки');
    }
  });

  it('pptx — извлечение текста слайдов через jszip', async () => {
    // Создаём минимальный валидный pptx (OOXML) через jszip.
    const JSZip = (await import('jszip')).default;
    const zip = new JSZip();
    zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/></Types>');
    zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/></Relationships>');
    zip.file('ppt/presentation.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst></p:presentation>');
    zip.file('ppt/_rels/presentation.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>');
    zip.file('ppt/slides/slide1.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>Презентация проекта квартал</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>');
    const buf = await zip.generateAsync({ type: 'nodebuffer' });
    const p = join(dir, 'slides.pptx');
    const { writeFile } = await import('node:fs/promises');
    await writeFile(p, buf);
    const r = await extractAttachmentText(p);
    expect(r.skipped).toBe(false);
    if (!r.skipped) {
      expect(r.text).toContain('Презентация проекта квартал');
      expect(r.text).toContain('slide1');
    }
  });

  it('pptx без слайдов — пустой текст без падения', async () => {
    // PPTX-контейнер без ppt/slides/* — корректный, но пустой результат.
    const JSZip = (await import('jszip')).default;
    const zip = new JSZip();
    zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>');
    const buf = await zip.generateAsync({ type: 'nodebuffer' });
    const p = join(dir, 'empty.pptx');
    const { writeFile } = await import('node:fs/promises');
    await writeFile(p, buf);
    const r = await extractAttachmentText(p);
    expect(r.skipped).toBe(false);
    if (!r.skipped) {
      expect(r.text).toBe('');
    }
  });
});

describe('xlsx ESM/CJS interop — readFile доступен после нормализации', () => {
  /**
   * xlsx — CommonJS-пакет. При `await import('xlsx')` в реальном ESM-рантайме
   * (node, не vitest) Node кладёт API на `.default`, а на namespace остаются
   * только часть методов: `readFile` отсутствует на верхнем уровне
   * (`XLSX.readFile is not a function`), но есть в `XLSX.default.readFile`.
   * Раньше это ронило `/analyze-attachments` на реальном .xlsx. Код нормализует
   * через `imported.default ?? imported`. Тест фиксирует контракт: после
   * нормализации `readFile` обязан быть функцией (независимо от interop-режима
   * тест-раннера).
   */
  it('после нормализации .default ?? namespace readFile — функция', async () => {
    const imported = await import('xlsx');
    const XLSX = (imported as unknown as { default?: typeof imported }).default ?? imported;
    expect(typeof XLSX.readFile).toBe('function');
    expect(typeof XLSX.utils.sheet_to_csv).toBe('function');
  });

  it('чтение реального .xlsx через extractAttachmentText не падает на readFile (регресс)', async () => {
    // Воспроизводит баг «XLSX.readFile is not a function»: создаём .xlsx и
    // читаем его через extractAttachmentText. Без нормализации .default это
    // падало в реальном node-рантайме (vitest-interop мог маскировать баг).
    const XLSX = (await import('xlsx')).default ?? (await import('xlsx'));
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([['регресс', 'проверка'], ['да', 'ок']]);
    XLSX.utils.book_append_sheet(wb, ws, 'S1');
    const p = join(dir, 'regression.xlsx');
    XLSX.writeFile(wb, p);
    const r = await extractAttachmentText(p);
    expect(r.skipped).toBe(false);
    if (!r.skipped) {
      expect(r.text).toContain('регресс');
      // Не должно быть ошибки «readFile is not a function» в reason.
      expect(r.text).not.toContain('readFile is not a function');
    }
  });
});
