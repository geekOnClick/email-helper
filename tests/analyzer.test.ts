import { describe, it, expect, beforeEach } from 'vitest';
import { createAnalyzer } from '../src/agents/analyzer.js';
import { SubagentRegistry } from '../src/agents/subagent.js';
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

/** Регистрирует стаб mail.fetch, возвращающий тело письма. */
function registerMailFetchStub(): void {
  registerTool({
    name: 'mail.fetch',
    description: 'чтение тела письма по UID (стаб)',
    inputSchema: { type: 'object' },
    handler: async (args) => ({
      uid: args.uid,
      subject: 'Тема письма',
      body: 'Текст письма для анализа.',
      hasBody: true,
      attachments: [],
    }),
  });
}

describe('Analyzer (субагент-анализатор)', () => {
  beforeEach(() => resetTools());

  it('инструкция оркестратора становится стартовой репликой; финал без тулов → 1 итерация', async () => {
    const { client, requests } = mockClient([finalResult('Саммари: письмо о X.')]);
    const analyzer = await createAnalyzer({
      client,
      config: makeConfig(),
      skill: 'Ты анализатор.',
    });
    const out = await analyzer.run('Проанализируй письмо #1.');
    expect(out).toBe('Саммари: письмо о X.');
    // первый запрос: system + user (инструкция оркестратора)
    expect(requests[0]?.messagesCount).toBe(2);
    expect(requests[0]?.role).toBe('analyzer');
  });

  it('анализ с вызовом mail.fetch → результат → финал (2 итерации, тело в role:tool)', async () => {
    registerMailFetchStub();
    const { client, requests } = mockClient([
      {
        content: '',
        toolCalls: [tc('c1', 'mail.fetch', { login: 'u@yandex.ru', uid: 42 })],
      },
      finalResult('Саммари: текст проанализирован.'),
    ]);
    const analyzer = await createAnalyzer({
      client,
      config: makeConfig({ AGENT_MAX_TOOL_RESULT_CHARS: 1000 }),
      skill: 'Ты анализатор.',
    });
    const out = await analyzer.run('Проанализируй UID 42.');
    expect(out).toBe('Саммари: текст проанализирован.');
    expect(requests).toHaveLength(2);
    // второй запрос содержит system + user + assistant(tool_calls) + tool(результат)
    expect(requests[1]?.messagesCount).toBe(4);
  });

  it('ошибка тулa → ошибка-как-результат, финал', async () => {
    registerTool({
      name: 'mail.fetch',
      description: 'чтение (взрывается)',
      inputSchema: { type: 'object' },
      handler: async () => {
        throw new Error('подключение не установлено');
      },
    });
    const { client } = mockClient([
      { content: '', toolCalls: [tc('c1', 'mail.fetch', { uid: 1 })] },
      finalResult('Не получилось: подключения нет.'),
    ]);
    const analyzer = await createAnalyzer({
      client,
      config: makeConfig({ AGENT_MAX_TOOL_RESULT_CHARS: 1000 }),
      skill: 'Ты анализатор.',
    });
    const out = await analyzer.run('Проанализируй.');
    expect(out).toBe('Не получилось: подключения нет.');
  });

  it('исчерпание итераций → truncated (модель всегда зовёт тул)', async () => {
    registerMailFetchStub();
    const { client } = mockClient([
      { content: '', toolCalls: [tc('c1', 'mail.fetch', { uid: 1 })] },
    ]);
    const analyzer = await createAnalyzer({
      client,
      config: makeConfig({ AGENT_MAX_ITERATIONS: 2, AGENT_MAX_TOOL_RESULT_CHARS: 1000 }),
      skill: 'Ты анализатор.',
    });
    // run возвращает последний content; лимит достигнут, но исключения нет
    const out = await analyzer.run('Проанализируй.');
    expect(typeof out).toBe('string');
  });

  it('тул delegate отсутствует в наборе тулов анализатора', async () => {
    registerMailFetchStub();
    // Регистрируем ещё тулы, которые НЕ должны попасть в набор анализатора.
    registerTool({
      name: 'mail.connect',
      description: 'подключение',
      inputSchema: { type: 'object' },
      handler: async () => 'ok',
    });
    registerTool({
      name: 'mail.search',
      description: 'поиск',
      inputSchema: { type: 'object' },
      handler: async () => [],
    });

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

    const analyzer = await createAnalyzer({
      client: captureClient,
      config: makeConfig(),
      skill: 'Ты анализатор.',
    });
    await analyzer.run('hi');

    // В наборе только mail.fetch (с подчёркиванием в OpenAI-виде), без delegate и рутины.
    expect(requests[0]?.toolsCount).toBe(1);
    expect(requests[0]?.toolNames).toEqual(['mail_fetch']);
  });

  it('регистрация анализатора + стаб-субагента в одном реестре; повторная регистрация → throw', async () => {
    const { client } = mockClient([finalResult('ок')]);
    const analyzer = await createAnalyzer({
      client,
      config: makeConfig(),
      skill: 'Ты анализатор.',
    });

    const registry = new SubagentRegistry();
    registry.register(analyzer);
    registry.register({
      name: 'helper',
      description: 'рутина',
      run: async () => 'helper-ok',
    });
    expect(registry.list()).toHaveLength(2);
    expect(registry.get('analyzer')?.name).toBe('analyzer');
    expect(registry.get('helper')?.name).toBe('helper');

    expect(() => registry.register(analyzer)).toThrow(/субагент уже зарегистрирован: analyzer/);
  });
});