import { describe, it, expect, beforeEach } from 'vitest';
import { createHelper } from '../src/agents/helper.js';
import { resetTools, registerTool } from '../src/tools/registry.js';
import { loadConfig } from '../src/config/loader.js';
import type { RouterAiClient } from '../src/llm/routerai-client.js';
import type { ChatResult, ToolCall } from '../src/llm/types.js';
import type { Config } from '../src/config/schema.js';

/** Конфиг с короткими задержками/лимитами для тестов. */
function makeConfig(overrides: Partial<Config> = {}): Config {
  const base = loadConfig({ ROUTERAI_API_KEY: 'test-key' });
  return {
    ...base,
    LLM_REQUEST_TIMEOUT_MS: 5000,
    LLM_RETRIES: 3,
    LLM_RETRY_BASE_MS: 1,
    AGENT_MAX_ITERATIONS: 3,
    AGENT_MAX_TOOL_RESULT_CHARS: 50,
    ...overrides,
  };
}

/** Мок RouterAiClient: выдаёт заранее заданные ChatResult по очереди. */
function mockClient(results: ChatResult[]): {
  client: RouterAiClient;
  requests: Array<{ messagesCount: number; toolsCount: number; role?: string }>;
} {
  let i = 0;
  const requests: Array<{ messagesCount: number; toolsCount: number; role?: string }> = [];
  const client = {
    chat: async (req: {
      messages: unknown[];
      tools?: unknown[];
      role?: string;
    }): Promise<ChatResult> => {
      requests.push({
        messagesCount: (req.messages as unknown[]).length,
        toolsCount: req.tools?.length ?? 0,
        role: req.role,
      });
      const r = results[Math.min(i, results.length - 1)] as ChatResult;
      i++;
      return r;
    },
  } as unknown as RouterAiClient;
  return { client, requests };
}

/** Строит ToolCall в доменном виде. */
function tc(id: string, name: string, argsObj: unknown, raw?: string): ToolCall {
  const rawArgs = raw ?? (typeof argsObj === 'string' ? argsObj : JSON.stringify(argsObj));
  let parsed: unknown | null;
  let parseError: string | undefined;
  if (rawArgs.length === 0) {
    parsed = null;
    parseError = 'пустые аргументы';
  } else {
    try {
      parsed = JSON.parse(rawArgs);
    } catch (e) {
      parsed = null;
      parseError = e instanceof Error ? e.message : String(e);
    }
  }
  return { id, name, arguments: rawArgs, args: parsed, parseError };
}

const finalResult = (content: string): ChatResult => ({ content, toolCalls: [] });

/** Регистрирует рутинные тулы-стабы. */
function registerRoutineStubs(): void {
  registerTool({
    name: 'mail.connect',
    description: 'подключение (стаб)',
    inputSchema: { type: 'object' },
    handler: async (args) => ({ provider: 'yandex', login: args.login }),
  });
  registerTool({
    name: 'mail.listFolders',
    description: 'папки (стаб)',
    inputSchema: { type: 'object' },
    handler: async () => ['INBOX', 'Sent'],
  });
  registerTool({
    name: 'mail.search',
    description: 'поиск (стаб)',
    inputSchema: { type: 'object' },
    handler: async (args) => ({
      messages: [{ uid: args.uid ?? 1, subject: 'Re: вопрос', folder: 'INBOX' }],
      total: 1,
      hasMore: false,
    }),
  });
  registerTool({
    name: 'mail.fetch',
    description: 'чтение (стаб)',
    inputSchema: { type: 'object' },
    handler: async (args) => ({ uid: args.uid, body: 'текст письма' }),
  });
  registerTool({
    name: 'mail.downloadAttachments',
    description: 'скачивание (стаб)',
    inputSchema: { type: 'object' },
    handler: async () => ({ paths: ['/tmp/a.txt'], folder: 'INBOX', uid: 1 }),
  });
}

describe('Helper (субагент-помощник)', () => {
  beforeEach(() => resetTools());

  it('инструкция оркестратора становится стартовой репликой; финал без тулов → 1 итерация', async () => {
    const { client, requests } = mockClient([finalResult('Подключено: yandex.')]);
    const helper = await createHelper({
      client,
      config: makeConfig(),
      skill: 'Ты помощник.',
    });
    const out = await helper.run('Подключись к ящику.');
    expect(out).toBe('Подключено: yandex.');
    // первый запрос: system + user (инструкция оркестратора)
    expect(requests[0]?.messagesCount).toBe(2);
    expect(requests[0]?.role).toBe('helper');
  });

  it('рутина с вызовом mail.search → результат → финал (2 итерации, тело в role:tool)', async () => {
    registerRoutineStubs();
    const { client, requests } = mockClient([
      {
        content: '',
        toolCalls: [tc('c1', 'mail.search', { login: 'u@yandex.ru', criteria: {} })],
      },
      finalResult('Найдено 1 письмо по теме «вопрос».'),
    ]);
    const helper = await createHelper({
      client,
      config: makeConfig({ AGENT_MAX_TOOL_RESULT_CHARS: 1000 }),
      skill: 'Ты помощник.',
    });
    const out = await helper.run('Найди письма по теме вопрос.');
    expect(out).toBe('Найдено 1 письмо по теме «вопрос».');
    expect(requests).toHaveLength(2);
    // второй запрос: system + user + assistant(tool_calls) + tool(результат)
    expect(requests[1]?.messagesCount).toBe(4);
  });

  it('ошибка тулa → ошибка-как-результат, финал', async () => {
    registerTool({
      name: 'mail.search',
      description: 'поиск (взрывается)',
      inputSchema: { type: 'object' },
      handler: async () => {
        throw new Error('подключение не установлено');
      },
    });
    const { client } = mockClient([
      { content: '', toolCalls: [tc('c1', 'mail.search', {})] },
      finalResult('Не получилось: подключения нет.'),
    ]);
    const helper = await createHelper({
      client,
      config: makeConfig({ AGENT_MAX_TOOL_RESULT_CHARS: 1000 }),
      skill: 'Ты помощник.',
    });
    const out = await helper.run('Найди письма.');
    expect(out).toBe('Не получилось: подключения нет.');
  });

  it('исчерпание итераций → без исключения (модель всегда зовёт тул)', async () => {
    registerRoutineStubs();
    const { client } = mockClient([
      { content: '', toolCalls: [tc('c1', 'mail.search', {})] },
    ]);
    const helper = await createHelper({
      client,
      config: makeConfig({ AGENT_MAX_ITERATIONS: 2, AGENT_MAX_TOOL_RESULT_CHARS: 1000 }),
      skill: 'Ты помощник.',
    });
    const out = await helper.run('Найди письма.');
    expect(typeof out).toBe('string');
  });

  it('набор: есть mail.connect/mail_search/mail_downloadAttachments, нет delegate', async () => {
    registerRoutineStubs();
    const requests: Array<{ toolsCount: number; toolNames: string[] }> = [];
    const captureClient = {
      chat: async (req: {
        tools?: Array<{ function: { name: string } }>;
      }): Promise<ChatResult> => {
        const tools = req.tools ?? [];
        requests.push({
          toolsCount: tools.length,
          toolNames: tools.map((t) => t.function.name),
        });
        return finalResult('ок');
      },
    } as unknown as RouterAiClient;

    const helper = await createHelper({
      client: captureClient,
      config: makeConfig(),
      skill: 'Ты помощник.',
    });
    await helper.run('hi');

    expect(requests[0]?.toolsCount).toBe(5);
    const names = requests[0]?.toolNames ?? [];
    expect(names).toContain('mail_connect');
    expect(names).toContain('mail_search');
    expect(names).toContain('mail_downloadAttachments');
    expect(names).not.toContain('delegate');
  });
});