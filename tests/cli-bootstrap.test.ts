import { describe, it, expect, beforeEach } from 'vitest';
import { bootstrap } from '../src/transport/cli/bootstrap.js';
import { resetTools } from '../src/tools/registry.js';

/** Мок fetch для RouterAiClient: возвращает финальный текст без тулов. */
function mockFetch(): typeof globalThis.fetch {
  return (async () =>
    ({
      ok: true,
      status: 200,
      headers: new Map(),
      text: async () =>
        JSON.stringify({
          choices: [
            {
              message: { role: 'assistant', content: 'ок', tool_calls: [] },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 5, completion_tokens: 1, total_tokens: 6 },
        }),
    } as unknown as Response)) as unknown as typeof globalThis.fetch;
}

/** Минимальный env с валидным ключом и пустыми аккаунтами. */
function makeEnv(overrides: Partial<NodeJS.ProcessEnv> = {}): NodeJS.ProcessEnv {
  const base = { ROUTERAI_API_KEY: 'test-key' } as NodeJS.ProcessEnv;
  return { ...base, ...overrides };
}

describe('bootstrap (сборка агента из конфига)', () => {
  beforeEach(() => resetTools());

  it('валидный конфиг → агент собран (оркестратор с delegate + analyzer + accounts)', async () => {
    const { orchestrator, analyzer, accounts, downloadDir } = await bootstrap({
      env: makeEnv(),
      fetch: mockFetch(),
      skipFalkor: true,
    });
    const names = orchestrator.getOpenAiTools().map((t) => t.function.name);
    expect(names).toContain('delegate');
    expect(analyzer).toBeDefined();
    expect(analyzer.name).toBe('analyzer');
    expect(accounts).toEqual([]);
    expect(downloadDir).toBeDefined();
  });

  it('cleanup вызывает disposeAll без ошибок', async () => {
    const { cleanup } = await bootstrap({
      env: makeEnv(),
      fetch: mockFetch(),
      skipFalkor: true,
    });
    await expect(cleanup()).resolves.toBeUndefined();
  });

  it('невалидный конфиг → throw с читаемым сообщением', async () => {
    // Пустой ROUTERAI_API_KEY → zod-ошибка.
    await expect(
      bootstrap({ env: { ROUTERAI_API_KEY: '' } as NodeJS.ProcessEnv, skipFalkor: true }),
    ).rejects.toThrow(/конфигурац|ROUTERAI_API_KEY/i);
  });

  it('некорректный ACCOUNTS JSON → throw', async () => {
    await expect(
      bootstrap({
        env: makeEnv({ ACCOUNTS: '{not-json' }),
        fetch: mockFetch(),
        skipFalkor: true,
      }),
    ).rejects.toThrow(/ACCOUNTS|JSON/i);
  });
});
