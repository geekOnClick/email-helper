import { describe, it, expect, beforeEach } from 'vitest';
import { resetTools, registerTool } from '../src/tools/registry.js';
import { getSharedSessionStore } from '../src/tools/mail/register-tools.js';
import { runAnalyzeManyCommand } from '../src/transport/cli/commands/analyze-many.js';
import { MockConsoleIO } from './mock-io.js';
import type { MailAccount } from '../src/tools/mail/types.js';
import type { MailProvider } from '../src/tools/mail/mail-provider.js';
import type { Subagent } from '../src/agents/subagent.js';
import type { SearchResult, EmailFull } from '../src/types/email.js';

const ACCOUNT: MailAccount = {
  provider: 'yandex',
  login: 'test@yandex.com',
  password: 'stub',
  authStrategy: 'basic',
};

/** Pre-seed IMAP-сессии для guided-команд (подключение не вызывается). */
function seedSession(account: MailAccount = ACCOUNT): void {
  getSharedSessionStore().set(account, {
    connect: async () => ({ ok: true, login: account.login }),
    listFolders: async () => [],
    search: async () => ({ messages: [], total: 0, hasMore: false }),
    fetch: async () => ({}),
    downloadAttachments: async () => ({ paths: [], folder: 'INBOX', uid: 0 }),
    dispose: async () => {},
    isConnectionUsable: () => true,
    reconnect: async () => {},
  } as unknown as MailProvider);
}

function stubAnalyzer(): Subagent & { calls: string[] } {
  const calls: string[] = [];
  return {
    name: 'analyzer',
    description: 'stub analyzer',
    calls,
    run: async (input: string) => {
      calls.push(input);
      return 'Саммари писем: письмо 1 — договор; письмо 2 — оплата.\nОбщий смысл: договорные отношения.';
    },
  };
}

/** Строит EmailMessage. */
function msg(uid: number, subject: string, fromAddr = 'a@b.com'): EmailFull {
  return {
    uid,
    subject,
    from: { address: fromAddr },
    to: [{ address: 'test@yandex.com' }],
    date: new Date('2026-10-01'),
    flags: [],
    folder: 'INBOX',
    body: `Тело письма ${uid}: ${subject}.`,
    hasBody: true,
    attachments: [],
  };
}

describe('runAnalyzeManyCommand', () => {
  beforeEach(() => {
    resetTools();
    seedSession();
  });

  it('пакетный поиск + анализ нескольких писем', async () => {
    const msgs = [
      { uid: 1, subject: 'договор', from: { address: 'a@b.com' }, to: [{ address: 'test@yandex.com' }], date: new Date('2026-10-01'), flags: [], folder: 'INBOX' },
      { uid: 2, subject: 'оплата', from: { address: 'a@b.com' }, to: [{ address: 'test@yandex.com' }], date: new Date('2026-10-02'), flags: [], folder: 'INBOX' },
    ];
    registerTool({
      name: 'mail.search',
      description: 'stub',
      inputSchema: { type: 'object' },
      handler: async () => ({ messages: msgs, total: msgs.length, hasMore: false }) as SearchResult,
    });
    registerTool({
      name: 'mail.fetch',
      description: 'stub',
      inputSchema: { type: 'object' },
      handler: async (args) => {
        const a = args as { uid: number };
        return msg(a.uid, a.uid === 1 ? 'договор' : 'оплата');
      },
    });
    const analyzer = stubAnalyzer();
    const io = new MockConsoleIO(['отправитель - a@b.com', '', '']);
    // inputs: отправитель, пусто (завершить мастер), ... promptAccount (1 → авто)
    await runAnalyzeManyCommand({ io, accounts: [ACCOUNT], analyzer });
    const out = io.output();
    expect(out).toContain('Саммари писем');
    expect(analyzer.calls).toHaveLength(1);
    expect(analyzer.calls[0]).toContain('договор');
    expect(analyzer.calls[0]).toContain('оплата');
  });

  it('усечение по maxEmails — анализ только первых N', async () => {
    const msgs = [1, 2, 3, 4, 5].map((i) => ({
      uid: i,
      subject: `договор ${i}`,
      from: { address: 'a@b.com' },
      to: [{ address: 'test@yandex.com' }],
      date: new Date('2026-10-01'),
      flags: [],
      folder: 'INBOX',
    }));
    registerTool({
      name: 'mail.search',
      description: 'stub',
      inputSchema: { type: 'object' },
      handler: async () => ({ messages: msgs, total: msgs.length, hasMore: false }) as SearchResult,
    });
    const fetched: number[] = [];
    registerTool({
      name: 'mail.fetch',
      description: 'stub',
      inputSchema: { type: 'object' },
      handler: async (args) => {
        const a = args as { uid: number };
        fetched.push(a.uid);
        return msg(a.uid, `договор ${a.uid}`);
      },
    });
    const analyzer = stubAnalyzer();
    const io = new MockConsoleIO(['тема - договор', '', '']);
    await runAnalyzeManyCommand({ io, accounts: [ACCOUNT], analyzer, maxEmails: 2 });
    const out = io.output();
    expect(out).toContain('анализируются первые 2');
    expect(fetched).toEqual([1, 2]);
    expect(analyzer.calls).toHaveLength(1);
  });

  it('ничего не найдено', async () => {
    registerTool({
      name: 'mail.search',
      description: 'stub',
      inputSchema: { type: 'object' },
      handler: async () => ({ messages: [], total: 0, hasMore: false }) as SearchResult,
    });
    registerTool({
      name: 'mail.fetch',
      description: 'stub',
      inputSchema: { type: 'object' },
      handler: async () => ({}),
    });
    const analyzer = stubAnalyzer();
    const io = new MockConsoleIO(['тема - несуществующее', '', '']);
    await runAnalyzeManyCommand({ io, accounts: [ACCOUNT], analyzer });
    expect(io.output()).toContain('Ничего не найдено');
    expect(analyzer.calls).toHaveLength(0);
  });

  it('отмена мастера (пустой ввод) → отмена', async () => {
    const analyzer = stubAnalyzer();
    const io = new MockConsoleIO(['']);
    await runAnalyzeManyCommand({ io, accounts: [ACCOUNT], analyzer });
    expect(io.output()).toContain('Анализ отменён');
    expect(analyzer.calls).toHaveLength(0);
  });

  it('тул не зарегистрирован → сообщение', async () => {
    const analyzer = stubAnalyzer();
    const io = new MockConsoleIO(['тема - договор', '', '']);
    await runAnalyzeManyCommand({ io, accounts: [ACCOUNT], analyzer });
    expect(io.output()).toContain('не зарегистрированы');
  });
});
