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
import type { EmailMessage, SearchResult } from '../../src/types/email.js';

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

/** Стаб-провайдер IMAP: возвращает предзаготовленные письма. */
function stubProvider(): MailProvider {
  const messages: EmailMessage[] = [
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

/** Стаб SMTP-фабрика: фиксирует отправку без реального SMTP. */
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

/**
 * Scripted-клиент для сценария «поиск→отправка»:
 *   1) оркестратор → mail.search (найти письма со счётом)
 *   2) оркестратор → mail.send (отправить ответ)
 *   3) оркестратор → финал «Письмо найдено, ответ отправлен»
 *
 * mail.connect пропущен: стаб-провайдер предзаготовлен в sessionStore.
 */
function scriptedClient(): RouterAiClient {
  let callNo = 0;
  return {
    chat: async (): Promise<ChatResult> => {
      callNo++;
      if (callNo === 1) {
        return {
          content: '',
          toolCalls: [tc('s1', 'mail.search', { login: 'test@yandex.com', subject: 'Счёт' })],
        };
      }
      if (callNo === 2) {
        return {
          content: '',
          toolCalls: [
            tc('send1', 'mail.send', {
              login: 'test@yandex.com',
              to: [{ address: 'billing@example.com' }],
              subject: 'Re: Счёт за услуги',
              text: 'Получено, оплачиваю в течение 3 дней.',
            }),
          ],
        };
      }
      return {
        content: 'Письмо со счётом найдено, ответ отправлен на billing@example.com.',
        toolCalls: [],
      };
    },
  } as unknown as RouterAiClient;
}

describe('E2E CLI: подключение→поиск→отправка', () => {
  beforeEach(() => resetTools());

  it('полный цикл с стаб-провайдером IMAP и стаб SMTP', async () => {
    const smtpStub = stubSmtpFactory();
    const orchestrator = await composeAgents({
      client: scriptedClient(),
      config: makeConfig(),
      accounts: [ACCOUNT],
      smtpTransportFactory: smtpStub.factory,
      toolLogger: noopToolLogger(),
    });

    // Предзаготовленная стаб-сессия в store (без реального mail.connect).
    getSharedSessionStore().set(ACCOUNT, stubProvider());

    const io = new MockConsoleIO(['найди счёт и ответь на него', '/quit']);
    const repl = new CliRepl({ io, orchestrator });
    const exit = await repl.start();
    const out = io.output();

    expect(exit.reason).toBe('quit');
    // Прогресс tool-вызовов отображён.
    expect(out).toContain('→ mail.search');
    expect(out).toContain('→ mail.send');
    // Финальный ответ.
    expect(out).toContain('ответ отправлен');
    // Отчёт сессии при выходе.
    expect(out).toContain('Статистика сессии');
    expect(out).toContain('Прогонов: 1');
  });
});
