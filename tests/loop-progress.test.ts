import { describe, it, expect, beforeEach } from 'vitest';
import { runToolLoop } from '../src/agents/loop.js';
import { resetTools, registerTool } from '../src/tools/registry.js';
import { loadConfig } from '../src/config/loader.js';
import type { RouterAiClient } from '../src/llm/routerai-client.js';
import type { ChatResult, ToolCall, ToolProgressEvent } from '../src/llm/types.js';
import type { Config } from '../src/config/schema.js';

/** Конфиг с малым лимитом итераций для теста усечения. */
function makeConfig(overrides: Partial<Config> = {}): Config {
  const base = loadConfig({ ROUTERAI_API_KEY: 'test-key' });
  return {
    ...base,
    AGENT_MAX_ITERATIONS: 2,
    AGENT_MAX_TOOL_RESULT_CHARS: 50,
    ...overrides,
  };
}

/** Мок клиента: выдаёт результаты по очереди. */
function mockClient(results: ChatResult[]): RouterAiClient {
  let i = 0;
  return {
    chat: async (): Promise<ChatResult> => {
      const r = results[Math.min(i, results.length - 1)] as ChatResult;
      i++;
      return r;
    },
  } as unknown as RouterAiClient;
}

function tc(id: string, name: string, argsObj: unknown): ToolCall {
  const raw = JSON.stringify(argsObj);
  return { id, name, arguments: raw, args: JSON.parse(raw) };
}

const finalResult = (content: string): ChatResult => ({ content, toolCalls: [] });
const callResult = (toolCalls: ToolCall[], content = ''): ChatResult => ({
  content,
  toolCalls,
});

describe('runToolLoop: события прогресса (onToolEvent)', () => {
  beforeEach(() => resetTools());

  it('испускает toolCall + toolResult по каждому тулу', async () => {
    registerTool({
      name: 'echo',
      description: 'эхо',
      inputSchema: { type: 'object', properties: {}, required: [] },
      handler: async () => 'ok-результат',
    });

    const config = makeConfig({ AGENT_MAX_ITERATIONS: 3 });
    const client = mockClient([
      callResult([tc('1', 'echo', { x: 1 })]),
      finalResult('готово'),
    ]);
    const events: ToolProgressEvent[] = [];

    const result = await runToolLoop({
      client,
      messages: [{ role: 'system', content: 'sys' }, { role: 'user', content: 'hi' }],
      tools: [],
      maxIterations: config.AGENT_MAX_ITERATIONS,
      maxToolResultChars: config.AGENT_MAX_TOOL_RESULT_CHARS,
      role: 'orchestrator',
      onToolEvent: (e) => events.push(e),
    });

    expect(result.content).toBe('готово');
    expect(result.truncated).toBe(false);

    // Два события: toolCall (итерация 0) + toolResult (итерация 0, ok).
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      type: 'toolCall',
      iteration: 0,
      toolCall: { name: 'echo', id: '1' },
    });
    expect(events[1]).toMatchObject({
      type: 'toolResult',
      iteration: 0,
      toolCallId: '1',
      toolName: 'echo',
      ok: true,
    });
    expect((events[1] as { summary: string }).summary).toBe('ok-результат');
  });

  it('испускает toolResult с ok=false при ошибке тулa', async () => {
    registerTool({
      name: 'boom',
      description: 'падающий тул',
      inputSchema: { type: 'object', properties: {}, required: [] },
      handler: async () => {
        throw new Error('взрыв');
      },
    });

    const config = makeConfig({ AGENT_MAX_ITERATIONS: 3 });
    const client = mockClient([
      callResult([tc('2', 'boom', {})]),
      finalResult('после ошибки'),
    ]);
    const events: ToolProgressEvent[] = [];

    await runToolLoop({
      client,
      messages: [{ role: 'system', content: 'sys' }, { role: 'user', content: 'go' }],
      tools: [],
      maxIterations: config.AGENT_MAX_ITERATIONS,
      maxToolResultChars: config.AGENT_MAX_TOOL_RESULT_CHARS,
      onToolEvent: (e) => events.push(e),
    });

    const resultEvent = events.find((e) => e.type === 'toolResult');
    expect(resultEvent).toBeDefined();
    expect(resultEvent).toMatchObject({ type: 'toolResult', ok: false, toolName: 'boom' });
  });

  it('испускает truncated при достижении лимита итераций', async () => {
    registerTool({
      name: 'loop',
      description: 'бесконечный тул',
      inputSchema: { type: 'object', properties: {}, required: [] },
      handler: async () => 'again',
    });

    const config = makeConfig({ AGENT_MAX_ITERATIONS: 2 });
    // Каждая итерация вызывает тул — лимит достигается.
    const client = mockClient([
      callResult([tc('3', 'loop', {})]),
      callResult([tc('4', 'loop', {})]),
    ]);
    const events: ToolProgressEvent[] = [];

    const result = await runToolLoop({
      client,
      messages: [{ role: 'system', content: 'sys' }, { role: 'user', content: 'loop' }],
      tools: [],
      maxIterations: config.AGENT_MAX_ITERATIONS,
      maxToolResultChars: config.AGENT_MAX_TOOL_RESULT_CHARS,
      onToolEvent: (e) => events.push(e),
    });

    expect(result.truncated).toBe(true);
    expect(events.some((e) => e.type === 'truncated')).toBe(true);
    const trunc = events.find((e) => e.type === 'truncated');
    expect(trunc).toMatchObject({ type: 'truncated', iterations: 2 });
  });

  it('без onToolEvent результат идентичен (нет новых вызовов)', async () => {
    registerTool({
      name: 'plain',
      description: 'простой тул',
      inputSchema: { type: 'object', properties: {}, required: [] },
      handler: async () => 'plain-result',
    });

    const config = makeConfig({ AGENT_MAX_ITERATIONS: 3 });
    const client = mockClient([
      callResult([tc('5', 'plain', {})]),
      finalResult('done'),
    ]);

    const result = await runToolLoop({
      client,
      messages: [{ role: 'system', content: 'sys' }, { role: 'user', content: 'x' }],
      tools: [],
      maxIterations: config.AGENT_MAX_ITERATIONS,
      maxToolResultChars: config.AGENT_MAX_TOOL_RESULT_CHARS,
    });

    expect(result.content).toBe('done');
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].name).toBe('plain');
    expect(result.truncated).toBe(false);
    expect(result.iterations).toBe(2);
  });

  it('summary результата усекается до лимита', async () => {
    const longResult = 'я'.repeat(500);
    registerTool({
      name: 'big',
      description: 'большой результат',
      inputSchema: { type: 'object', properties: {}, required: [] },
      handler: async () => longResult,
    });

    const config = makeConfig({ AGENT_MAX_ITERATIONS: 3, AGENT_MAX_TOOL_RESULT_CHARS: 50 });
    const client = mockClient([
      callResult([tc('6', 'big', {})]),
      finalResult('ok'),
    ]);
    const events: ToolProgressEvent[] = [];

    await runToolLoop({
      client,
      messages: [{ role: 'system', content: 'sys' }, { role: 'user', content: 'big' }],
      tools: [],
      maxIterations: config.AGENT_MAX_ITERATIONS,
      maxToolResultChars: config.AGENT_MAX_TOOL_RESULT_CHARS,
      onToolEvent: (e) => events.push(e),
    });

    const resultEvent = events.find((e) => e.type === 'toolResult') as {
      summary: string;
    } | undefined;
    expect(resultEvent).toBeDefined();
    // PROGRESS_SUMMARY_CHARS = 200, summary не длиннее 201 (200 + '…').
    expect(resultEvent?.summary.length).toBeLessThanOrEqual(201);
  });
});
