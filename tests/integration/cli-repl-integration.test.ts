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
import type { EmailMessage, EmailFull, SearchResult } from '../../src/types/email.js';

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

function stubProvider(): MailProvider {
  const messages: EmailMessage[] = [
    {
      uid: 301,
      subject: 'Анализ договора',
      from: { address: 'legal@example.com' },
      to: [{ address: 'test@yandex.com' }],
      date: new Date('2026-10-10'),
      flags: [],
      folder: 'INBOX',
    },
  ];
  const full: EmailFull = {
    ...(messages[0] ?? { uid: 0, subject: '', from: { address: '' }, to: [], date: new Date(), flags: [], folder: 'INBOX' }),
    body: 'Текст договора для анализа.',
    hasBody: true,
    attachments: [],
  };
  return {
    connect: async () => ({ ok: true, login: ACCOUNT.login }),
    listFolders: async () => [{ name: 'INBOX', path: 'INBOX', delimiter: '/', flags: [] }],
    search: async (): Promise<SearchResult> => ({ messages, total: 1, hasMore: false }),
    fetch: async (uid: number): Promise<EmailFull> => ({ ...full, uid }),
    downloadAttachments: async () => ({}) as never,
    dispose: async () => {},
  };
}

/**
 * Scripted LLM: для роли analyzer возвращает саммари.
 * (composeAgents создаёт analyzer с этим клиентом; /analyze вызывает analyzer.run.)
 */
function scriptedClient(): RouterAiClient {
  let callNo = 0;
  return {
    chat: async (): Promise<ChatResult> => {
      callNo++;
      // analyzer.run делает один запрос к LLM → возвращаем саммари.
      if (callNo === 1) {
        return {
          content: 'Саммари: договор касается аренды, срок 12 месяцев, сумма 100 тыс.',
          toolCalls: [],
        };
      }
      return { content: 'ок', toolCalls: [] };
    },
  } as unknown as RouterAiClient;
}

describe('CliRepl: интеграция /analyze с composeAgents', () => {
  beforeEach(() => resetTools());

  it('/analyze находит и анализирует письмо через субагента', async () => {
    const { analyzer, accounts } = await composeAgentWithAnalyzer();
    getSharedSessionStore().set(ACCOUNT, stubProvider());

    const io = new MockConsoleIO([
      '/analyze',
      'тема - Анализ договора',
      '',
      '/quit',
    ]);
    const repl = new CliRepl({ io, accounts, analyzer, downloadDir: '/tmp' });
    const exit = await repl.start();
    const out = io.output();

    expect(exit.reason).toBe('quit');
    expect(out).toContain('Саммари');
    expect(out).toContain('аренды');
  });

  it('EOF завершает интеграционную сессию', async () => {
    const { analyzer, accounts } = await composeAgentWithAnalyzer();
    const io = new MockConsoleIO([]);
    const repl = new CliRepl({ io, accounts, analyzer, downloadDir: '/tmp' });
    const exit = await repl.start();
    expect(exit.reason).toBe('eof');
  });
});

/** Собирает агента и возвращает analyzer + accounts для REPL. */
async function composeAgentWithAnalyzer(): Promise<{
  analyzer: import('../../src/agents/subagent.js').Subagent;
  accounts: MailAccount[];
}> {
  await composeAgents({
    client: scriptedClient(),
    config: makeConfig(),
    accounts: [ACCOUNT],
    toolLogger: noopToolLogger(),
  });
  // analyzer создаётся в composeAgents, но не возвращается наружу.
  // Для интеграционного теста создаём отдельный analyzer с тем же клиентом.
  const { createAnalyzer } = await import('../../src/agents/analyzer.js');
  const analyzer = await createAnalyzer({
    client: scriptedClient(),
    config: makeConfig(),
    toolLogger: noopToolLogger(),
  });
  return { analyzer, accounts: [ACCOUNT] };
}
