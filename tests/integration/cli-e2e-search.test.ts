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
import type { EmailMessage, EmailFull, SearchResult, DownloadResult } from '../../src/types/email.js';

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

/** Стаб-провайдер IMAP: возвращает предзаготовленные письма. */
function stubProvider(): MailProvider {
  const messages: EmailMessage[] = [
    {
      uid: 101,
      subject: 'Проект X: план работ',
      from: { address: 'boss@example.com', name: 'Босс' },
      to: [{ address: 'test@yandex.com' }],
      date: new Date('2026-10-01'),
      flags: [],
      folder: 'INBOX',
      size: 2048,
    },
    {
      uid: 102,
      subject: 'Re: Проект X: статус',
      from: { address: 'team@example.com' },
      to: [{ address: 'test@yandex.com' }],
      date: new Date('2026-10-02'),
      flags: ['\\Seen'],
      folder: 'INBOX',
      size: 1536,
    },
  ];
  const full: EmailFull = {
    ...(messages[0] ?? { uid: 0, subject: '', from: { address: '' }, to: [], date: new Date(), flags: [], folder: 'INBOX' }),
    body: 'Тело письма: план работ по проекту X на квартал.',
    hasBody: true,
    attachments: [{ part: '1', filename: 'plan.pdf', contentType: 'application/pdf', size: 500 }],
  };
  return {
    connect: async () => ({ ok: true, login: ACCOUNT.login }),
    listFolders: async () => [{ name: 'INBOX', path: 'INBOX', delimiter: '/', flags: [] }],
    search: async (): Promise<SearchResult> => ({ messages, total: messages.length, hasMore: false }),
    fetch: async (uid: number): Promise<EmailFull> => ({ ...full, uid }),
    downloadAttachments: async (uid: number): Promise<DownloadResult> => ({
      paths: [`/tmp/downloads/plan-${uid}.pdf`],
      folder: 'INBOX',
      uid,
    }),
    dispose: async () => {},
  };
}

/** Stub LLM (не используется в /find, но нужен composeAgents). */
function stubClient(): RouterAiClient {
  return {
    chat: async (): Promise<ChatResult> => ({ content: 'ок', toolCalls: [] }),
  } as unknown as RouterAiClient;
}

describe('E2E CLI guided: /find', () => {
  beforeEach(() => resetTools());

  it('/find находит письма по теме → вывод списка', async () => {
    const orchestrator = await composeAgents({
      client: stubClient(),
      config: makeConfig(),
      accounts: [ACCOUNT],
      toolLogger: noopToolLogger(),
    });
    void orchestrator; // не используется в guided-режиме, но composeAgents регистрирует тулы
    getSharedSessionStore().set(ACCOUNT, stubProvider());

    const io = new MockConsoleIO(['найди письма по проекту X', '/find', 'тема - Проект X', '', '/quit']);
    // Первая строка — свободный текст (отклоняется), затем /find.
    const analyzer = { name: 'analyzer', description: 'stub', run: async () => '' };
    const repl = new CliRepl({ io, accounts: [ACCOUNT], analyzer, downloadDir: '/tmp' });
    const exit = await repl.start();
    const out = io.output();

    expect(exit.reason).toBe('quit');
    expect(out).toContain('только slash-командный режим'); // первая реплика отклонена
    expect(out).toContain('Найдено писем: 2');
    expect(out).toContain('Проект X: план работ');
    expect(out).toContain('UID=101');
  });
});

describe('E2E CLI guided: /download', () => {
  beforeEach(() => resetTools());

  it('/download скачивает вложение выбранного письма', async () => {
    await composeAgents({
      client: stubClient(),
      config: makeConfig(),
      accounts: [ACCOUNT],
      toolLogger: noopToolLogger(),
    });
    getSharedSessionStore().set(ACCOUNT, stubProvider());

    const tmpDir = '/tmp/eh-e2e-dl';
    const io = new MockConsoleIO([
      '/download',
      'тема - Проект X',
      '',
      '101', // выбор UID (2 письма найдено)
      '/quit',
    ]);
    const analyzer = { name: 'analyzer', description: 'stub', run: async () => '' };
    const repl = new CliRepl({ io, accounts: [ACCOUNT], analyzer, downloadDir: tmpDir });
    const exit = await repl.start();
    const out = io.output();

    expect(exit.reason).toBe('quit');
    expect(out).toContain('Скачано файлов: 1');
    expect(out).toContain('plan-101.pdf');
  });
});
