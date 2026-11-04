import { describe, it, expect, beforeEach } from 'vitest';
import { CliRepl } from '../../src/transport/cli/repl.js';
import { MockConsoleIO } from '../mock-io.js';
import { resetTools, registerTool } from '../../src/tools/registry.js';
import { getSharedSessionStore } from '../../src/tools/mail/register-tools.js';
import { AccountRegistry } from '../../src/config/account-registry.js';
import type { MailAccount } from '../../src/tools/mail/types.js';
import type { Subagent } from '../../src/agents/subagent.js';
import type { EmailMessage, SearchResult } from '../../src/types/email.js';

const ACCOUNT: MailAccount = {
  provider: 'yandex',
  login: 'test@yandex.com',
  password: 'stub',
  authStrategy: 'basic',
};

function stubAnalyzer(): Subagent {
  return { name: 'analyzer', description: 'stub', run: async () => 'саммари' };
}

function msg(uid: number, iso: string): EmailMessage {
  const [y, m, d] = iso.split('-').map(Number);
  return {
    uid,
    subject: 'уроки истории',
    from: { address: 'a@b.com' },
    to: [{ address: 'me@t.com' }],
    date: new Date(y, m - 1, d),
    flags: [],
    folder: 'INBOX',
  };
}

describe('интеграция: /find-all полный поток с пагинацией', () => {
  beforeEach(() => {
    resetTools();
    // Сессия уже активна → ensureMailConnected не вызовет mail.connect.
    getSharedSessionStore().set(ACCOUNT, {
      connect: async () => ({ ok: true, login: ACCOUNT.login }),
      listFolders: async () => [],
      search: async () => ({ messages: [], total: 0, hasMore: false }),
      fetch: async () => ({}),
      downloadAttachments: async () => ({ paths: [], folder: 'INBOX', uid: 0 }),
      dispose: async () => {},
    } as never);
  });

  it('2 страницы, всего 12 писем → «Найдено писем: 12», 10 дат, «найдено ещё 2 писем»', async () => {
    // Страница 1: 10 писем, hasMore true. Страница 2: 2 письма, hasMore false.
    const page1 = Array.from({ length: 10 }, (_, i) => msg(i + 1, `2024-03-${String(i + 1).padStart(2, '0')}`));
    const page2 = [msg(11, '2024-04-01'), msg(12, '2024-04-02')];
    let call = 0;
    registerTool({
      name: 'mail.search',
      description: 'stub',
      inputSchema: { type: 'object' },
      handler: async () => {
        const pages = [
          { messages: page1, total: 12, hasMore: true },
          { messages: page2, total: 12, hasMore: false },
        ];
        return pages[Math.min(call++, pages.length - 1)] as SearchResult;
      },
    });

    const io = new MockConsoleIO(['/find-all', 'тема - уроки истории', '', '/quit']);
    const repl = new CliRepl({
      io,
      accounts: [ACCOUNT],
      registry: new AccountRegistry([ACCOUNT]),
      envPath: '.env.test-not-written',
      analyzer: stubAnalyzer(),
      downloadDir: '/tmp',
    });
    await repl.start();

    const out = io.output();
    expect(out).toContain('Найдено писем: 12');
    // заголовки таблицы
    expect(out).toContain('Дата письма');
    expect(out).toContain('Тема письма');
    expect(out).toContain('Отправитель');
    // ровно 10 строк данных (первые 10 писем): 10 вхождений дат YYYY-MM-DD
    expect(out.match(/2024-(03|04)-\d{2}/g)?.length).toBe(10);
    expect(out).toContain('найдено ещё 2 писем');
  });

  it('диапазон дат передаётся в тул (since/before)', async () => {
    let receivedCriteria: Record<string, unknown> = {};
    registerTool({
      name: 'mail.search',
      description: 'stub',
      inputSchema: { type: 'object' },
      handler: async (args) => {
        receivedCriteria = (args as { criteria: Record<string, unknown> }).criteria;
        return { messages: [], total: 0, hasMore: false } as SearchResult;
      },
    });
    const io = new MockConsoleIO([
      '/find-all',
      'тема - договор',
      'дата с - 2024-01-01',
      'дата по - 2024-12-31',
      '',
      '/quit',
    ]);
    const repl = new CliRepl({
      io,
      accounts: [ACCOUNT],
      registry: new AccountRegistry([ACCOUNT]),
      envPath: '.env.test-not-written',
      analyzer: stubAnalyzer(),
      downloadDir: '/tmp',
    });
    await repl.start();

    expect(receivedCriteria).not.toHaveProperty('subject');
    // since = 2024-01-01 (полночь), before = 2025-01-01 (дата по включительно)
    expect(receivedCriteria.since).toEqual(new Date(2024, 0, 1));
    expect(receivedCriteria.before).toEqual(new Date(2025, 0, 1));
    expect(io.output()).toContain('Ничего не найдено');
  });

  it('без диапазона — ранний since (обход bounded fallback)', async () => {
    let receivedCriteria: Record<string, unknown> = {};
    registerTool({
      name: 'mail.search',
      description: 'stub',
      inputSchema: { type: 'object' },
      handler: async (args) => {
        receivedCriteria = (args as { criteria: Record<string, unknown> }).criteria;
        return { messages: [], total: 0, hasMore: false } as SearchResult;
      },
    });
    const io = new MockConsoleIO(['/find-all', 'тема - договор', '', '/quit']);
    const repl = new CliRepl({
      io,
      accounts: [ACCOUNT],
      registry: new AccountRegistry([ACCOUNT]),
      envPath: '.env.test-not-written',
      analyzer: stubAnalyzer(),
      downloadDir: '/tmp',
    });
    await repl.start();

    expect(receivedCriteria.since).toEqual(new Date(1970, 0, 1));
    expect(receivedCriteria.before).toBeUndefined();
    expect(receivedCriteria).not.toHaveProperty('subject');
  });
});
