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
  { path: 'Sent', name: 'Sent', delimiter: '/', flags: new Set(['\\Sent']), specialUse: '\\Sent', pathAsListed: 'Sent', parent: '', parentPath: '', listed: true, subscribed: true },
] as const;

function makeEnvelope(subject: string, fromAddr: string) {
  return {
    subject,
    from: [{ name: '', address: fromAddr }],
    to: [{ name: '', address: 'me@yandex.com' }],
    date: new Date('2026-10-15T10:00:00Z'),
  };
}

function makeRow(uid: number, subject: string, fromAddr: string): FetchMessageObject {
  return {
    seq: uid,
    uid,
    envelope: makeEnvelope(subject, fromAddr),
    internalDate: new Date('2026-10-15T10:00:00Z'),
    flags: new Set(['\\Seen']),
    size: 1234,
  } as unknown as FetchMessageObject;
}

function makeFactory(opts: {
  uids?: number[];
  rows?: FetchMessageObject[];
}): ImapClientFactory {
  const uids = opts.uids ?? [];
  const rows = opts.rows ?? [];
  return () => ({
    connect: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockResolvedValue(FOLDERS),
    mailboxOpen: vi.fn().mockResolvedValue({ path: 'INBOX' }),
    search: vi.fn().mockResolvedValue(uids),
    fetchAll: vi.fn().mockResolvedValue(rows),
    logout: vi.fn().mockResolvedValue(undefined),
  });
}

describe('YandexMailProvider.search', () => {
  it('возвращает метаданные найденных писем', async () => {
    const factory = makeFactory({
      uids: [1, 2],
      rows: [makeRow(1, 'Отчёт за октябрь', 'boss@example.com'), makeRow(2, 'Отчёт Q3', 'a@b.com')],
    });
    const p = new YandexMailProvider({ account, clientFactory: factory });
    await p.connect();
    const res = await p.search({ subject: 'отчёт' });
    expect(res.total).toBe(2);
    expect(res.messages).toHaveLength(2);
    expect(res.messages[0]?.subject).toBe('Отчёт за октябрь');
    expect(res.messages[0]?.uid).toBe(1);
    expect(res.messages[0]?.folder).toBe('INBOX');
    // без body
    expect(res.messages[0]).not.toHaveProperty('body');
  });

  it('пустой результат', async () => {
    const factory = makeFactory({ uids: [], rows: [] });
    const p = new YandexMailProvider({ account, clientFactory: factory });
    await p.connect();
    const res = await p.search({ subject: 'несуществующая тема' });
    expect(res.total).toBe(0);
    expect(res.messages).toEqual([]);
    expect(res.hasMore).toBe(false);
  });

  it('limit и hasMore', async () => {
    const factory = makeFactory({
      uids: Array.from({ length: 100 }, (_, i) => i + 1),
      rows: Array.from({ length: 50 }, (_, i) => makeRow(i + 1, 'тема', 'a@b.com')),
    });
    const p = new YandexMailProvider({ account, clientFactory: factory });
    await p.connect();
    const res = await p.search({ limit: 50 });
    expect(res.total).toBe(100);
    expect(res.messages).toHaveLength(50);
    expect(res.hasMore).toBe(true);
  });

  it('direction=incoming открывает \\Inbox', async () => {
    const factory = makeFactory({ uids: [], rows: [] });
    const p = new YandexMailProvider({ account, clientFactory: factory });
    await p.connect();
    await p.search({ direction: 'incoming' });
    const client = (p as unknown as { client: { mailboxOpen: ReturnType<typeof vi.fn> } }).client;
    expect(client.mailboxOpen).toHaveBeenCalledWith('INBOX', { readOnly: true });
  });

  it('direction=outgoing открывает \\Sent', async () => {
    const factory = makeFactory({ uids: [], rows: [] });
    const p = new YandexMailProvider({ account, clientFactory: factory });
    await p.connect();
    await p.search({ direction: 'outgoing' });
    const client = (p as unknown as { client: { mailboxOpen: ReturnType<typeof vi.fn> } }).client;
    expect(client.mailboxOpen).toHaveBeenCalledWith('Sent', { readOnly: true });
  });

  it('явная папка приоритетнее direction', async () => {
    const factory = makeFactory({ uids: [], rows: [] });
    const p = new YandexMailProvider({ account, clientFactory: factory });
    await p.connect();
    await p.search({ direction: 'incoming', folder: 'Archive' });
    const client = (p as unknown as { client: { mailboxOpen: ReturnType<typeof vi.fn> } }).client;
    expect(client.mailboxOpen).toHaveBeenCalledWith('Archive', { readOnly: true });
  });

  it('флаг unseen передаётся в search (seen=false)', async () => {
    const factory = makeFactory({ uids: [], rows: [] });
    const p = new YandexMailProvider({ account, clientFactory: factory });
    await p.connect();
    await p.search({ unseen: true });
    const client = (p as unknown as { client: { search: ReturnType<typeof vi.fn> } }).client;
    expect(client.search).toHaveBeenCalledWith(expect.objectContaining({ seen: false }), { uid: true });
  });

  it('ошибка поиска не раскрывает пароль', async () => {
    const factory: ImapClientFactory = () => ({
      connect: vi.fn().mockResolvedValue(undefined),
      list: vi.fn().mockResolvedValue(FOLDERS),
      mailboxOpen: vi.fn().mockResolvedValue({ path: 'INBOX' }),
      search: vi.fn().mockRejectedValue(new Error(`search failed with pass=${account.password}`)),
      fetchAll: vi.fn().mockResolvedValue([]),
      logout: vi.fn().mockResolvedValue(undefined),
    });
    const p = new YandexMailProvider({ account, clientFactory: factory });
    await p.connect();
    await expect(p.search({ subject: 'x' })).rejects.toThrow();
    try {
      await p.search({ subject: 'x' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      expect(msg).not.toContain(account.password);
    }
  });

  it('поиск без подключения бросает', async () => {
    const factory = makeFactory({ uids: [], rows: [] });
    const p = new YandexMailProvider({ account, clientFactory: factory });
    // не вызываем connect
    await expect(p.search({ subject: 'x' })).rejects.toThrow(/подключение не установлено/);
  });
});