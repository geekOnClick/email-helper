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
import type { ChatResult, ToolCall } from '../../src/llm/types.js';
import type { Config } from '../../src/config/schema.js';
import type { EmailMessage, EmailFull, SearchResult, DownloadResult } from '../../src/types/email.js';

function makeConfig(overrides: Partial<Config> = {}): Config {
  const base = loadConfig({ ROUTERAI_API_KEY: 'test-key' });
  return {
    ...base,
    AGENT_MAX_ITERATIONS: 8,
    AGENT_MAX_TOOL_RESULT_CHARS: 1000,
    ...overrides,
  };
}

function tc(id: string, name: string, argsObj: unknown): ToolCall {
  const raw = JSON.stringify(argsObj);
  return { id, name, arguments: raw, args: JSON.parse(raw) };
}

const ACCOUNT: MailAccount = {
  provider: 'yandex',
  login: 'test@yandex.com',
  password: 'stub',
  authStrategy: 'basic',
};

/** Стаб-провайдер: возвращает предзаготовленные письма без реального IMAP. */
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
    ...messages[0],
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

/**
 * Scripted-клиент для сценария «поиск→анализ→скачивание→ответ»:
 *   1) оркестратор → mail.search (найти письма по проекту)
 *   2) оркестратор → mail.fetch (прочитать письмо 101)
 *   3) оркестратор → mail.downloadAttachments (скачать вложения)
 *   4) оркестратор → финал «Найдено 2 письма, вложение скачано»
 */
function scriptedClient(): RouterAiClient {
  let callNo = 0;
  return {
    chat: async (): Promise<ChatResult> => {
      callNo++;
      if (callNo === 1) {
        return {
          content: '',
          toolCalls: [tc('s1', 'mail.search', { login: 'test@yandex.com', subject: 'Проект X' })],
        };
      }
      if (callNo === 2) {
        return {
          content: '',
          toolCalls: [tc('f1', 'mail.fetch', { login: 'test@yandex.com', uid: 101 })],
        };
      }
      if (callNo === 3) {
        return {
          content: '',
          toolCalls: [
            tc('d1', 'mail.downloadAttachments', {
              login: 'test@yandex.com',
              uid: 101,
              targetDir: '/tmp/downloads',
            }),
          ],
        };
      }
      return {
        content: 'Найдено 2 письма по проекту X, вложение plan.pdf скачано в /tmp/downloads.',
        toolCalls: [],
      };
    },
  } as unknown as RouterAiClient;
}

describe('E2E CLI: поиск→анализ→скачивание→ответ', () => {
  beforeEach(() => resetTools());

  it('полный цикл через CliRepl с стаб-провайдером почты', async () => {
    const orchestrator = await composeAgents({
      client: scriptedClient(),
      config: makeConfig(),
      accounts: [ACCOUNT],
      toolLogger: noopToolLogger(),
    });

    // Предзаготовленная стаб-сессия в store (без реального mail.connect).
    getSharedSessionStore().set(ACCOUNT, stubProvider());

    const io = new MockConsoleIO(['найди письма по проекту X и скачай вложения', '/quit']);
    const repl = new CliRepl({ io, orchestrator });
    const exit = await repl.start();
    const out = io.output();

    expect(exit.reason).toBe('quit');
    // Прогресс tool-вызовов отображён.
    expect(out).toContain('→ mail.search');
    expect(out).toContain('→ mail.fetch');
    expect(out).toContain('→ mail.downloadAttachments');
    // Финальный ответ.
    expect(out).toContain('Найдено 2 письма');
    expect(out).toContain('plan.pdf');
    // Отчёт сессии при выходе.
    expect(out).toContain('Статистика сессии');
    expect(out).toContain('Прогонов: 1');
  });
});
