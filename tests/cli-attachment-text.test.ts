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
});
