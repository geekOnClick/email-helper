import { describe, it, expect, vi } from 'vitest';
import { runToolLoop } from '../src/agents/loop.js';
import { noopToolLogger, type ToolLogEvent, type ToolLogger } from '../src/observability/logger.js';
import type { RouterAiClient } from '../src/llm/routerai-client.js';
import type { ChatMessage, ChatResult } from '../src/llm/types.js';

/** Мок LLM-клиента: возвращает последовательность ответов. */
function scriptClient(responses: ChatResult[]): RouterAiClient {
  let i = 0;
  return {
    chat: async (): Promise<ChatResult> => responses[i++] ?? { content: '', toolCalls: [] },
  } as unknown as RouterAiClient;
}

/** Мок-логгер: собирает события. */
function collectingLogger(): ToolLogger & { events: ToolLogEvent[] } {
  const events: ToolLogEvent[] = [];
  return {
    logToolCall: (e: ToolLogEvent) => events.push(e),
    events,
  };
}

/** Регистрирует тул в реестре для теста. */
async function withTool(
  name: string,
  handler: (args: Record<string, unknown>) => Promise<unknown>,
  fn: () => Promise<void>,
): Promise<void> {
  const { resetTools, registerTool } = await import('../src/tools/registry.js');
  resetTools();
  registerTool({
    name,
    description: `test tool ${name}`,
    inputSchema: { type: 'object', properties: {} },
    handler,
  });
  try {
    await fn();
  } finally {
    resetTools();
  }
}

describe('runToolLoop + toolLogger', () => {
  it('логгер вызывается с ok при успешном туле', async () => {
    await withTool('echo', async (args) => ({ result: `echo:${args.value ?? ''}` }), async () => {
      const logger = collectingLogger();
      const client = scriptClient([
        {
          content: '',
          toolCalls: [
            { id: 'c1', name: 'echo', arguments: '{"value":"hi"}', args: { value: 'hi' } },
          ],
        },
        { content: 'готово', toolCalls: [] },
      ]);
      const messages: ChatMessage[] = [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'привет' },
      ];

      await runToolLoop({
        client,
        messages,
        maxIterations: 5,
        maxToolResultChars: 1000,
        toolLogger: logger,
      });

      expect(logger.events).toHaveLength(1);
      expect(logger.events[0].toolName).toBe('echo');
      expect(logger.events[0].status).toBe('ok');
      expect(logger.events[0].durationMs).toBeGreaterThanOrEqual(0);
      expect(logger.events[0].summary).toContain('echo:hi');
    });
  });

  it('логгер вызывается с error при выбросе handler', async () => {
    await withTool(
      'boom',
      async () => {
        throw new Error('взрыв');
      },
      async () => {
        const logger = collectingLogger();
        const client = scriptClient([
          {
            content: '',
            toolCalls: [{ id: 'c1', name: 'boom', arguments: '{}', args: {} }],
          },
          { content: 'ок', toolCalls: [] },
        ]);
        const messages: ChatMessage[] = [
          { role: 'system', content: 'sys' },
          { role: 'user', content: 'привет' },
        ];

        await runToolLoop({
          client,
          messages,
          maxIterations: 5,
          maxToolResultChars: 1000,
          toolLogger: logger,
        });

        expect(logger.events).toHaveLength(1);
        expect(logger.events[0].toolName).toBe('boom');
        expect(logger.events[0].status).toBe('error');
        expect(logger.events[0].summary).toContain('взрыв');
      },
    );
  });

  it('логгер вызывается с error для неизвестного тулa', async () => {
    const logger = collectingLogger();
    const client = scriptClient([
      {
        content: '',
        toolCalls: [{ id: 'c1', name: 'nonexistent', arguments: '{}', args: {} }],
      },
      { content: 'ок', toolCalls: [] },
    ]);
    const messages: ChatMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'привет' },
    ];

    await runToolLoop({
      client,
      messages,
      maxIterations: 5,
      maxToolResultChars: 1000,
      toolLogger: logger,
    });

    expect(logger.events).toHaveLength(1);
    expect(logger.events[0].toolName).toBe('nonexistent');
    expect(logger.events[0].status).toBe('error');
    expect(logger.events[0].summary).toContain('Тул не найден');
  });

  it('логгер вызывается с error для невалидных аргументов', async () => {
    await withTool('echo', async (a) => ({ result: a }), async () => {
      const logger = collectingLogger();
      const client = scriptClient([
        {
          content: '',
          toolCalls: [
            { id: 'c1', name: 'echo', arguments: 'not-json', args: null, parseError: 'Unexpected token' },
          ],
        },
        { content: 'ок', toolCalls: [] },
      ]);
      const messages: ChatMessage[] = [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'привет' },
      ];

      await runToolLoop({
        client,
        messages,
        maxIterations: 5,
        maxToolResultChars: 1000,
        toolLogger: logger,
      });

      expect(logger.events).toHaveLength(1);
      expect(logger.events[0].toolName).toBe('echo');
      expect(logger.events[0].status).toBe('error');
      expect(logger.events[0].summary).toContain('Невалидные аргументы');
    });
  });

  it('без toolLogger (no-op по умолчанию) цикл работает как раньше', async () => {
    await withTool('echo', async (a) => ({ result: a }), async () => {
      const spy = vi.spyOn(noopToolLogger(), 'logToolCall');
      const client = scriptClient([
        {
          content: '',
          toolCalls: [{ id: 'c1', name: 'echo', arguments: '{}', args: {} }],
        },
        { content: 'готово', toolCalls: [] },
      ]);
      const messages: ChatMessage[] = [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'привет' },
      ];

      const result = await runToolLoop({
        client,
        messages,
        maxIterations: 5,
        maxToolResultChars: 1000,
      });

      expect(result.content).toBe('готово');
      spy.mockRestore();
    });
  });

  it('несколько тулов в одной итерации → несколько событий лога', async () => {
    const { resetTools, registerTool } = await import('../src/tools/registry.js');
    resetTools();
    registerTool({
      name: 'a',
      description: 'test tool a',
      inputSchema: { type: 'object', properties: {} },
      handler: async () => ({ result: 'A' }),
    });
    registerTool({
      name: 'b',
      description: 'test tool b',
      inputSchema: { type: 'object', properties: {} },
      handler: async () => ({ result: 'B' }),
    });
    try {
      const logger = collectingLogger();
      const client = scriptClient([
        {
          content: '',
          toolCalls: [
            { id: 'c1', name: 'a', arguments: '{}', args: {} },
            { id: 'c2', name: 'b', arguments: '{}', args: {} },
          ],
        },
        { content: 'ок', toolCalls: [] },
      ]);
      const messages: ChatMessage[] = [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'привет' },
      ];

      await runToolLoop({
        client,
        messages,
        maxIterations: 5,
        maxToolResultChars: 1000,
        toolLogger: logger,
      });

      expect(logger.events).toHaveLength(2);
      expect(logger.events.map((e) => e.toolName)).toEqual(['a', 'b']);
      expect(logger.events.every((e) => e.status === 'ok')).toBe(true);
    } finally {
      resetTools();
    }
  });
});
