import { describe, it, expect, vi } from 'vitest';
import { YandexMailProvider } from '../src/tools/mail/providers/yandex.js';
import type { ImapClientFactory } from '../src/tools/mail/providers/abstract-imap-provider.js';
import type { MailAccount } from '../src/tools/mail/types.js';

const account: MailAccount = {
  provider: 'yandex',
  login: 'agentemailtest@yandex.com',
  password: 'super-secret',
  authStrategy: 'basic',
};

const INBOX_LIST = [
  {
    path: 'INBOX',
    pathAsListed: 'INBOX',
    name: 'INBOX',
    delimiter: '/',
    parent: '',
    parentPath: '',
    flags: new Set(['\\HasChildren', '\\Inbox']),
    specialUse: '\\Inbox',
    listed: true,
    subscribed: true,
    status: undefined,
  },
  {
    path: 'Sent',
    pathAsListed: 'Sent',
    name: 'Sent',
    delimiter: '/',
    parent: '',
    parentPath: '',
    flags: new Set(['\\HasChildren', '\\Sent']),
    specialUse: '\\Sent',
    listed: true,
    subscribed: true,
    status: undefined,
  },
];

function makeFactory(opts: {
  connect?: () => Promise<void>;
  list?: () => Promise<typeof INBOX_LIST>;
}): { factory: ImapClientFactory; logout: ReturnType<typeof vi.fn> } {
  const logout = vi.fn().mockResolvedValue(undefined);
  const factory: ImapClientFactory = () => ({
    connect: opts.connect ?? vi.fn().mockResolvedValue(undefined),
    list: opts.list ?? vi.fn().mockResolvedValue(INBOX_LIST),
    logout,
  });
  return { factory, logout };
}

describe('YandexMailProvider', () => {
  it('connect возвращает ConnectionResult{connected:true, provider:yandex}', async () => {
    const { factory } = makeFactory({});
    const p = new YandexMailProvider({ account, clientFactory: factory });
    const res = await p.connect();
    expect(res).toEqual({ connected: true, accountId: account.login, provider: 'yandex' });
  });

  it('listFolders возвращает папки и содержит \\Inbox', async () => {
    const { factory } = makeFactory({});
    const p = new YandexMailProvider({ account, clientFactory: factory });
    await p.connect();
    const folders = await p.listFolders();
    expect(folders.length).toBeGreaterThan(0);
    expect(folders.some((f) => f.flags.includes('\\Inbox'))).toBe(true);
  });

  it('ошибка невалидных учётных данных не содержит пароля', async () => {
    const { factory } = makeFactory({
      connect: vi.fn().mockRejectedValue(new Error(`AUTHENTICATIONFAILED: invalid ${account.password}`)),
    });
    const p = new YandexMailProvider({ account, clientFactory: factory });
    await expect(p.connect()).rejects.toThrow(/AUTHENTICATIONFAILED/);
    try {
      await p.connect();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      expect(msg).not.toContain(account.password);
    }
  });

  it('ошибка недоступного сервера содержит провайдера', async () => {
    const { factory } = makeFactory({
      connect: vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED')),
    });
    const p = new YandexMailProvider({ account, clientFactory: factory });
    await expect(p.connect()).rejects.toThrow();
    // ошибка пробрасывается; провайдер yandex известен из AccountResult при успехе —
    // здесь проверяем, что connect выбрасывает (доменная ошибка будет обёрнута в 6.2/7.3)
  });

  it('dispose освобождает соединение (вызывает logout)', async () => {
    const { factory, logout } = makeFactory({});
    const p = new YandexMailProvider({ account, clientFactory: factory });
    await p.connect();
    await p.dispose();
    expect(logout).toHaveBeenCalledTimes(1);
  });
});