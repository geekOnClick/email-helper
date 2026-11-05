import { describe, it, expect, vi, beforeEach } from 'vitest';
import { YandexMailProvider } from '../src/tools/mail/providers/yandex.js';
import type { ImapClientFactory } from '../src/tools/mail/providers/abstract-imap-provider.js';
import type { MailAccount } from '../src/tools/mail/types.js';

const account: MailAccount = {
  provider: 'yandex',
  login: 'test@yandex.com',
  password: 'secret',
  authStrategy: 'basic',
};

const INBOX = {
  path: 'INBOX',
  pathAsListed: 'INBOX',
  name: 'INBOX',
  delimiter: '/',
  parent: '',
  parentPath: '',
  flags: new Set(['\\Inbox']),
  specialUse: '\\Inbox',
  listed: true,
  subscribed: true,
  status: undefined,
};

interface StubClient {
  connect: ReturnType<typeof vi.fn>;
  list: ReturnType<typeof vi.fn>;
  mailboxOpen: ReturnType<typeof vi.fn>;
  search: ReturnType<typeof vi.fn>;
  fetchAll: ReturnType<typeof vi.fn>;
  downloadMany: ReturnType<typeof vi.fn>;
  logout: ReturnType<typeof vi.fn>;
}

/** Фабрика, отдающая ссылку на stub-клиент для инспекции вызовов в тестах. */
function makeFactory(stub: Partial<StubClient> = {}): {
  factory: ImapClientFactory;
  client: StubClient;
} {
  const client: StubClient = {
    connect: stub.connect ?? vi.fn().mockResolvedValue(undefined),
    list: stub.list ?? vi.fn().mockResolvedValue([INBOX]),
    mailboxOpen: stub.mailboxOpen ?? vi.fn().mockResolvedValue(undefined),
    search: stub.search ?? vi.fn().mockResolvedValue([]),
    fetchAll: stub.fetchAll ?? vi.fn().mockResolvedValue([]),
    downloadMany: stub.downloadMany ?? vi.fn().mockResolvedValue({}),
    logout: stub.logout ?? vi.fn().mockResolvedValue(undefined),
  };
  const factory: ImapClientFactory = () => client as never;
  return { factory, client };
}

describe('AbstractImapProvider: timeout + retry (mail-search-robustness)', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  // === isConnectionError (косвенно через поведение retry) ===

  it('не-connection ошибка (письмо не найдено) — без retry', async () => {
    const { factory, client } = makeFactory({
      search: vi.fn().mockResolvedValue([5]),
      fetchAll: vi.fn().mockResolvedValue([]), // письмо не найдено
    });
    const p = new YandexMailProvider({ account, clientFactory: factory });
    await p.connect();
    await expect(p.fetch(5, 'INBOX')).rejects.toThrow(/не найдено/);
    expect(client.logout).not.toHaveBeenCalled();
  });

  it('«подключение не установлено» — connection-ошибка, retry с reconnect (mail-connection-self-healing D4)', async () => {
    const { factory, client } = makeFactory();
    const p = new YandexMailProvider({ account, clientFactory: factory });
    // не вызываем connect — requireClient() бросит «подключение не установлено».
    // Теперь это connection-ошибка → retry тратит попытку на reconnect (tryConnect)
    // и повторяет; при успехе reconnect возвращает результат.
    const folders = await p.listFolders({ maxRetries: 1, timeoutMs: 5000 });
    expect(folders.length).toBeGreaterThan(0);
    // reconnect вызвал connect фабрики.
    expect(client.connect).toHaveBeenCalled();
  });

  // === таймаут ===

  it('таймаут search → ConnectError о таймауте, без зависания', async () => {
    const { factory } = makeFactory({
      search: vi.fn().mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve([]), 5000)),
      ),
    });
    const p = new YandexMailProvider({ account, clientFactory: factory });
    await p.connect();
    const start = Date.now();
    await expect(
      p.search({ subject: 'x' }, { timeoutMs: 50, maxRetries: 0 }),
    ).rejects.toThrow(/таймаут/);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(2000);
  });

  it('быстрый search не обрывается по таймауту', async () => {
    const { factory, client } = makeFactory({
      search: vi.fn().mockResolvedValue([1, 2]),
      fetchAll: vi.fn().mockResolvedValue([]),
    });
    const p = new YandexMailProvider({ account, clientFactory: factory });
    await p.connect();
    const res = await p.search({ subject: 'x' }, { timeoutMs: 5000, maxRetries: 0 });
    expect(res.total).toBe(2);
    expect(client.search).toHaveBeenCalled();
  });

  it('таймаут downloadAttachments → ConnectError о таймауте', async () => {
    const { factory } = makeFactory({
      fetchAll: vi.fn().mockResolvedValue([
        {
          uid: 1,
          bodyStructure: { type: 'multipart/mixed', childNodes: [{ part: '1', type: 'text/plain', childNodes: [] }, { part: '2', type: 'application/pdf', disposition: 'attachment', dispositionParameters: { filename: 'a.pdf' }, size: 10, childNodes: [] }] },
        },
      ]),
      downloadMany: vi.fn().mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve({ '2': { content: Buffer.from('x') } }), 5000)),
      ),
    });
    const p = new YandexMailProvider({ account, clientFactory: factory });
    await p.connect();
    const tmp = await import('node:os').then((m) => m.tmpdir());
    await expect(
      p.downloadAttachments(1, `${tmp}/test-timeout-dl`, { folder: 'INBOX', timeoutMs: 50, maxRetries: 0 }),
    ).rejects.toThrow(/таймаут/);
  });

  it('таймаут listFolders → ConnectError о таймауте', async () => {
    const { factory } = makeFactory({
      list: vi.fn().mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve([INBOX]), 5000)),
      ),
    });
    const p = new YandexMailProvider({ account, clientFactory: factory });
    await p.connect();
    await expect(
      p.listFolders({ timeoutMs: 50, maxRetries: 0 }),
    ).rejects.toThrow(/таймаут/);
  });

  // === retry с переподключением ===

  it('обрыв в search → reconnect + retry, успех на повторе', async () => {
    const { factory, client } = makeFactory({
      search: vi
        .fn()
        .mockRejectedValueOnce(new Error('Connection not available'))
        .mockResolvedValueOnce([1]),
      fetchAll: vi.fn().mockResolvedValue([]),
    });
    const p = new YandexMailProvider({ account, clientFactory: factory });
    await p.connect();
    const res = await p.search({ subject: 'x' }, { timeoutMs: 5000, maxRetries: 1 });
    expect(res.total).toBe(1);
    expect(client.search).toHaveBeenCalledTimes(2);
    expect(client.logout).toHaveBeenCalled(); // reconnect закрыл старый
    expect(client.connect).toHaveBeenCalled(); // reconnect открыл новый
  });

  it('обрыв в downloadAttachments → reconnect + retry, успех', async () => {
    const row = {
      uid: 1,
      bodyStructure: { type: 'multipart/mixed', childNodes: [{ part: '1', type: 'text/plain', childNodes: [] }, { part: '2', type: 'application/pdf', disposition: 'attachment', dispositionParameters: { filename: 'a.pdf' }, size: 10, childNodes: [] }] },
    };
    const { factory, client } = makeFactory({
      fetchAll: vi
        .fn()
        .mockRejectedValueOnce(new Error('Connection not available'))
        .mockResolvedValueOnce([row]),
      downloadMany: vi.fn().mockResolvedValue({ '2': { content: Buffer.from('x') } }),
    });
    const p = new YandexMailProvider({ account, clientFactory: factory });
    await p.connect();
    const tmp = await import('node:os').then((m) => m.tmpdir());
    const res = await p.downloadAttachments(1, `${tmp}/test-retry-dl`, {
      folder: 'INBOX',
      timeoutMs: 5000,
      maxRetries: 1,
    });
    expect(res.paths).toHaveLength(1);
    expect(client.fetchAll).toHaveBeenCalledTimes(2);
    expect(client.logout).toHaveBeenCalled();
  });

  it('обрыв в fetch → reconnect + retry, успех', async () => {
    const { factory, client } = makeFactory({
      fetchAll: vi
        .fn()
        .mockRejectedValueOnce(new Error('Connection not available'))
        .mockResolvedValueOnce([
          {
            uid: 1,
            source: Buffer.from('From: a@b.com\r\n\r\nbody'),
            bodyStructure: { type: 'text/plain', childNodes: [] },
            envelope: { subject: 's', from: [{ address: 'a@b.com' }], to: [], date: new Date(0) },
            internalDate: new Date(0),
            flags: new Set(),
          },
        ]),
    });
    const p = new YandexMailProvider({ account, clientFactory: factory });
    await p.connect();
    const res = await p.fetch(1, 'INBOX', { timeoutMs: 5000, maxRetries: 1 });
    expect(res.uid).toBe(1);
    expect(client.fetchAll).toHaveBeenCalledTimes(2);
  });

  it('обрыв в listFolders → reconnect + retry, успех', async () => {
    const { factory, client } = makeFactory({
      list: vi
        .fn()
        .mockRejectedValueOnce(new Error('Connection not available'))
        .mockResolvedValueOnce([INBOX]),
    });
    const p = new YandexMailProvider({ account, clientFactory: factory });
    await p.connect();
    const res = await p.listFolders({ timeoutMs: 5000, maxRetries: 1 });
    expect(res).toHaveLength(1);
    expect(client.list).toHaveBeenCalledTimes(2);
  });

  it('успех без обрыва — без переподключения (одна попытка)', async () => {
    const { factory, client } = makeFactory({
      search: vi.fn().mockResolvedValue([1]),
      fetchAll: vi.fn().mockResolvedValue([]),
    });
    const p = new YandexMailProvider({ account, clientFactory: factory });
    await p.connect();
    await p.search({ subject: 'x' }, { timeoutMs: 5000, maxRetries: 3 });
    expect(client.search).toHaveBeenCalledTimes(1);
    expect(client.logout).not.toHaveBeenCalled();
  });

  it('исчерпание MAX_RETRIES → ошибка с маскировкой секрета', async () => {
    const { factory } = makeFactory({
      search: vi.fn().mockRejectedValue(new Error('Connection not available')),
    });
    const p = new YandexMailProvider({ account, clientFactory: factory });
    await p.connect();
    await expect(
      p.search({ subject: 'x' }, { timeoutMs: 5000, maxRetries: 1 }),
    ).rejects.toThrow(/Connection not available/);
    // пароль не должен утекать
    try {
      await p.search({ subject: 'x' }, { timeoutMs: 5000, maxRetries: 1 });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      expect(msg).not.toContain(account.password);
    }
  });

  // === reconnect сохраняет account ===

  it('reconnect закрывает старый client, открывает новый, account сохранён', async () => {
    const { factory, client } = makeFactory({
      search: vi
        .fn()
        .mockRejectedValueOnce(new Error('Connection not available'))
        .mockResolvedValueOnce([1]),
      fetchAll: vi.fn().mockResolvedValue([]),
    });
    const p = new YandexMailProvider({ account, clientFactory: factory });
    await p.connect();
    await p.search({ subject: 'x' }, { timeoutMs: 5000, maxRetries: 1 });
    // после reconnect провайдер всё ещё «жив» (account не null)
    const acc = (p as unknown as { account: MailAccount | null }).account;
    expect(acc).not.toBeNull();
    expect(acc?.login).toBe(account.login);
    expect(client.logout).toHaveBeenCalled();
  });
});
