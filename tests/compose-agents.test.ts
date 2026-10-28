import { describe, it, expect, beforeEach } from 'vitest';
import { composeAgents } from '../src/agents/compose.js';
import { resetTools } from '../src/tools/registry.js';
import { loadConfig } from '../src/config/loader.js';
import type { RouterAiClient } from '../src/llm/routerai-client.js';
import type { ChatResult } from '../src/llm/types.js';
import type { Config } from '../src/config/schema.js';

/** Конфиг с короткими задержками/лимитами для тестов. */
function makeConfig(overrides: Partial<Config> = {}): Config {
  const base = loadConfig({ ROUTERAI_API_KEY: 'test-key' });
  return {
    ...base,
    LLM_REQUEST_TIMEOUT_MS: 5000,
    LLM_RETRIES: 3,
    LLM_RETRY_BASE_MS: 1,
    AGENT_MAX_ITERATIONS: 5,
    AGENT_MAX_TOOL_RESULT_CHARS: 1000,
    ...overrides,
  };
}

/** Мок RouterAiClient: всегда возвращает финальный текст без тулов. */
function mockClient(): RouterAiClient {
  return {
    chat: async (): Promise<ChatResult> => ({ content: 'ок', toolCalls: [] }),
  } as unknown as RouterAiClient;
}

describe('composeAgents (слой сборки)', () => {
  beforeEach(() => resetTools());

  it('строит оркестратор: mail-тулы + delegate в наборе (оба субагента зарегистрированы)', async () => {
    const orch = await composeAgents({
      client: mockClient(),
      config: makeConfig(),
      accounts: [],
    });
    const names = orch.getOpenAiTools().map((t) => t.function.name);
    expect(names).toContain('delegate');
    expect(names).toContain('mail_connect');
    expect(names).toContain('mail_search');
    expect(names).toContain('mail_downloadAttachments');
  });

  it('делегирование helper через composeAgents: delegate → helper.run → финал оркестратора', async () => {
    // Последовательность вызовов chat:
    //   1) цикл оркестратора → tool_call delegate({helper,...})
    //   2) цикл помощника (внутри delegate-обработчика) → финал без тулов
    //   3) цикл оркестратора → финал
    let callNo = 0;
    const scriptedClient = {
      chat: async (): Promise<ChatResult> => {
        callNo++;
        if (callNo === 1) {
          return {
            content: '',
            toolCalls: [
              {
                id: 'd1',
                name: 'delegate',
                arguments: '{"subagent":"helper","instruction":"подключись"}',
                args: { subagent: 'helper', instruction: 'подключись' },
              },
            ],
          };
        }
        if (callNo === 2) {
          // Ответ помощника внутри delegate.
          return { content: 'помощник: подключился к yandex', toolCalls: [] };
        }
        return { content: 'Готово: помощник отчитался.', toolCalls: [] };
      },
    } as unknown as RouterAiClient;

    const orch = await composeAgents({
      client: scriptedClient,
      config: makeConfig(),
      accounts: [],
    });
    const res = await orch.run('Подключись к ящику через помощника.');
    expect(res.iterations).toBe(2);
    expect(res.content).toBe('Готово: помощник отчитался.');
    // Результат делегирования (ответ помощника) попал в историю как role:tool.
    const history = orch.getHistory();
    const toolMsg = history.find((m) => m.role === 'tool');
    expect(toolMsg?.content).toBe('помощник: подключился к yandex');
  });
});