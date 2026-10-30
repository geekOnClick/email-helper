import { describe, it, expect, beforeEach } from 'vitest';
import { resetTools, registerTool } from '../src/tools/registry.js';
import { getSharedSessionStore } from '../src/tools/mail/register-tools.js';
import { runAnalyzeCommand } from '../src/transport/cli/commands/analyze.js';
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
  } as unknown as MailProvider);
}

function stubAnalyzer(): Subagent & { calls: string[] } {
  const calls: string[] = [];
  const agent: Subagent & { calls: string[] } = {
    name: 'analyzer',
    description: 'stub analyzer',
    calls,
    run: async (input: string) => {
      calls.push(input);
      return 'Саммари: это письмо про договор.';
    },
  };
  return agent;
}

describe('runAnalyzeCommand', () => {
  beforeEach(() => {
    resetTools();
    seedSession();
  });

  it('единственное совпадение → анализ сразу', async () => {
    const msg = {
      uid: 10,
      subject: 'договор',
      from: { address: 'legal@example.com' },
      to: [{ address: 'test@yandex.com' }],
      date: new Date('2026-10-01'),
      flags: [],
      folder: 'INBOX',
    };
    registerTool({
      name: 'mail.search',
      description: 'stub',
      inputSchema: { type: 'object' },
      handler: async () => ({ messages: [msg], total: 1, hasMore: false }) as SearchResult,
    });
    const email: EmailFull = {
      ...msg,
      body: 'Тело договора N 42.',
      hasBody: true,
      attachments: [],
    };
    registerTool({
      name: 'mail.fetch',
      description: 'stub',
      inputSchema: { type: 'object' },
      handler: async () => email,
    });
    const analyzer = stubAnalyzer();
    const io = new MockConsoleIO(['тема - договор', '']);
    await runAnalyzeCommand({ io, accounts: [ACCOUNT], analyzer });
    const out = io.output();
    expect(out).toContain('Саммари');
    expect(out).not.toContain('Найдено писем'); // не показ список (1 письмо)
    expect(analyzer.calls).toHaveLength(1);
    expect(analyzer.calls[0]).toContain('договор');
    expect(analyzer.calls[0]).toContain('Тело договора N 42.');
  });

  it('несколько совпадений → показ 5 + выбор UID', async () => {
    const msgs = [1, 2, 3, 4, 5, 6].map((i) => ({
      uid: i,
      subject: `договор ${i}`,
      from: { address: `s${i}@example.com` },
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
    const email: EmailFull = {
      ...(msgs[2] ?? { uid: 3, subject: 'договор 3', from: { address: 's3@example.com' }, to: [{ address: 'test@yandex.com' }], date: new Date('2026-10-01'), flags: [], folder: 'INBOX' }),
      body: 'Тело письма 3.',
      hasBody: true,
      attachments: [],
    };
    registerTool({
      name: 'mail.fetch',
      description: 'stub',
      inputSchema: { type: 'object' },
      handler: async (args) => {
        const a = args as { uid: number };
        return { ...email, uid: a.uid };
      },
    });
    const analyzer = stubAnalyzer();
    const io = new MockConsoleIO(['тема - договор', '', '3']);
    await runAnalyzeCommand({ io, accounts: [ACCOUNT], analyzer });
    const out = io.output();
    expect(out).toContain('UID=1');
    expect(out).toContain('UID=5');
    expect(analyzer.calls).toHaveLength(1);
    expect(analyzer.calls[0]).toContain('Тело письма 3.');
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
    const io = new MockConsoleIO(['тема - несуществующее', '']);
    await runAnalyzeCommand({ io, accounts: [ACCOUNT], analyzer });
    expect(io.output()).toContain('Ничего не найдено');
    expect(analyzer.calls).toHaveLength(0);
  });

  it('отмена выбора UID → отмена', async () => {
    const msgs = [1, 2].map((i) => ({
      uid: i,
      subject: `договор ${i}`,
      from: { address: `s${i}@example.com` },
      to: [{ address: 'test@yandex.com' }],
      date: new Date('2026-10-01'),
      flags: [],
      folder: 'INBOX',
    }));
    registerTool({
      name: 'mail.search',
      description: 'stub',
      inputSchema: { type: 'object' },
      handler: async () => ({ messages: msgs, total: 2, hasMore: false }) as SearchResult,
    });
    registerTool({
      name: 'mail.fetch',
      description: 'stub',
      inputSchema: { type: 'object' },
      handler: async () => ({}),
    });
    const analyzer = stubAnalyzer();
    const io = new MockConsoleIO(['тема - договор', '', '']); // пустой UID
    await runAnalyzeCommand({ io, accounts: [ACCOUNT], analyzer });
    expect(io.output()).toContain('Анализ отменён');
    expect(analyzer.calls).toHaveLength(0);
  });

  it('ошибка анализатора → сообщение', async () => {
    registerTool({
      name: 'mail.search',
      description: 'stub',
      inputSchema: { type: 'object' },
      handler: async () => ({
        messages: [{ uid: 1, subject: 'тест', from: { address: 'a@b.com' }, to: [], date: new Date(), flags: [], folder: 'INBOX' }],
        total: 1,
        hasMore: false,
      }) as SearchResult,
    });
    registerTool({
      name: 'mail.fetch',
      description: 'stub',
      inputSchema: { type: 'object' },
      handler: async () => ({
        uid: 1, subject: 'тест', from: { address: 'a@b.com' }, to: [], date: new Date(), flags: [], folder: 'INBOX',
        body: 'тело', hasBody: true, attachments: [],
      }) as EmailFull,
    });
    const analyzer: Subagent = {
      name: 'analyzer',
      description: 'stub',
      run: async () => {
        throw new Error('LLM timeout');
      },
    };
    const io = new MockConsoleIO(['тема - тест', '']);
    await runAnalyzeCommand({ io, accounts: [ACCOUNT], analyzer });
    expect(io.output()).toContain('Ошибка анализа');
    expect(io.output()).toContain('LLM timeout');
  });
});
