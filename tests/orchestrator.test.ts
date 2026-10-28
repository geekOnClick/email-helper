import { describe, it, expect, beforeEach } from 'vitest';
import { runToolLoop, RegistryToolResolver } from '../src/agents/loop.js';
import { serializeToolResult } from '../src/agents/result-serializer.js';
import { Orchestrator } from '../src/agents/orchestrator.js';
import { SubagentRegistry, createDelegateTool } from '../src/agents/subagent.js';
import { resetTools, registerTool } from '../src/tools/registry.js';
import { loadConfig } from '../src/config/loader.js';
import type { RouterAiClient } from '../src/llm/routerai-client.js';
import type { ChatMessage, ChatResult, ToolCall } from '../src/llm/types.js';
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
  requests: Array<{ messagesCount: number; toolsCount: number }>;
} {
  let i = 0;
  const requests: Array<{ messagesCount: number; toolsCount: number }> = [];
  const client = {
    chat: async (req: { messages: unknown[]; tools?: unknown[] }): Promise<ChatResult> => {
      requests.push({
        messagesCount: (req.messages as unknown[]).length,
        toolsCount: req.tools?.length ?? 0,
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

describe('serializeToolResult', () => {
  it('короткий результат без изменений', () => {
    expect(serializeToolResult({ a: 1 }, 50)).toBe('{"a":1}');
  });

  it('длинный результат усекается с маркером', () => {
    const big = 'x'.repeat(80);
    const out = serializeToolResult(big, 50);
    expect(out.startsWith('x'.repeat(50))).toBe(true);
    expect(out).toContain('результат усечён');
    expect(out).toContain('из 80');
  });

  it('null → "null"', () => {
    expect(serializeToolResult(null, 50)).toBe('null');
  });

  it('undefined → "undefined"', () => {
    expect(serializeToolResult(undefined, 50)).toBe('undefined');
  });
});

describe('RegistryToolResolver', () => {
  beforeEach(() => resetTools());

  it('успешно исполняет тул', async () => {
    registerTool({
      name: 'echo',
      description: 'echo',
      inputSchema: { type: 'object' },
      handler: async (a) => a,
    });
    const resolver = new RegistryToolResolver(1000);
    const msg = await resolver.resolve(tc('1', 'echo', { x: 1 }));
    expect(msg.role).toBe('tool');
    expect(msg.toolCallId).toBe('1');
    expect(msg.content).toBe('{"x":1}');
  });

  it('исключение тулa → ошибка-как-результат', async () => {
    registerTool({
      name: 'boom',
      description: 'boom',
      inputSchema: { type: 'object' },
      handler: async () => {
        throw new Error('взрыв');
      },
    });
    const resolver = new RegistryToolResolver(1000);
    const msg = await resolver.resolve(tc('1', 'boom', {}));
    expect(msg.content).toContain('Ошибка тулa boom');
    expect(msg.content).toContain('взрыв');
  });

  it('неизвестный тул → ошибка-как-результат', async () => {
    const resolver = new RegistryToolResolver(1000);
    const msg = await resolver.resolve(tc('1', 'nope', {}));
    expect(msg.content).toContain('Тул не найден: nope');
  });

  it('невалидные args → ошибка-как-результат', async () => {
    registerTool({
      name: 'ok',
      description: 'ok',
      inputSchema: { type: 'object' },
      handler: async () => 'done',
    });
    const resolver = new RegistryToolResolver(1000);
    const msg = await resolver.resolve(tc('1', 'ok', null, '{bad json'));
    expect(msg.content).toContain('Невалидные аргументы');
    const msg2 = await resolver.resolve(tc('2', 'ok', null, ''));
    expect(msg2.content).toContain('Невалидные аргументы');
  });
});

describe('runToolLoop', () => {
  beforeEach(() => resetTools());

  it('финал-текст без вызовов → 1 итерация, truncated:false', async () => {
    const { client } = mockClient([finalResult('Готов.')]);
    const messages = [{ role: 'user' as const, content: 'hi' }];
    const res = await runToolLoop({
      client,
      messages,
      maxIterations: 5,
      maxToolResultChars: 1000,
    });
    expect(res.content).toBe('Готов.');
    expect(res.iterations).toBe(1);
    expect(res.truncated).toBe(false);
    expect(res.toolCalls).toHaveLength(0);
  });

  it('один tool_call → результат → финал (2 итерации)', async () => {
    registerTool({
      name: 'echo',
      description: 'echo',
      inputSchema: { type: 'object' },
      handler: async (a) => a,
    });
    const { client, requests } = mockClient([
      { content: '', toolCalls: [tc('c1', 'echo', { v: 9 })] },
      finalResult('Готов после тулa.'),
    ]);
    const messages = [{ role: 'user' as const, content: 'hi' }];
    const res = await runToolLoop({
      client,
      messages,
      maxIterations: 5,
      maxToolResultChars: 1000,
    });
    expect(res.iterations).toBe(2);
    expect(res.truncated).toBe(false);
    expect(res.content).toBe('Готов после тулa.');
    expect(res.toolCalls).toHaveLength(1);
    // второй запрос содержит user + assistant(tool_calls) + tool(результат)
    expect(requests[1]?.messagesCount).toBe(3);
    // loop дописал assistant(tool_calls) + tool(результат): user + assistant + tool
    expect(messages.length).toBe(3);
  });

  it('несколько tool_calls в одном ответе → все исполнены', async () => {
    registerTool({
      name: 'echo',
      description: 'echo',
      inputSchema: { type: 'object' },
      handler: async (a) => a,
    });
    const { client } = mockClient([
      {
        content: '',
        toolCalls: [tc('c1', 'echo', { v: 1 }), tc('c2', 'echo', { v: 2 })],
      },
      finalResult('Готов после двух тулов.'),
    ]);
    const messages = [{ role: 'user' as const, content: 'hi' }];
    const res = await runToolLoop({
      client,
      messages,
      maxIterations: 5,
      maxToolResultChars: 1000,
    });
    expect(res.toolCalls).toHaveLength(2);
    expect(messages.filter((m: ChatMessage) => m.role === 'tool')).toHaveLength(2);
    expect(res.content).toBe('Готов после двух тулов.');
  });

  it('исчерпание итераций → truncated:true', async () => {
    registerTool({
      name: 'echo',
      description: 'echo',
      inputSchema: { type: 'object' },
      handler: async (a) => a,
    });
    // модель всегда зовёт тул, никогда не финализирует
    const { client } = mockClient([
      { content: '', toolCalls: [tc('c1', 'echo', {})] },
    ]);
    const messages = [{ role: 'user' as const, content: 'hi' }];
    const res = await runToolLoop({
      client,
      messages,
      maxIterations: 2,
      maxToolResultChars: 1000,
    });
    expect(res.truncated).toBe(true);
    expect(res.iterations).toBe(2);
  });
});

describe('Subagent / createDelegateTool', () => {
  it('делегирует зарегистрированному субагенту', async () => {
    const registry = new SubagentRegistry();
    const calls: string[] = [];
    registry.register({
      name: 'analyzer',
      description: 'анализ',
      run: async (input) => {
        calls.push(input);
        return `результат анализа: ${input}`;
      },
    });
    const tool = createDelegateTool(registry);
    const out = await tool.handler({ subagent: 'analyzer', instruction: 'письмо X' });
    expect(calls).toEqual(['письмо X']);
    expect(out).toBe('результат анализа: письмо X');
  });

  it('неизвестный субагент → ошибка-строка без throw', async () => {
    const registry = new SubagentRegistry();
    const tool = createDelegateTool(registry);
    await expect(tool.handler({ subagent: 'nope', instruction: 'x' })).resolves.toContain(
      'Субагент не найден: nope',
    );
  });

  it('пустой реестр → hasAny=false', () => {
    expect(new SubagentRegistry().hasAny()).toBe(false);
  });
});

describe('Orchestrator', () => {
  beforeEach(() => resetTools());

  it('системный промпт первым сообщением; контекст между репликами', async () => {
    const { client, requests } = mockClient([finalResult('отв1'), finalResult('отв2')]);
    const orch = await Orchestrator.create({
      client,
      config: makeConfig(),
      skill: 'Ты оркестратор.',
    });

    const r1 = await orch.run('hello');
    expect(r1.content).toBe('отв1');
    expect(r1.truncated).toBe(false);

    const r2 = await orch.run('ещё вопрос');
    expect(r2.content).toBe('отв2');

    const history = orch.getHistory();
    expect(history[0]?.role).toBe('system');
    expect(history[0]?.content).toBe('Ты оркестратор.');
    // второй запрос помнит первую реплику: system + user1 + assistant1 + user2
    expect(requests[1]?.messagesCount).toBe(4);
  });

  it('без субагентов набор тулов не содержит delegate', async () => {
    const { client } = mockClient([finalResult('ок')]);
    const orch = await Orchestrator.create({
      client,
      config: makeConfig(),
      skill: 's',
    });
    await orch.run('hi');
    expect(orch.getOpenAiTools().some((t) => t.function.name === 'delegate')).toBe(false);
  });

  it('со субагентом набор тулов содержит delegate', async () => {
    const { client } = mockClient([finalResult('ок')]);
    const orch = await Orchestrator.create({
      client,
      config: makeConfig(),
      skill: 's',
      subagents: [{ name: 'analyzer', description: 'анализ', run: async () => 'ok' }],
    });
    await orch.run('hi');
    expect(orch.getOpenAiTools().some((t) => t.function.name === 'delegate')).toBe(true);
  });

  it('делегирование в цикле: вызов delegate → ответ субагента в role:tool → финал', async () => {
    const { client } = mockClient([
      {
        content: '',
        toolCalls: [
          {
            id: 'd1',
            name: 'delegate',
            arguments: '{"subagent":"analyzer","instruction":"самми"}',
            args: { subagent: 'analyzer', instruction: 'самми' },
          },
        ],
      },
      finalResult('Итог по анализу.'),
    ]);
    const received: string[] = [];
    const orch = await Orchestrator.create({
      client,
      config: makeConfig({ AGENT_MAX_ITERATIONS: 5, AGENT_MAX_TOOL_RESULT_CHARS: 1000 }),
      skill: 's',
      subagents: [
        {
          name: 'analyzer',
          description: 'анализ',
          run: async (input) => {
            received.push(input);
            return 'анализ готов';
          },
        },
      ],
    });
    const res = await orch.run('проанализируй');
    expect(received).toEqual(['самми']);
    expect(res.iterations).toBe(2);
    expect(res.content).toBe('Итог по анализу.');
    const history = orch.getHistory();
    const toolContent = history.find((m) => m.role === 'tool');
    expect(toolContent?.content).toBe('анализ готов');
  });
});