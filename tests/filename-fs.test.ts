import { describe, it, expect } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  sanitizeFilename,
  uniqueFilename,
  isInsideDir,
  ensureExtension,
} from '../src/tools/mail/filename.js';
import { ensureDir } from '../src/tools/mail/fs.js';

describe('sanitizeFilename', () => {
  it('убирает path-компоненты (../etc/passwd → passwd)', () => {
    expect(sanitizeFilename('../../etc/passwd')).toBe('passwd');
  });

  it('убирает обратные слеши', () => {
    expect(sanitizeFilename('..\\..\\windows\\system32')).toBe('windowssystem32');
  });

  it('пустое/только точки → дефолт', () => {
    expect(sanitizeFilename('')).toBe('attachment');
    expect(sanitizeFilename('...')).toBe('attachment');
  });

  it('сохраняет нормальное имя', () => {
    expect(sanitizeFilename('report.pdf')).toBe('report.pdf');
  });

  it('обрезает слишком длинное имя, сохраняя расширение', () => {
    const long = 'a'.repeat(300) + '.pdf';
    const out = sanitizeFilename(long);
    expect(Buffer.byteLength(out, 'utf8')).toBeLessThanOrEqual(200);
    expect(out.endsWith('.pdf')).toBe(true);
  });

  it('сохраняет легитимную двойную точку в имени (регресс xls-бага)', () => {
    // отправитель (Автозаводская ТЭЦ) присылает имя с двойной точкой перед расширением;
    // жадный replace(/\.\./g,'') вырезал обе точки → терялось расширение
    expect(sanitizeFilename('Акт-1292-2-30-2608 период-Август 2026 г..xls'))
      .toBe('Акт-1292-2-30-2608 период-Август 2026 г..xls');
  });

  it('сохраняет несколько двойных точек в середине имени', () => {
    expect(sanitizeFilename('версия..1..2.pdf')).toBe('версия..1..2.pdf');
  });

  it('path-сегмент .. между разделителями вырезается, двойная точка в имени остается', () => {
    // `a/../b.xls` — basename даёт `b.xls`, но проверяем что path-component `..` вырезан,
    // а легитимная двойная точка `..xls` сохранена
    expect(sanitizeFilename('a/../b..xls')).toBe('b..xls');
  });
});

describe('uniqueFilename', () => {
  let dir: string;

  it('возвращает имя без суффикса если файла нет', async () => {
    dir = await mkdtemp(join(tmpdir(), 'fn-'));
    const name = await uniqueFilename(dir, 'report.pdf');
    expect(name).toBe('report.pdf');
    await rm(dir, { recursive: true, force: true });
  });

  it('коллизия → суффикс -1', async () => {
    dir = await mkdtemp(join(tmpdir(), 'fn-'));
    await writeFile(join(dir, 'report.pdf'), 'x');
    const name = await uniqueFilename(dir, 'report.pdf');
    expect(name).toBe('report-1.pdf');
    await rm(dir, { recursive: true, force: true });
  });

  it('множественная коллизия → -1, -2', async () => {
    dir = await mkdtemp(join(tmpdir(), 'fn-'));
    await writeFile(join(dir, 'report.pdf'), 'x');
    await writeFile(join(dir, 'report-1.pdf'), 'x');
    const name = await uniqueFilename(dir, 'report.pdf');
    expect(name).toBe('report-2.pdf');
    await rm(dir, { recursive: true, force: true });
  });

  it('обеззараживает имя с path traversal', async () => {
    dir = await mkdtemp(join(tmpdir(), 'fn-'));
    const name = await uniqueFilename(dir, '../../etc/passwd');
    expect(name).toBe('passwd');
    expect(isInsideDir(join(dir, name), dir)).toBe(true);
    await rm(dir, { recursive: true, force: true });
  });
});

describe('isInsideDir', () => {
  it('true для пути внутри', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'fn-'));
    expect(isInsideDir(join(dir, 'a.txt'), dir)).toBe(true);
    await rm(dir, { recursive: true, force: true });
  });

  it('false для пути с выходом наружу', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'fn-'));
    expect(isInsideDir(join(dir, '..', 'evil.txt'), dir)).toBe(false);
    await rm(dir, { recursive: true, force: true });
  });
});

describe('ensureDir', () => {
  it('создаёт вложенный каталог', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'fs-'));
    const target = join(dir, 'a', 'b', 'c');
    await ensureDir(target);
    // повторно — идемпотентно
    await ensureDir(target);
    expect(true).toBe(true); // без ошибок
    await rm(dir, { recursive: true, force: true });
  });
});

describe('ensureExtension', () => {
  it('вставляет точку перед слипшимся расширением xls', () => {
    expect(ensureExtension('СчетНаПредоплату1-1292-2-30-2610 период-Ноябрь 2026 гxls', 'application/vnd.ms-excel'))
      .toBe('СчетНаПредоплату1-1292-2-30-2610 период-Ноябрь 2026 г.xls');
  });

  it('не меняет имя с корректным расширением (pdf)', () => {
    expect(ensureExtension('report.pdf', 'application/pdf')).toBe('report.pdf');
  });

  it('добавляет расширение из content-type, если в имени его нет', () => {
    expect(ensureExtension('документ', 'application/pdf')).toBe('документ.pdf');
  });

  it('не выдумывает расширение для неизвестного content-type', () => {
    expect(ensureExtension('данные', 'application/octet-stream')).toBe('данные');
  });

  it('не выдумывает расширение при отсутствии content-type', () => {
    expect(ensureExtension('документ', undefined)).toBe('документ');
  });

  it('D2.2 приоритет над D2.3: Счетxls + application/vnd.ms-excel → Счет.xls (без второго .xls)', () => {
    expect(ensureExtension('Счетxls', 'application/vnd.ms-excel')).toBe('Счет.xls');
  });

  it('распознаёт слипшееся xlsx раньше xls (сортировка по длине)', () => {
    expect(ensureExtension('отчётxlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'))
      .toBe('отчёт.xlsx');
  });

  it('распознаёт слипшееся docx раньше doc', () => {
    expect(ensureExtension('актdocx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'))
      .toBe('акт.docx');
  });

  it('не трогает имя, уже заканчивающееся точкой+расширение, даже при слипшемся content-type', () => {
    // report.pdf уже корректно — content-type не добавляет второй .pdf
    expect(ensureExtension('report.pdf', 'application/pdf')).toBe('report.pdf');
  });

  it('не трогает имя с расширением, не совпадающим с content-type', () => {
    // имя с корректным расширением .txt — не меняется, даже если content-type другой
    expect(ensureExtension('notes.txt', 'application/pdf')).toBe('notes.txt');
  });

  it('пустое имя → пустое имя', () => {
    expect(ensureExtension('', 'application/pdf')).toBe('');
  });

  it('path-traversal имя проходит как есть (sanitizeFilename сработает позже)', () => {
    // ensureExtension не распознаёт расширение → возвращает как есть;
    // последующий sanitizeFilename уберёт `..`
    expect(ensureExtension('../etc/passwd', 'application/octet-stream')).toBe('../etc/passwd');
  });
});