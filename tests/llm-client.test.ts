import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RouterAiClient, redactKey, parseToolCallArguments } from '../src/llm/routerai-client.js';
import { RouterAiError } from '../src/llm/types.js';
import type { Config } from '../src/config/schema.js';
import { mapToolsToOpenAi } from '../src/llm/tool-mapping.js';
import type { ToolDef } from '../src/tools/registry.js';

/** Конфиг с короткими таймаутами/ретраями для тестов. */
function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    ROUTERAI_API_KEY: 'secret-key-123',
    ROUTERAI_BASE_URL: 'https://routerai.ru/api/v1',
    MODEL_ORCHESTRATOR: 'z-ai/glm-5.2',
    MODEL_ANALYZER: 'z-ai/glm-5.2',
    MODEL_HELPER: 'z-ai/glm-5.3-flash',
    EMBEDDINGS_MODEL: 'baai/bge-m3',
    LLM_REQUEST_TIMEOUT_MS: 5000,
    LLM_RETRIES: 3,
    LLM_RETRY_BASE_MS: 1, // минимум для быстрых тестов
    FALKORDB_HOST: 'localhost',
    FALKORDB_PORT: 6380,
    FALKORDB_PASSWORD: '',
    ACCOUNTS: '[]',
    DOWNLOAD_DIR: './downloads',
    MS_CLIENT_ID: '',
    MS_TENANT: 'consumers',
    OAUTH_TOKEN_STORE_PATH: './.tokens/oauth.json',
    ...overrides,
  };
}

/** Создаёт Response-подобный объект без зависимости от реального fetch. */
function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

/** Фабрика ответов: каждый вызов fetch создаёт свежий Response (тело читается один раз). */
function responseFactory(
  spec:
    | Array<{ status: number; body: unknown; headers?: Record<string, string> }>
    | ((i: number) => { status: number; body: unknown; headers?: Record<string, string> }),
): { fetch: typeof globalThis.fetch; calls: Array<{ url: string; init: RequestInit }> } {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const list = Array.isArray(spec) ? spec : null;
  const fn = !Array.isArray(spec) ? spec : null;
  let i = 0;
  const fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: url.toString(), init: init ?? {} });
    const s = list
      ? list[Math.min(i, list.length - 1)]
      : (fn as (i: number) => { status: number; body: unknown; headers?: Record<string, string> })(i);
    i++;
    return jsonResponse(s.status, s.body, s.headers);
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

describe('redactKey', () => {
  it('заменяяет вхождение ключа на маркер', () => {
    const out = redactKey('err with key=secret-key-123 here', 'secret-key-123');
    expect(out).not.toContain('secret-key-123');
    expect(out).toContain('[REDACTED]');
  });

  it('не ломается при пустом ключе', () => {
    expect(redactKey('plain', '')).toBe('plain');
    expect(redactKey('plain', undefined)).toBe('plain');
  });

  it('экранирует regex-спецсимволы в ключе', () => {
    const out = redactKey('key=a.b*c', 'a.b*c');
    expect(out).not.toContain('a.b*c');
  });
});

describe('parseToolCallArguments', () => {
  it('парсит валидный JSON', () => {
    const { args, parseError } = parseToolCallArguments('{"x":1}');
    expect(args).toEqual({ x: 1 });
    expect(parseError).toBeUndefined();
  });

  it('возвращает ошибку для невалидного JSON, не выбрасывая', () => {
    const { args, parseError } = parseToolCallArguments('{not json');
    expect(args).toBeNull();
    expect(parseError).toBeTruthy();
  });

  it('пустая строка → null с ошибкой', () => {
    const { args, parseError } = parseToolCallArguments('');
    expect(args).toBeNull();
    expect(parseError).toBeTruthy();
  });
});

describe('RouterAiClient.chat — успешные ответы', () => {
  it('возвращает текстовый ответ ассистента', async () => {
    const { fetch, calls } = responseFactory([
      {
        status: 200,
        body: {
          choices: [{ message: { role: 'assistant', content: 'Готов.' } }],
          model: 'z-ai/glm-5.3-flash',
          usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 },
        },
      },
    ]);
    const client = new RouterAiClient({ config: makeConfig(), fetch });

    const result = await client.chat({ messages: [{ role: 'user', content: 'ping' }] });

    expect(result.content).toBe('Готов.');
    expect(result.toolCalls).toEqual([]);
    expect(result.usage?.totalTokens).toBe(4);
    expect(result.model).toBe('z-ai/glm-5.3-flash');
    // URL и заголовки
    expect(calls[0]?.url).toBe('https://routerai.ru/api/v1/chat/completions');
    const headers = new Headers(calls[0]?.init.headers);
    expect(headers.get('authorization')).toBe('Bearer secret-key-123');
    expect(headers.get('content-type')).toBe('application/json');
  });

  it('парсит tool_calls (v1) и возвращает ToolCall[] с доменным именем', async () => {
    const { fetch } = responseFactory([
      {
        status: 200,
        body: {
          choices: [
            {
              message: {
                role: 'assistant',
                content: null,
                tool_calls: [
                  {
                    id: 'call_42',
                    type: 'function',
                    function: {
                      name: 'mail_search',
                      arguments: '{"login":"a@yandex.com"}',
                    },
                  },
                ],
              },
            },
          ],
        },
      },
    ]);
    const client = new RouterAiClient({ config: makeConfig(), fetch });

    const result = await client.chat({ messages: [{ role: 'user', content: 'find mail' }] });

    expect(result.toolCalls).toHaveLength(1);
    const tc = result.toolCalls[0];
    expect(tc?.id).toBe('call_42');
    // подчёркивание → точка (доменное имя)
    expect(tc?.name).toBe('mail.search');
    expect(tc?.arguments).toBe('{"login":"a@yandex.com"}');
    expect(tc?.args).toEqual({ login: 'a@yandex.com' });
    expect(tc?.parseError).toBeUndefined();
  });

  it('нормализует legacy function_call к одному вызову', async () => {
    const { fetch } = responseFactory([
      {
        status: 200,
        body: {
          choices: [
            {
              message: {
                role: 'assistant',
                content: '',
                function_call: { name: 'mail_search', arguments: '{}' },
              },
            },
          ],
        },
      },
    ]);
    const client = new RouterAiClient({ config: makeConfig(), fetch });

    const result = await client.chat({ messages: [{ role: 'user', content: 'go' }] });
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]?.name).toBe('mail.search');
    // id legacy генерируется до конвертации имени — остаётся с подчёркиванием
    expect(result.toolCalls[0]?.id).toBe('legacy_mail_search');
  });

  it('невалидный JSON аргументов вызова не роняет запрос', async () => {
    const { fetch } = responseFactory([
      {
        status: 200,
        body: {
          choices: [
            {
              message: {
                role: 'assistant',
                content: null,
                tool_calls: [
                  {
                    id: 'c1',
                    type: 'function',
                    function: { name: 'mail_search', arguments: '{broken' },
                  },
                ],
              },
            },
          ],
        },
      },
    ]);
    const client = new RouterAiClient({ config: makeConfig(), fetch });

    const result = await client.chat({ messages: [{ role: 'user', content: 'go' }] });
    expect(result.toolCalls[0]?.args).toBeNull();
    expect(result.toolCalls[0]?.parseError).toBeTruthy();
  });
});

describe('RouterAiClient.chat — ошибки ответа', () => {
  it('malformed JSON ответа → RouterAiError без ретрая', async () => {
    let calls = 0;
    const fetch = (async () => {
      calls++;
      return new Response('not-json', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof globalThis.fetch;
    const client = new RouterAiClient({ config: makeConfig({ LLM_RETRIES: 3 }), fetch });

    await expect(client.chat({ messages: [{ role: 'user', content: 'x' }] })).rejects.toThrow(
      /валидным JSON/i,
    );
    // malformed-ответ → ошибка парсинга, не ретраится (бросается в readBody)
    expect(calls).toBe(1);
  });

  it('пустой choices → RouterAiError', async () => {
    const { fetch } = responseFactory([{ status: 200, body: { choices: [] } }]);
    const client = new RouterAiClient({ config: makeConfig(), fetch });

    await expect(client.chat({ messages: [{ role: 'user', content: 'x' }] })).rejects.toThrow(
      /неожиданная структура|структура ответа/i,
    );
  });

  it('401 → RouterAiError без ретрая и без раскрытия ключа', async () => {
    let calls = 0;
    const fetch = (async () => {
      calls++;
      return jsonResponse(401, { error: { message: 'invalid key=secret-key-123' } });
    }) as typeof globalThis.fetch;
    const client = new RouterAiClient({ config: makeConfig({ LLM_RETRIES: 3 }), fetch });

    await expect(client.chat({ messages: [{ role: 'user', content: 'x' }] })).rejects.toThrow(
      RouterAiError,
    );
    // только один вызов — ретраев не было
    expect(calls).toBe(1);
    // ключ не фигурирует в сообщении об ошибке (отдельный запрос для проверки текста)
    let errMessage = '';
    try {
      await client.chat({ messages: [{ role: 'user', content: 'x' }] });
    } catch (e) {
      errMessage = e instanceof Error ? e.message : String(e);
    }
    expect(errMessage).toMatch(/HTTP 401/);
    expect(errMessage).not.toContain('secret-key-123');
  });
});

describe('RouterAiClient.chat — ретраи', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('429 → успех на 2-й попытке', async () => {
    const { fetch, calls } = responseFactory([
      { status: 429, body: { error: { message: 'rate limit' } }, headers: { 'retry-after': '0' } },
      { status: 200, body: { choices: [{ message: { role: 'assistant', content: 'ok' } }] } },
    ]);
    const client = new RouterAiClient({
      config: makeConfig({ LLM_RETRIES: 3, LLM_RETRY_BASE_MS: 1 }),
      fetch,
    });

    const promise = client.chat({ messages: [{ role: 'user', content: 'x' }] });
    // Привязываем обработчик сразу, чтобы избежать unhandled-rejection между тактами.
    const settled = promise.then(
      (r) => r,
      () => undefined,
    );
    await vi.runAllTimersAsync();
    const result = await settled;

    expect(result?.content).toBe('ok');
    expect(calls).toHaveLength(2);
  });

  it('500 × (RETRIES+1) → ошибка после исчерпания попыток', async () => {
    const { fetch, calls } = responseFactory([
      { status: 500, body: { error: { message: 'boom' } } },
      { status: 500, body: { error: { message: 'boom' } } },
      { status: 500, body: { error: { message: 'boom' } } },
      { status: 500, body: { error: { message: 'boom' } } },
    ]);
    const client = new RouterAiClient({
      config: makeConfig({ LLM_RETRIES: 3, LLM_RETRY_BASE_MS: 1 }),
      fetch,
    });

    const promise = client.chat({ messages: [{ role: 'user', content: 'x' }] });
    // Привязываем обработчик rejection сразу.
    const settled = promise.then(
      () => undefined,
      (e) => e,
    );
    await vi.runAllTimersAsync();
    const err = await settled;

    expect(err).toBeInstanceOf(RouterAiError);
    expect((err as Error).message).toMatch(/HTTP 500/);
    // 1 исходный + 3 ретрая = 4
    expect(calls).toHaveLength(4);
  });

  it('400 → ошибка без ретрая', async () => {
    let calls = 0;
    const fetch = (async () => {
      calls++;
      return jsonResponse(400, { error: { message: 'bad request' } });
    }) as typeof globalThis.fetch;
    const client = new RouterAiClient({ config: makeConfig({ LLM_RETRIES: 3 }), fetch });

    await expect(client.chat({ messages: [{ role: 'user', content: 'x' }] })).rejects.toThrow(
      /HTTP 400/,
    );
    expect(calls).toBe(1);
  });
});

describe('RouterAiClient.chat — параметры запроса', () => {
  it('передаёт temperature/max_tokens/top_p в теле', async () => {
    const { fetch, calls } = responseFactory([
      { status: 200, body: { choices: [{ message: { role: 'assistant', content: 'ok' } }] } },
    ]);
    const client = new RouterAiClient({ config: makeConfig(), fetch });

    await client.chat({
      messages: [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'hi' },
      ],
      temperature: 0.2,
      maxTokens: 128,
      topP: 0.9,
    });

    const body = JSON.parse(String(calls[0]?.init.body)) as Record<string, unknown>;
    expect(body['temperature']).toBe(0.2);
    expect(body['max_tokens']).toBe(128);
    expect(body['top_p']).toBe(0.9);
    // системный промпт дошёл первым сообщением
    const messages = body['messages'] as Array<{ role: string; content: string }>;
    expect(messages[0]?.role).toBe('system');
    expect(messages[0]?.content).toBe('sys');
    expect(messages[1]?.role).toBe('user');
  });

  it('role helper выбирает MODEL_HELPER; явный model переопределяет', async () => {
    const { fetch, calls } = responseFactory([
      { status: 200, body: { choices: [{ message: { role: 'assistant', content: 'ok' } }] } },
    ]);
    const client = new RouterAiClient({ config: makeConfig(), fetch });

    await client.chat({ role: 'helper', messages: [{ role: 'user', content: 'x' }] });
    let body = JSON.parse(String(calls[0]?.init.body)) as Record<string, unknown>;
    expect(body['model']).toBe('z-ai/glm-5.3-flash');

    // явный model
    const { fetch: f2, calls: c2 } = responseFactory([
      { status: 200, body: { choices: [{ message: { role: 'assistant', content: 'ok' } }] } },
    ]);
    const client2 = new RouterAiClient({ config: makeConfig(), fetch: f2 });
    await client2.chat({
      role: 'helper',
      model: 'z-ai/glm-5.2',
      messages: [{ role: 'user', content: 'x' }],
    });
    body = JSON.parse(String(c2[0]?.init.body)) as Record<string, unknown>;
    expect(body['model']).toBe('z-ai/glm-5.2');
  });

  it('tools из mapToolsToOpenAi и tool_choice по имени функции сериализуются', async () => {
    const tool: ToolDef = {
      name: 'mail.search',
      description: 'поиск',
      inputSchema: { type: 'object', properties: { login: { type: 'string' } }, required: ['login'] },
      handler: async () => undefined,
    };
    const { fetch, calls } = responseFactory([
      { status: 200, body: { choices: [{ message: { role: 'assistant', content: 'ok' } }] } },
    ]);
    const client = new RouterAiClient({ config: makeConfig(), fetch });

    await client.chat({
      messages: [{ role: 'user', content: 'find' }],
      tools: mapToolsToOpenAi([tool]),
      toolChoice: { type: 'function', function: { name: 'mail.search' } },
    });

    const body = JSON.parse(String(calls[0]?.init.body)) as Record<string, unknown>;
    const tools = body['tools'] as Array<{ type: string; function: { name: string } }>;
    expect(tools[0]?.function.name).toBe('mail_search');
    const tc = body['tool_choice'] as { type: string; function: { name: string } };
    expect(tc.function.name).toBe('mail_search');
  });
});
