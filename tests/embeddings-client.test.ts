import { describe, it, expect, vi } from 'vitest';
import { EmbeddingsClient, embeddingsResponseSchema } from '../src/llm/embeddings.js';
import { RouterAiError } from '../src/llm/types.js';
import type { Config } from '../src/config/schema.js';

/** Конфиг с короткими таймаутами/ретраями для тестов (паттерн llm-client.test.ts). */
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
    AGENT_MAX_ITERATIONS: 10,
    AGENT_MAX_TOOL_RESULT_CHARS: 20000,
    ...overrides,
  };
}

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function responseFactory(
  spec:
    | Array<{ status: number; body: unknown; headers?: Record<string, string> }>
    | ((i: number) => { status: number; body: unknown; headers?: Record<string, string> }),
): { fetch: ReturnType<typeof vi.fn>; calls: Array<{ url: string; init: RequestInit }> } {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const list = Array.isArray(spec) ? spec : null;
  const fn = !Array.isArray(spec) ? spec : null;
  let i = 0;
  const fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: url.toString(), init: init ?? {} });
    const s = list
      ? list[Math.min(i, list.length - 1)]
      : (fn as (i: number) => { status: number; body: unknown; headers?: Record<string, string> })(i);
    i++;
    return jsonResponse(s.status, s.body, s.headers);
  }) as unknown as ReturnType<typeof vi.fn>;
  return { fetch, calls };
}

/** Эталонный вектор длины 4 ( размерность произвольна для тестов схемы). */
function vec(n: number): number[] {
  return Array.from({ length: n }, (_, k) => k / 100);
}

describe('embeddingsResponseSchema', () => {
  it('принимает валидный ответ с data', () => {
    const ok = embeddingsResponseSchema.safeParse({
      data: [{ embedding: [0.1, 0.2], index: 0 }],
    });
    expect(ok.success).toBe(true);
  });

  it('отвергает ответ без data', () => {
    const bad = embeddingsResponseSchema.safeParse({});
    expect(bad.success).toBe(false);
  });

  it('отвергает пустой data', () => {
    const bad = embeddingsResponseSchema.safeParse({ data: [] });
    expect(bad.success).toBe(false);
  });
});

describe('EmbeddingsClient.embed', () => {
  it('возвращает number[][] длины, равной числу текстов', async () => {
    const { fetch, calls } = responseFactory([
      {
        status: 200,
        body: {
          data: [
            { embedding: vec(4), index: 0 },
            { embedding: vec(4), index: 1 },
          ],
        },
      },
    ]);
    const client = new EmbeddingsClient({ config: makeConfig(), fetch });

    const out = await client.embed(['первый текст', 'второй текст']);

    expect(out).toHaveLength(2);
    expect(out[0]).toHaveLength(4);
    expect(out[1]).toHaveLength(4);
    expect(fetch).toHaveBeenCalledTimes(1);
    void calls;
  });

  it('тело запроса содержит model из EMBEDDINGS_MODEL', async () => {
    const { fetch, calls } = responseFactory([
      { status: 200, body: { data: [{ embedding: vec(3), index: 0 }] } },
    ]);
    const client = new EmbeddingsClient({
      config: makeConfig({ EMBEDDINGS_MODEL: 'custom/emb-model' }),
      fetch,
    });

    await client.embed(['x']);

    const body = JSON.parse(String(calls[0]?.init?.body));
    expect(body.model).toBe('custom/emb-model');
    expect(body.input).toEqual(['x']);
  });

  it('повторяет на 429 и succeeds на 2-й попытке', async () => {
    const { fetch } = responseFactory([
      { status: 429, body: { error: 'rate limit' } },
      {
        status: 200,
        body: { data: [{ embedding: vec(2), index: 0 }] },
      },
    ]);
    const client = new EmbeddingsClient({
      config: makeConfig({ LLM_RETRY_BASE_MS: 1 }),
      fetch,
    });

    const out = await client.embed(['q']);

    expect(out).toHaveLength(1);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('исчерпание ретраев на 500 возвращает ошибку без выброса наружу', async () => {
    const { fetch } = responseFactory([
      { status: 500, body: { error: { message: 'internal error' } } },
    ]);
    const client = new EmbeddingsClient({
      config: makeConfig({ LLM_RETRIES: 0, LLM_RETRY_BASE_MS: 1 }),
      fetch,
    });

    await expect(client.embed(['q'])).rejects.toThrow(RouterAiError);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('malformed JSON возвращает ошибку парсинга', async () => {
    const fetch = (async () =>
      new Response('{не json', { status: 200, headers: { 'content-type': 'application/json' } })) as typeof globalThis.fetch;
    const client = new EmbeddingsClient({ config: makeConfig(), fetch });

    await expect(client.embed(['q'])).rejects.toThrow(/JSON/i);
  });

  it('не включает API-ключ в сообщение об ошибке (redact)', async () => {
    const { fetch } = responseFactory([
      { status: 401, body: { error: { message: 'invalid secret-key-123' } } },
    ]);
    const client = new EmbeddingsClient({
      config: makeConfig({ LLM_RETRIES: 0 }),
      fetch,
    });

    await expect(client.embed(['q'])).rejects.toThrow();
    try {
      await client.embed(['q']);
    } catch (err) {
      expect(err instanceof Error ? err.message : String(err)).not.toContain('secret-key-123');
    }
  });

  it('пустой texts возвращает [] без запроса', async () => {
    let called = 0;
    const fetch = (async () => {
      called++;
      return new Response('{}', { status: 200 });
    }) as typeof globalThis.fetch;
    const client = new EmbeddingsClient({ config: makeConfig(), fetch });

    const out = await client.embed([]);

    expect(out).toEqual([]);
    expect(called).toBe(0);
  });
});