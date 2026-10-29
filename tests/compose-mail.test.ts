import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { validateComposeMail } from '../src/tools/mail/compose-mail.js';
import type { ComposeMailInput } from '../src/types/email.js';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function buildMail(over: Partial<ComposeMailInput> = {}): ComposeMailInput {
  return {
    to: [{ address: 'to@example.com' }],
    subject: 'Тема',
    text: 'Тело',
    ...over,
  };
}

describe('validateComposeMail', () => {
  it('валидный минимум (1 TO, subject, text) → valid', async () => {
    const r = await validateComposeMail(buildMail());
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it('нет получателей → invalid', async () => {
    const r = await validateComposeMail(buildMail({ to: [], cc: [], bcc: [] }));
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes('хотя бы один получатель'))).toBe(true);
  });

  it('кривой адрес → invalid с указанием адреса', async () => {
    const r = await validateComposeMail(buildMail({ to: [{ address: 'not-an-email' }] }));
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes('некорректный адрес TO'))).toBe(true);
    expect(r.errors.some((e) => e.includes('not-an-email'))).toBe(true);
  });

  it('пустая тема → invalid', async () => {
    const r = await validateComposeMail(buildMail({ subject: '   ' }));
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes('тема'))).toBe(true);
  });

  it('пустое тело → invalid', async () => {
    const r = await validateComposeMail(buildMail({ text: '' }));
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes('текстовое тело'))).toBe(true);
  });

  it('несуществующий путь вложения → invalid', async () => {
    const r = await validateComposeMail(
      buildMail({ attachments: [{ path: '/no/such/file-12345.pdf' }] }),
    );
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes('вложение не найдено'))).toBe(true);
  });

  it('CC/BCC валидные → valid', async () => {
    const r = await validateComposeMail(
      buildMail({
        to: [{ address: 'a@example.com' }],
        cc: [{ name: 'Боб', address: 'bob@example.com' }],
        bcc: [{ address: 'bcc@example.com' }],
      }),
    );
    expect(r.valid).toBe(true);
  });

  it('несколько ошибок собираются вместе', async () => {
    const r = await validateComposeMail(
      buildMail({ to: [], subject: '', text: '', attachments: [{ path: '/no/such/x' }] }),
    );
    expect(r.valid).toBe(false);
    expect(r.errors.length).toBeGreaterThanOrEqual(4);
  });
});

describe('validateComposeMail — вложения (fs)', () => {
  let dir: string;
  let realFile: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'compose-mail-'));
    realFile = join(dir, 'doc.pdf');
    await writeFile(realFile, 'content');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('существующий файл-вложение → valid', async () => {
    const r = await validateComposeMail(buildMail({ attachments: [{ path: realFile }] }));
    expect(r.valid).toBe(true);
  });

  it('путь-директория вместо файла → invalid', async () => {
    const r = await validateComposeMail(buildMail({ attachments: [{ path: dir }] }));
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes('не является файлом'))).toBe(true);
  });
});
