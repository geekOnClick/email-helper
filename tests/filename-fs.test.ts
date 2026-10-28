import { describe, it, expect } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  sanitizeFilename,
  uniqueFilename,
  isInsideDir,
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