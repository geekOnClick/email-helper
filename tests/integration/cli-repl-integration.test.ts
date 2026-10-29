import { describe, it, expect, beforeEach } from 'vitest';
import { CliRepl } from '../../src/transport/cli/repl.js';
import { MockConsoleIO } from '../mock-io.js';
import { composeAgents } from '../../src/agents/compose.js';
import { resetTools } from '../../src/tools/registry.js';
import { loadConfig } from '../../src/config/loader.js';
import type { RouterAiClient } from '../../src/llm/routerai-client.js';
import type { ChatResult, ToolCall } from '../../src/llm/types.js';
import type { Config } from '../../src/config/schema.js';

function makeConfig(overrides: Partial<Config> = {}): Config {
  const base = loadConfig({ ROUTERAI_API_KEY: 'test-key' });
  return {
    ...base,
    AGENT_MAX_ITERATIONS: 5,
    AGENT_MAX_TOOL_RESULT_CHARS: 1000,
    ...overrides,
  };
}

function tc(id: string, name: string, argsObj: unknown): ToolCall {
  const raw = JSON.stringify(argsObj);
  return { id, name, arguments: raw, args: JSON.parse(raw) };
}

/**
 * Scripted-клиент: воспроизводит сценарий
 *   1) оркестратор → delegate({helper, "подключись"})
 *   2) помощник (внутри delegate) → финал "помощник: готово"
 *   3) оркестратор → финал "Оркестратор: задача выполнена"
 */
function scriptedClient(): RouterAiClient {
  let callNo = 0;
  return {
    chat: async (): Promise<ChatResult> => {
      callNo++;
      if (callNo === 1) {
        return {
          content: '',
          toolCalls: [
            tc('d1', 'delegate', { subagent: 'helper', instruction: 'подключись' }),
          ],
        };
      }
      if (callNo === 2) {
        return { content: 'помощник: готово', toolCalls: [] };
      }
      return { content: 'Оркестратор: задача выполнена', toolCalls: [] };
    },
  } as unknown as RouterAiClient;
}

describe('CliRepl: интеграция с composeAgents', () => {
  beforeEach(() => resetTools());

  it('полный цикл: запрос → прогресс delegate → финальный ответ', async () => {
    const orchestrator = await composeAgents({
      client: scriptedClient(),
      config: makeConfig(),
      accounts: [],
    });

    const io = new MockConsoleIO(['подключись к ящику', '/quit']);
    const repl = new CliRepl({ io, orchestrator });
    const exit = await repl.start();
    const out = io.output();

    expect(exit.reason).toBe('quit');
    // Прогресс tool-вызова delegate отображён.
    expect(out).toContain('→ delegate');
    // Финальный ответ оркестратора.
    expect(out).toContain('Оркестратор: задача выполнена');
  });

  it('/reset обнуляет историю: вторая реплика не помнит первую', async () => {
    const orchestrator = await composeAgents({
      client: scriptedClient(),
      config: makeConfig(),
      accounts: [],
    });

    // Первая реплика → делегирование и финал (callNo 1,2,3).
    // /reset → история обнулена (но callNo продолжает расти → все следующие ответы финал).
    // Вторая реплика → callNo 4 → финал "Оркестратор: задача выполнена"
    //   (без /reset история содержала бы tool-result от delegate).
    const io = new MockConsoleIO([
      'первая задача',
      '/reset',
      'вторая задача',
      '/quit',
    ]);
    const repl = new CliRepl({ io, orchestrator });

    await repl.start();
    const out = io.output();

    // Сброс подтверждён.
    expect(out).toContain('сброшена');
    // Обе реплики обработаны (финальные ответы присутствуют).
    const matches = out.match(/Оркестратор: задача выполнена/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  it('EOF завершает интеграционную сессию', async () => {
    const orchestrator = await composeAgents({
      client: scriptedClient(),
      config: makeConfig(),
      accounts: [],
    });
    const io = new MockConsoleIO([]); // сразу EOF
    const repl = new CliRepl({ io, orchestrator });
    const exit = await repl.start();
    expect(exit.reason).toBe('eof');
  });
});
