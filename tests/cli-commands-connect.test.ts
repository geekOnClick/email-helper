import { describe, it, expect, beforeEach } from 'vitest';
import { resetTools, registerTool } from '../src/tools/registry.js';
import { getSharedSessionStore } from '../src/tools/mail/register-tools.js';
import { ensureMailConnected } from '../src/transport/cli/commands/connect.js';
import { MockConsoleIO } from './mock-io.js';
import type { MailAccount } from '../src/tools/mail/types.js';
import type { MailProvider } from '../src/tools/mail/mail-provider.js';

const ACCOUNT: MailAccount = {
  provider: 'yandex',
  login: 'test@yandex.com',
  password: 'stub',
  authStrategy: 'basic',
};

function stubProvider(opts: { usable?: boolean; reconnectImpl?: () => Promise<void> } = {}): MailProvider {
  const usable = opts.usable ?? true;
  return {
    connect: async () => ({ ok: true, login: ACCOUNT.login }),
    listFolders: async () => [],
    search: async () => ({ messages: [], total: 0, hasMore: false }),
    fetch: async () => ({}),
    downloadAttachments: async () => ({ paths: [], folder: 'INBOX', uid: 0 }),
    dispose: async () => {},
    isConnectionUsable: () => usable,
    reconnect: opts.reconnectImpl ?? (async () => {}),
  } as unknown as MailProvider;
}

describe('ensureMailConnected', () => {
  beforeEach(() => resetTools());

  it('сессия уже активна → true без вызова mail.connect', async () => {
    const store = getSharedSessionStore();
    store.set(ACCOUNT, stubProvider());
    let connectCalled = false;
    registerTool({
      name: 'mail.connect',
      description: 'stub',
      inputSchema: { type: 'object' },
      handler: async () => {
        connectCalled = true;
        return { ok: true, login: ACCOUNT.login };
      },
    });

    const io = new MockConsoleIO([]);
    const ok = await ensureMailConnected(io, ACCOUNT);
    expect(ok).toBe(true);
    expect(connectCalled).toBe(false); // не вызывался — сессия уже была
  });

  it('сессии нет → вызывает mail.connect, true при успехе', async () => {
    const store = getSharedSessionStore();
    store.dispose(ACCOUNT.login);
    const calls: { login?: string; provider?: string }[] = [];
    registerTool({
      name: 'mail.connect',
      description: 'stub',
      inputSchema: { type: 'object' },
      handler: async (args) => {
        calls.push(args as { login?: string; provider?: string });
        store.set(ACCOUNT, stubProvider()); // имитируем, что тул сохранил сессию
        return { ok: true, login: ACCOUNT.login };
      },
    });

    const io = new MockConsoleIO([]);
    const ok = await ensureMailConnected(io, ACCOUNT);
    expect(ok).toBe(true);
    expect(calls).toEqual([{ login: ACCOUNT.login, provider: ACCOUNT.provider }]);
    expect(io.output()).toContain('Подключено');
  });

  it('ошибка mail.connect → false и сообщение', async () => {
    const store = getSharedSessionStore();
    store.dispose(ACCOUNT.login);
    registerTool({
      name: 'mail.connect',
      description: 'stub',
      inputSchema: { type: 'object' },
      handler: async () => {
        throw new Error('auth failed');
      },
    });

    const io = new MockConsoleIO([]);
    const ok = await ensureMailConnected(io, ACCOUNT);
    expect(ok).toBe(false);
    expect(io.output()).toContain('Ошибка подключения');
    expect(io.output()).toContain('auth failed');
  });

  it('тул mail.connect не зарегистрирован → false', async () => {
    const store = getSharedSessionStore();
    store.dispose(ACCOUNT.login);

    const io = new MockConsoleIO([]);
    const ok = await ensureMailConnected(io, ACCOUNT);
    expect(ok).toBe(false);
    expect(io.output()).toContain('mail.connect');
  });

  it('сессия пригодна → true без переподключения (reconnect не вызывается)', async () => {
    const store = getSharedSessionStore();
    let reconnectCalled = false;
    store.set(
      ACCOUNT,
      stubProvider({
        usable: true,
        reconnectImpl: async () => {
          reconnectCalled = true;
        },
      }),
    );

    const io = new MockConsoleIO([]);
    const ok = await ensureMailConnected(io, ACCOUNT);
    expect(ok).toBe(true);
    expect(reconnectCalled).toBe(false);
    expect(io.output()).not.toContain('Переподключение');
  });

  it('мёртвая сессия → прозрачное переподключение, true при успехе', async () => {
    const store = getSharedSessionStore();
    let reconnectCalled = false;
    store.set(
      ACCOUNT,
      stubProvider({
        usable: false,
        reconnectImpl: async () => {
          reconnectCalled = true;
        },
      }),
    );

    const io = new MockConsoleIO([]);
    const ok = await ensureMailConnected(io, ACCOUNT);
    expect(ok).toBe(true);
    expect(reconnectCalled).toBe(true);
    const out = io.output();
    expect(out).toContain('Переподключение');
    expect(out).toContain('Подключено');
  });

  it('мёртвая сессия + reconnect падает → false и сообщение об ошибке переподключения', async () => {
    const store = getSharedSessionStore();
    store.set(
      ACCOUNT,
      stubProvider({
        usable: false,
        reconnectImpl: async () => {
          throw new Error('network down');
        },
      }),
    );

    const io = new MockConsoleIO([]);
    const ok = await ensureMailConnected(io, ACCOUNT);
    expect(ok).toBe(false);
    const out = io.output();
    expect(out).toContain('Ошибка переподключения');
    expect(out).toContain('network down');
  });
});
