import { describe, it, expect } from 'vitest';
import { MailSessionStore } from '../src/tools/mail/session-store.js';
import type { MailProvider } from '../src/tools/mail/mail-provider.js';
import type { MailAccount } from '../src/tools/mail/types.js';

const account: MailAccount = {
  provider: 'yandex',
  login: 'user@yandex.com',
  password: 'pass',
  authStrategy: 'basic',
};

function stubProvider(): MailProvider {
  return {
    connect: async () => ({ connected: true, accountId: account.login, provider: 'yandex' }),
    listFolders: async () => [],
    search: async () => ({ messages: [], total: 0, hasMore: false }),
    fetch: async () => ({}) as never,
    downloadAttachments: async () => ({ paths: [], folder: '', uid: 0 }),
    dispose: async () => undefined,
  };
}

describe('MailSessionStore.getAccount', () => {
  it('set → getAccount возвращает аккаунт', () => {
    const store = new MailSessionStore();
    store.set(account, stubProvider());
    expect(store.getAccount('user@yandex.com')).toEqual(account);
  });

  it('без сессии → undefined', () => {
    const store = new MailSessionStore();
    expect(store.getAccount('nobody@yandex.com')).toBeUndefined();
    expect(store.get('nobody@yandex.com')).toBeUndefined();
    expect(store.has('nobody@yandex.com')).toBe(false);
  });

  it('get возвращает провайдера, getAccount — аккаунт (симметрия)', () => {
    const store = new MailSessionStore();
    const provider = stubProvider();
    store.set(account, provider);
    expect(store.get('user@yandex.com')).toBe(provider);
    expect(store.getAccount('user@yandex.com')).toBe(account);
    expect(store.has('user@yandex.com')).toBe(true);
  });
});
