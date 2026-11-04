import { describe, it, expect, beforeEach } from 'vitest';
import { CliRepl } from '../src/transport/cli/repl.js';
import { MockConsoleIO } from './mock-io.js';
import { resetTools, registerTool } from '../src/tools/registry.js';
import { getSharedSessionStore } from '../src/tools/mail/register-tools.js';
import { AccountRegistry } from '../src/config/account-registry.js';
import type { MailAccount } from '../src/tools/mail/types.js';
import type { Subagent } from '../src/agents/subagent.js';
import type { SearchResult } from '../src/types/email.js';

const ACCOUNT: MailAccount = {
  provider: 'yandex',
  login: 'test@yandex.com',
  password: 'stub',
  authStrategy: 'basic',
};

function stubAnalyzer(): Subagent {
  return { name: 'analyzer', description: 'stub', run: async () => 'саммари' };
}

function makeRepl(inputs: string[], accounts: MailAccount[] = [ACCOUNT]) {
  const io = new MockConsoleIO(inputs);
  const repl = new CliRepl({
    io,
    accounts,
    registry: new AccountRegistry(accounts),
    envPath: '.env.test-not-written',
    analyzer: stubAnalyzer(),
    downloadDir: '/tmp',
  });
  return { io, repl };
}

/** Pre-seed IMAP-сессии, чтобы ensureMailConnected не вызывал mail.connect. */
function seedSession(): void {
  getSharedSessionStore().set(ACCOUNT, {
    connect: async () => ({ ok: true, login: ACCOUNT.login }),
    listFolders: async () => [],
    search: async () => ({ messages: [], total: 0, hasMore: false }),
    fetch: async () => ({}),
    downloadAttachments: async () => ({ paths: [], folder: 'INBOX', uid: 0 }),
    dispose: async () => {},
  } as never);
}

describe('CliRepl: маршрут /find-all', () => {
  beforeEach(() => {
    resetTools();
    seedSession();
  });

  it('ввод /find-all вызывает обработчик и выводит результат', async () => {
    registerTool({
      name: 'mail.search',
      description: 'stub',
      inputSchema: { type: 'object' },
      handler: async () =>
        ({
          messages: [
            { uid: 1, subject: 'договор', from: { address: 'a@b.com' }, to: [], date: new Date(2024, 2, 1), flags: [], folder: 'INBOX' },
          ],
          total: 1,
          hasMore: false,
        }) as SearchResult,
    });
    const { io, repl } = makeRepl(['/find-all', 'тема - договор', '', '/quit']);
    await repl.start();
    const out = io.output();
    expect(out).toContain('Найдено писем: 1');
    expect(out).toContain('2024-03-01');
  });

  it('отмена /find-all пустым вводом → «Поиск отменён» и продолжение REPL', async () => {
    registerTool({
      name: 'mail.search',
      description: 'stub',
      inputSchema: { type: 'object' },
      handler: async () => ({ messages: [], total: 0, hasMore: false }) as SearchResult,
    });
    const { io, repl } = makeRepl(['/find-all', '', '/quit']);
    await repl.start();
    expect(io.output()).toContain('Поиск отменён');
  });

  it('справка содержит /find-all', async () => {
    const { io, repl } = makeRepl(['/quit']);
    await repl.start();
    expect(io.output()).toContain('/find-all');
  });
});
