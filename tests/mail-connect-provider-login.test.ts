import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMailConnectTool } from '../src/tools/mail/mail-connect.tool.js';
import { MailSessionStore } from '../src/tools/mail/session-store.js';
import { AccountRegistry } from '../src/config/account-registry.js';
import { AccountLookupError } from '../src/tools/mail/account-lookup-error.js';
import type { MailAccount } from '../src/tools/mail/types.js';

/**
 * Тесты тулa mail.connect с контрактом provider+login (change mcp-env-account-credentials).
 *
 * Фабрика createMailProvider мокается: возвращает stub-провайдер, который
 * запоминает переданный аккаунт и подключается успешно (или с заданной ошибкой).
 * Это позволяет проверить, какой именно аккаунт ушёл в фабрику (найденный по паре
 * provider+login в реестре), без реального IMAP-соединения.
 */

/** Аккаунты из .env (реестр). */
const envAccounts: MailAccount[] = [
  { provider: 'yandex', login: 'env@yandex.com', password: 'env-pass', authStrategy: 'basic' },
  { provider: 'outlook', login: 'env@outlook.com', password: 'env-pass', authStrategy: 'oauth2' },
];

/** Записывает последний аккаунт, переданный в фабрику (для assertions). */
let lastAccount: MailAccount | null = null;
let connectShouldFail = false;

vi.mock('../src/tools/mail/providers/factory.js', () => ({
  createMailProvider: vi.fn().mockImplementation((account: MailAccount) => {
    lastAccount = account;
    return {
      connect: vi.fn().mockImplementation(async () => {
        if (connectShouldFail) throw new Error(`auth failed for ${account.password}`);
        return { connected: true, accountId: account.login, provider: account.provider };
      }),
      listFolders: vi.fn().mockResolvedValue([]),
      dispose: vi.fn().mockResolvedValue(undefined),
    };
  }),
}));

describe('mail.connect: контракт provider+login', () => {
  beforeEach(() => {
    lastAccount = null;
    connectShouldFail = false;
  });

  it('успех: точное совпадение (provider, login) → подключение с найденным аккаунтом', async () => {
    const store = new MailSessionStore();
    const registry = new AccountRegistry(envAccounts);
    const tool = createMailConnectTool({ accountRegistry: registry, sessionStore: store });

    const res = await tool.handler({ login: 'env@yandex.com', provider: 'yandex' });

    expect(res).toEqual({
      connected: true,
      accountId: 'env@yandex.com',
      provider: 'yandex',
    });
    // Фабрике передан аккаунт из реестра (с паролем из .env), а не что-то иное.
    expect(lastAccount).toEqual(envAccounts[0]);
    // Сессия сохранена по login.
    expect(store.has('env@yandex.com')).toBe(true);
  });

  it('успех: outlook-аккаунт из реестра', async () => {
    const store = new MailSessionStore();
    const registry = new AccountRegistry(envAccounts);
    const tool = createMailConnectTool({ accountRegistry: registry, sessionStore: store });

    await tool.handler({ login: 'env@outlook.com', provider: 'outlook' });
    expect(lastAccount).toEqual(envAccounts[1]);
    expect(store.has('env@outlook.com')).toBe(true);
  });

  it('account_not_found: login отсутствует в реестре → AccountLookupError', async () => {
    const store = new MailSessionStore();
    const registry = new AccountRegistry(envAccounts);
    const tool = createMailConnectTool({ accountRegistry: registry, sessionStore: store });

    await expect(
      tool.handler({ login: 'nope@nope.com', provider: 'yandex' }),
    ).rejects.toSatisfy((err: unknown) => {
      return err instanceof AccountLookupError && err.code === 'account_not_found';
    });
    expect(store.has('nope@nope.com')).toBe(false);
    expect(lastAccount).toBeNull();
  });

  it('provider_mismatch: login есть с другим provider → AccountLookupError', async () => {
    const store = new MailSessionStore();
    const registry = new AccountRegistry(envAccounts);
    const tool = createMailConnectTool({ accountRegistry: registry, sessionStore: store });

    // env@yandex.com заведён с provider=yandex; запрашиваем outlook → mismatch.
    await expect(
      tool.handler({ login: 'env@yandex.com', provider: 'outlook' }),
    ).rejects.toSatisfy((err: unknown) => {
      return err instanceof AccountLookupError && err.code === 'provider_mismatch';
    });
    expect(store.has('env@yandex.com')).toBe(false);
    expect(lastAccount).toBeNull();
  });

  it('ошибка подключения → пароль замаскирован (redact)', async () => {
    const store = new MailSessionStore();
    const registry = new AccountRegistry(envAccounts);
    const tool = createMailConnectTool({ accountRegistry: registry, sessionStore: store });
    connectShouldFail = true;

    let errorMsg = '';
    try {
      await tool.handler({ login: 'env@yandex.com', provider: 'yandex' });
    } catch (e) {
      errorMsg = e instanceof Error ? e.message : String(e);
    }
    expect(errorMsg).toContain('[REDACTED]');
    expect(errorMsg).not.toContain('env-pass');
    expect(store.has('env@yandex.com')).toBe(false);
  });

  it('успешный результат не содержит пароль', async () => {
    const store = new MailSessionStore();
    const registry = new AccountRegistry(envAccounts);
    const tool = createMailConnectTool({ accountRegistry: registry, sessionStore: store });

    const res = (await tool.handler({ login: 'env@yandex.com', provider: 'yandex' })) as Record<
      string,
      unknown
    >;

    expect(Object.keys(res).sort()).toEqual(['accountId', 'connected', 'provider']);
    expect(JSON.stringify(res)).not.toContain('env-pass');
  });

  it('inputSchema: required = [login, provider], без блока credentials', () => {
    const registry = new AccountRegistry(envAccounts);
    const tool = createMailConnectTool({ accountRegistry: registry });
    expect(tool.inputSchema.required).toEqual(['login', 'provider']);
    expect(tool.inputSchema.properties).not.toHaveProperty('credentials');
    expect(tool.inputSchema.properties).toHaveProperty('login');
    expect(tool.inputSchema.properties).toHaveProperty('provider');
  });

  it('невалидный provider → ConnectError (не AccountLookupError)', async () => {
    const store = new MailSessionStore();
    const registry = new AccountRegistry(envAccounts);
    const tool = createMailConnectTool({ accountRegistry: registry, sessionStore: store });

    await expect(
      tool.handler({ login: 'env@yandex.com', provider: 'gmail' as never }),
    ).rejects.toThrow(/невалидный provider/);
    expect(lastAccount).toBeNull();
  });

  it('dispose(login) очищает сессию из store', async () => {
    const store = new MailSessionStore();
    const registry = new AccountRegistry(envAccounts);
    const tool = createMailConnectTool({ accountRegistry: registry, sessionStore: store });

    await tool.handler({ login: 'env@yandex.com', provider: 'yandex' });
    expect(store.has('env@yandex.com')).toBe(true);
    await store.dispose('env@yandex.com');
    expect(store.has('env@yandex.com')).toBe(false);
  });
});
