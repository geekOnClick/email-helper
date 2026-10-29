import { describe, it, expect, beforeEach } from 'vitest';
import { CliRepl } from '../../src/transport/cli/repl.js';
import { MockConsoleIO } from '../mock-io.js';
import { composeAgents } from '../../src/agents/compose.js';
import { resetTools } from '../../src/tools/registry.js';
import { getSharedSessionStore } from '../../src/tools/mail/register-tools.js';
import { loadConfig } from '../../src/config/loader.js';
import { noopToolLogger } from '../../src/observability/logger.js';
import type { MailProvider } from '../../src/tools/mail/mail-provider.js';
import type { MailAccount } from '../../src/tools/mail/types.js';
import type { RouterAiClient } from '../../src/llm/routerai-client.js';
import type { ChatResult } from '../../src/llm/types.js';
import type { Config } from '../../src/config/schema.js';
import type { SearchResult } from '../../src/types/email.js';

function makeConfig(overrides: Partial<Config> = {}): Config {
  const base = loadConfig({ ROUTERAI_API_KEY: 'test-key' });
  return { ...base, AGENT_MAX_ITERATIONS: 5, AGENT_MAX_TOOL_RESULT_CHARS: 1000, ...overrides };
}

const ACCOUNT: MailAccount = {
  provider: 'yandex',
  login: 'test@yandex.com',
  password: 'stub',
  authStrategy: 'basic',
};

/** Стаб-провайдер IMAP. */
function stubProvider(): MailProvider {
  const messages = [
    {
      uid: 201,
      subject: 'Счёт за услуги',
      from: { address: 'billing@example.com' },
      to: [{ address: 'test@yandex.com' }],
      date: new Date('2026-10-05'),
      flags: [],
      folder: 'INBOX',
    },
  ];
  return {
    connect: async () => ({ ok: true, login: ACCOUNT.login }),
    listFolders: async () => [{ name: 'INBOX', path: 'INBOX', delimiter: '/', flags: [] }],
    search: async (): Promise<SearchResult> => ({ messages, total: 1, hasMore: false }),
    fetch: async () => ({}) as never,
    downloadAttachments: async () => ({}) as never,
    dispose: async () => {},
  };
}

/** Стаб SMTP-фабрики: фиксирует отправку. */
function stubSmtpFactory() {
  const sent: { to: string[]; subject: string }[] = [];
  return {
    factory: () => ({
      sendMail: async (opts: { to: string | string[]; subject: string }) => {
        const to = Array.isArray(opts.to) ? opts.to : [opts.to];
        sent.push({ to, subject: opts.subject });
        return { messageId: 'stub-msg-id', response: '250 OK' };
      },
      close: async () => {},
    }),
    sent,
  };
}

function stubClient(): RouterAiClient {
  return {
    chat: async (): Promise<ChatResult> => ({ content: 'ок', toolCalls: [] }),
  } as unknown as RouterAiClient;
}

describe('E2E CLI guided: /send', () => {
  beforeEach(() => resetTools());

  it('/send с подтверждением «да» → отправка', async () => {
    const smtpStub = stubSmtpFactory();
    await composeAgents({
      client: stubClient(),
      config: makeConfig(),
      accounts: [ACCOUNT],
      smtpTransportFactory: smtpStub.factory,
      toolLogger: noopToolLogger(),
    });
    getSharedSessionStore().set(ACCOUNT, stubProvider());

    const io = new MockConsoleIO([
      '/send',
      'тема - Re: Счёт за услуги',
      'текст - Оплачиваю в течение 3 дней.',
      'получатель - billing@example.com',
      '',
      'да',
      '/quit',
    ]);
    const analyzer = { name: 'analyzer', description: 'stub', run: async () => '' };
    const repl = new CliRepl({ io, accounts: [ACCOUNT], analyzer, downloadDir: '/tmp' });
    const exit = await repl.start();
    const out = io.output();

    expect(exit.reason).toBe('quit');
    expect(out).toContain('Черновик письма');
    expect(out).toContain('billing@example.com');
    expect(out).toContain('Письмо отправлено');
  });

  it('/send с отказом → без отправки', async () => {
    const smtpStub = stubSmtpFactory();
    await composeAgents({
      client: stubClient(),
      config: makeConfig(),
      accounts: [ACCOUNT],
      smtpTransportFactory: smtpStub.factory,
      toolLogger: noopToolLogger(),
    });
    getSharedSessionStore().set(ACCOUNT, stubProvider());

    const io = new MockConsoleIO([
      '/send',
      'тема - Тест',
      'текст - тело',
      'получатель - dest@example.com',
      '',
      'нет',
      '/quit',
    ]);
    const analyzer = { name: 'analyzer', description: 'stub', run: async () => '' };
    const repl = new CliRepl({ io, accounts: [ACCOUNT], analyzer, downloadDir: '/tmp' });
    const exit = await repl.start();
    const out = io.output();

    expect(exit.reason).toBe('quit');
    expect(out).toContain('Отправка отменена');
  });
});
