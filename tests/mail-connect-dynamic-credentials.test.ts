import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMailConnectTool } from '../src/tools/mail/mail-connect.tool.js';
import { MailSessionStore } from '../src/tools/mail/session-store.js';
import type { MailAccount } from '../src/tools/mail/types.js';

/**
 * Тесты динамических кред для тулa mail.connect (change mcp-dynamic-credentials).
 *
 * Фабрика createMailProvider мокается: возвращает stub-провайдер, который
 * запоминает переданный аккаунт и подключается успешно (или с заданной ошибкой).
 * Это позволяет проверить, какой именно аккаунт (динамический или из .env)
 * ушёл в фабрику, без реального IMAP-соединения.
 */

/** Аккаунты из .env (fallback). */
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

describe('mail.connect: динамические креды', () => {
  beforeEach(() => {
    lastAccount = null;
    connectShouldFail = false;
  });

  it('2.1 credentials переданы → временный аккаунт, не обращается к .env', async () => {
    const store = new MailSessionStore();
    const tool = createMailConnectTool({ accounts: envAccounts, sessionStore: store });

    const res = await tool.handler({
      login: 'dynamic@yandex.com',
      credentials: { provider: 'yandex', password: 'super-secret' },
    });

    expect(res).toEqual({
      connected: true,
      accountId: 'dynamic@yandex.com',
      provider: 'yandex',
    });
    // Фабрике передан динамический аккаунт, а не env-аккаунт.
    expect(lastAccount).toEqual({
      provider: 'yandex',
      login: 'dynamic@yandex.com',
      password: 'super-secret',
      authStrategy: 'basic',
    });
    // Сессия сохранена по login.
    expect(store.has('dynamic@yandex.com')).toBe(true);
  });

  it('2.2 без credentials → fallback на .env (регрессия)', async () => {
    const store = new MailSessionStore();
    const tool = createMailConnectTool({ accounts: envAccounts, sessionStore: store });

    const res = await tool.handler({ login: 'env@yandex.com' });

    expect(res).toEqual({
      connected: true,
      accountId: 'env@yandex.com',
      provider: 'yandex',
    });
    expect(lastAccount).toEqual(envAccounts[0]);
    expect(store.has('env@yandex.com')).toBe(true);
  });

  it('2.3 без credentials и аккаунт не найден в .env → ошибка', async () => {
    const store = new MailSessionStore();
    const tool = createMailConnectTool({ accounts: envAccounts, sessionStore: store });

    await expect(tool.handler({ login: 'nope@nope.com' })).rejects.toThrow(/аккаунт не найден/);
    expect(store.has('nope@nope.com')).toBe(false);
    expect(lastAccount).toBeNull();
  });

  it('2.4 невалидный credentials.provider → ошибка валидации', async () => {
    const store = new MailSessionStore();
    const tool = createMailConnectTool({ accounts: envAccounts, sessionStore: store });

    await expect(
      tool.handler({
        login: 'x@yandex.com',
        credentials: { provider: 'gmail' as never, password: 'p' },
      }),
    ).rejects.toThrow(/невалидный credentials\.provider/);
    expect(store.has('x@yandex.com')).toBe(false);
  });

  it('2.5 пустой credentials.password → ошибка валидации', async () => {
    const store = new MailSessionStore();
    const tool = createMailConnectTool({ accounts: envAccounts, sessionStore: store });

    await expect(
      tool.handler({
        login: 'x@yandex.com',
        credentials: { provider: 'yandex', password: '' },
      }),
    ).rejects.toThrow(/credentials\.password обязателен/);
    expect(store.has('x@yandex.com')).toBe(false);
  });

  it('2.6 ошибка подключения с динамическими кредами → пароль замаскирован', async () => {
    const store = new MailSessionStore();
    const tool = createMailConnectTool({ accounts: envAccounts, sessionStore: store });
    connectShouldFail = true;

    await expect(
      tool.handler({
        login: 'dynamic@yandex.com',
        credentials: { provider: 'yandex', password: 'leak-me-123' },
      }),
    ).rejects.toThrow(/auth failed for \[REDACTED\]/);

    // Пароль не должен попасть в сообщение об ошибке в открытом виде.
    // (проверяем через try/catch, чтобы увидеть сам текст ошибки)
    let errorMsg = '';
    try {
      await tool.handler({
        login: 'dynamic@yandex.com',
        credentials: { provider: 'yandex', password: 'leak-me-123' },
      });
    } catch (e) {
      errorMsg = e instanceof Error ? e.message : String(e);
    }
    expect(errorMsg).not.toContain('leak-me-123');
    expect(errorMsg).toContain('[REDACTED]');
    expect(store.has('dynamic@yandex.com')).toBe(false);
  });

  it('2.7 успешный результат не содержит пароль', async () => {
    const store = new MailSessionStore();
    const tool = createMailConnectTool({ accounts: envAccounts, sessionStore: store });

    const res = (await tool.handler({
      login: 'dynamic@yandex.com',
      credentials: { provider: 'yandex', password: 'super-secret-456' },
    })) as Record<string, unknown>;

    // Результат — ConnectionResult { connected, accountId, provider }.
    expect(Object.keys(res).sort()).toEqual(['accountId', 'connected', 'provider']);
    expect(JSON.stringify(res)).not.toContain('super-secret-456');
  });

  it('credentials с authStrategy oauth2 → передаётся в аккаунт', async () => {
    const store = new MailSessionStore();
    const tool = createMailConnectTool({ accounts: envAccounts, sessionStore: store });

    await tool.handler({
      login: 'dyn@outlook.com',
      credentials: { provider: 'outlook', password: 'p', authStrategy: 'oauth2' },
    });

    expect(lastAccount).toEqual({
      provider: 'outlook',
      login: 'dyn@outlook.com',
      password: 'p',
      authStrategy: 'oauth2',
    });
  });

  it('credentials с невалидным authStrategy → ошибка', async () => {
    const store = new MailSessionStore();
    const tool = createMailConnectTool({ accounts: envAccounts, sessionStore: store });

    await expect(
      tool.handler({
        login: 'dyn@outlook.com',
        credentials: { provider: 'outlook', password: 'p', authStrategy: 'magic' as never },
      }),
    ).rejects.toThrow(/невалидный credentials\.authStrategy/);
  });

  it('store.dispose(login) очищает динамическую сессию из store', async () => {
    const store = new MailSessionStore();
    const tool = createMailConnectTool({ accounts: envAccounts, sessionStore: store });

    await tool.handler({
      login: 'wipe@yandex.com',
      credentials: { provider: 'yandex', password: 'wipe-me' },
    });
    expect(store.has('wipe@yandex.com')).toBe(true);
    expect(store.getAccount('wipe@yandex.com')?.password).toBe('wipe-me');

    // dispose удаляет запись из store — пароль больше недоступен через store.
    await store.dispose('wipe@yandex.com');
    expect(store.has('wipe@yandex.com')).toBe(false);
    expect(store.getAccount('wipe@yandex.com')).toBeUndefined();
  });

  it('store.disposeAll() очищает все динамические сессии', async () => {
    const store = new MailSessionStore();
    const tool = createMailConnectTool({ accounts: envAccounts, sessionStore: store });

    await tool.handler({
      login: 'a@yandex.com',
      credentials: { provider: 'yandex', password: 'p1' },
    });
    await tool.handler({
      login: 'b@yandex.com',
      credentials: { provider: 'yandex', password: 'p2' },
    });
    expect(store.has('a@yandex.com')).toBe(true);
    expect(store.has('b@yandex.com')).toBe(true);

    await store.disposeAll();
    expect(store.has('a@yandex.com')).toBe(false);
    expect(store.has('b@yandex.com')).toBe(false);
    expect(store.getAccount('a@yandex.com')).toBeUndefined();
    expect(store.getAccount('b@yandex.com')).toBeUndefined();
  });
});
