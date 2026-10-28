import { describe, it, expect, vi } from 'vitest';
import { YandexMailProvider } from '../src/tools/mail/providers/yandex.js';
import type { ImapClientFactory } from '../src/tools/mail/providers/abstract-imap-provider.js';
import type { MailAccount } from '../src/tools/mail/types.js';
import type { FetchMessageObject } from 'imapflow';

const account: MailAccount = {
  provider: 'yandex',
  login: 'agentemailtest@yandex.com',
  password: 'super-secret',
  authStrategy: 'basic',
};

const FOLDERS = [
  { path: 'INBOX', name: 'INBOX', delimiter: '/', flags: new Set(['\\Inbox']), specialUse: '\\Inbox', pathAsListed: 'INBOX', parent: '', parentPath: '', listed: true, subscribed: true },
] as const;

/** Минимальное rfc822-письмо с text/plain. */
function rfc822Plain(body = 'Привет, мир.'): Buffer {
  return Buffer.from(
    `From: boss@example.com\r\nTo: me@yandex.com\r\nSubject: Отчёт\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${body}`,
    'utf8',
  );
}

/** rfc822 с text/html (без text/plain). */
function rfc822Html(): Buffer {
  return Buffer.from(
    `From: boss@example.com\r\nTo: me@yandex.com\r\nSubject: Отчёт\r\nContent-Type: text/html; charset=utf-8\r\n\r\n<h1>Привет</h1>`,
    'utf8',
  );
}

function makeRow(opts: { uid: number; source?: Buffer; bodyStructure?: unknown }): FetchMessageObject {
  return {
    seq: opts.uid,
    uid: opts.uid,
    source: opts.source,
    bodyStructure: opts.bodyStructure as never,
    envelope: { subject: 'Отчёт', from: [{ name: '', address: 'boss@example.com' }], to: [{ name: '', address: 'me@yandex.com' }], date: new Date('2026-10-15T10:00:00Z') },
    internalDate: new Date('2026-10-15T10:00:00Z'),
    flags: new Set(['\\Seen']),
    size: 1234,
  } as unknown as FetchMessageObject;
}

function makeFactory(opts: { rows?: FetchMessageObject[] }): ImapClientFactory {
  const rows = opts.rows ?? [];
  return () => ({
    connect: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockResolvedValue(FOLDERS),
    mailboxOpen: vi.fn().mockResolvedValue({ path: 'INBOX' }),
    search: vi.fn().mockResolvedValue([]),
    fetchAll: vi.fn().mockResolvedValue(rows),
    download: vi.fn(),
    downloadMany: vi.fn().mockResolvedValue({}),
    logout: vi.fn().mockResolvedValue(undefined),
  });
}

describe('YandexMailProvider.fetch', () => {
  it('возвращает тело text/plain (UTF-8)', async () => {
    const factory = makeFactory({ rows: [makeRow({ uid: 5, source: rfc822Plain('Привет, мир.') })] });
    const p = new YandexMailProvider({ account, clientFactory: factory });
    await p.connect();
    const full = await p.fetch(5);
    expect(full.uid).toBe(5);
    expect(full.body).toBe('Привет, мир.');
    expect(full.hasBody).toBe(true);
    expect(full.subject).toBe('Отчёт');
    expect(full.from?.address).toBe('boss@example.com');
  });

  it('только text/html → body из html', async () => {
    const factory = makeFactory({ rows: [makeRow({ uid: 6, source: rfc822Html() })] });
    const p = new YandexMailProvider({ account, clientFactory: factory });
    await p.connect();
    const full = await p.fetch(6);
    expect(full.body.toLowerCase()).toContain('привет');
    expect(full.hasBody).toBe(true);
  });

  it('нет source → пустое тело, hasBody=false', async () => {
    const factory = makeFactory({ rows: [makeRow({ uid: 7 })] });
    const p = new YandexMailProvider({ account, clientFactory: factory });
    await p.connect();
    const full = await p.fetch(7);
    expect(full.body).toBe('');
    expect(full.hasBody).toBe(false);
  });

  it('метаданные вложений из bodyStructure', async () => {
    const bodyStructure = {
      type: 'multipart/mixed',
      childNodes: [
        { part: '1', type: 'text/plain', childNodes: [] },
        { part: '2', type: 'application/pdf', disposition: 'attachment', dispositionParameters: { filename: 'report.pdf' }, size: 999, childNodes: [] },
      ],
    };
    const factory = makeFactory({ rows: [makeRow({ uid: 8, source: rfc822Plain(), bodyStructure })] });
    const p = new YandexMailProvider({ account, clientFactory: factory });
    await p.connect();
    const full = await p.fetch(8);
    expect(full.attachments).toHaveLength(1);
    expect(full.attachments[0]?.filename).toBe('report.pdf');
    expect(full.attachments[0]?.part).toBe('2');
  });

  it('ошибка не раскрывает пароль', async () => {
    const factory: ImapClientFactory = () => ({
      connect: vi.fn().mockResolvedValue(undefined),
      list: vi.fn().mockResolvedValue(FOLDERS),
      mailboxOpen: vi.fn().mockResolvedValue({ path: 'INBOX' }),
      search: vi.fn().mockResolvedValue([]),
      fetchAll: vi.fn().mockRejectedValue(new Error(`fetch failed pass=${account.password}`)),
      download: vi.fn(),
      downloadMany: vi.fn().mockResolvedValue({}),
      logout: vi.fn().mockResolvedValue(undefined),
    });
    const p = new YandexMailProvider({ account, clientFactory: factory });
    await p.connect();
    try {
      await p.fetch(1);
      expect.fail('должен бросить');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      expect(msg).not.toContain(account.password);
    }
  });

  it('без сессии — ошибка', async () => {
    const factory = makeFactory({ rows: [] });
    const p = new YandexMailProvider({ account, clientFactory: factory });
    await expect(p.fetch(1)).rejects.toThrow(/подключение не установлено/);
  });
});