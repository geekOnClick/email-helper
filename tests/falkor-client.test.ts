import { describe, it, expect, vi } from 'vitest';
import {
  FalkorClient,
  FalkorError,
  EMBEDDING_DIM,
  type FalkorConnection,
} from '../src/tools/vector/falkor.js';
import type { Config } from '../src/config/schema.js';

/** Конфиг для тестов (порт FalkorDB не важен — соединение мокое). */
function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    ROUTERAI_API_KEY: 'k',
    ROUTERAI_BASE_URL: 'https://routerai.ru/api/v1',
    MODEL_ORCHESTRATOR: 'z-ai/glm-5.2',
    MODEL_ANALYZER: 'z-ai/glm-5.2',
    MODEL_HELPER: 'z-ai/glm-5.3-flash',
    EMBEDDINGS_MODEL: 'baai/bge-m3',
    LLM_REQUEST_TIMEOUT_MS: 5000,
    LLM_RETRIES: 3,
    LLM_RETRY_BASE_MS: 1,
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

/** Мок FalkorConnection: записывает вызовы и возвращает заданный ответ. */
interface MockConnection extends FalkorConnection {
  query: ReturnType<typeof vi.fn>;
  createNodeVectorIndex: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
}

function createMockConnection(opts: {
  queryReply?: GraphReplyLike;
  vectorIndexError?: Error;
} = {}): MockConnection {
  return {
    query: vi.fn(async () => opts.queryReply ?? { data: [], stats: {} }),
    createNodeVectorIndex: vi.fn(async () => {
      if (opts.vectorIndexError) throw opts.vectorIndexError;
      return { stats: {} };
    }),
    close: vi.fn(async () => undefined),
  };
}

/** Минимальный shape GraphReply (как возвращает graph.query). */
type GraphReplyLike = { data?: unknown[]; headers?: string[]; stats: Record<string, unknown> };

/** Удобный вектор размерности EMBEDDING_DIM для тестов. */
function makeVector(n: number = EMBEDDING_DIM): number[] {
  return Array.from({ length: n }, (_, i) => i / n);
}

describe('FalkorClient', () => {
  it('ensureSchema создаёт векторный индекс Email (1024, cosine, embedding)', async () => {
    const conn = createMockConnection();
    const client = new FalkorClient({ config: makeConfig(), connection: conn });

    await client.ensureSchema();

    expect(conn.createNodeVectorIndex).toHaveBeenCalledTimes(1);
    const args = conn.createNodeVectorIndex.mock.calls[0];
    expect(args?.[0]).toBe('Email');
    expect(args?.[1]).toEqual({ dimension: EMBEDDING_DIM, similarityFunction: 'cosine' });
    expect(args?.[2]).toBe('embedding');
  });

  it('connect() с injectable-соединением не зовёт createFalkorConnection и создаёт схему', async () => {
    const conn = createMockConnection();
    const client = new FalkorClient({ config: makeConfig(), connection: conn });

    await client.connect();

    expect(conn.createNodeVectorIndex).toHaveBeenCalledTimes(1);
  });

  it('indexEmail шлёт MERGE с emailId=login:folder:uid и embedding как Float32Array', async () => {
    const conn = createMockConnection();
    const client = new FalkorClient({ config: makeConfig(), connection: conn });
    await client.connect();

    await client.indexEmail({
      emailId: 'a@y.com:INBOX:42',
      login: 'a@y.com',
      folder: 'INBOX',
      uid: 42,
      subject: 'Тема',
      from: 'boss@x.com',
      date: '2026-01-01T00:00:00.000Z',
      snippet: 'Тело…',
      embedding: makeVector(),
    });

    expect(conn.query).toHaveBeenCalledTimes(1);
    const [cypher, params] = conn.query.mock.calls[0] ?? [];
    expect(String(cypher)).toContain('MERGE (e:Email {emailId: $emailId})');
    expect(String(cypher)).toContain('vecf32($embedding)');
    expect(params).toMatchObject({
      emailId: 'a@y.com:INBOX:42',
      login: 'a@y.com',
      folder: 'INBOX',
      uid: 42,
      sender: 'boss@x.com',
    });
    expect(params).toHaveProperty('embedding');
    expect(params['embedding']).toBeInstanceOf(Float32Array);
  });

  it('searchByEmailVector шлёт KNN с vecf32($query), $k и фильтром', async () => {
    const conn = createMockConnection({
      queryReply: {
        data: [
          {
            emailId: 'a@y.com:INBOX:1',
            login: 'a@y.com',
            folder: 'INBOX',
            uid: 1,
            subject: 'S',
            sender: 's@x.com',
            date: '2026-01-02T00:00:00.000Z',
            snippet: 'snip',
            score: 0.95,
          },
        ],
        stats: {},
      },
    });
    const client = new FalkorClient({ config: makeConfig(), connection: conn });
    await client.connect();

    const results = await client.searchByEmailVector({
      query: makeVector(),
      k: 5,
      filter: { login: 'a@y.com' },
    });

    expect(conn.query).toHaveBeenCalledTimes(1);
    const [cypher, params] = conn.query.mock.calls[0] ?? [];
    expect(String(cypher)).toContain('CALL db.idx.vector.queryNodes');
    expect(String(cypher)).toContain('vecf32($query)');
    expect(params).toMatchObject({
      k: 5,
      login: 'a@y.com',
      folder: null,
    });
    expect(params['query']).toBeInstanceOf(Float32Array);
    expect(results).toHaveLength(1);
    expect(results[0]?.emailId).toBe('a@y.com:INBOX:1');
    expect(results[0]?.score).toBeCloseTo(0.95);
  });

  it('clear шлёт MATCH (n) DETACH DELETE n', async () => {
    const conn = createMockConnection();
    const client = new FalkorClient({ config: makeConfig(), connection: conn });
    await client.connect();

    await client.clear();

    const [cypher] = conn.query.mock.calls[0] ?? [];
    expect(String(cypher)).toContain('MATCH (n) DETACH DELETE n');
  });

  it('повторный ensureSchema не выбрасывает при «index already exists»', async () => {
    const conn = createMockConnection({
      vectorIndexError: new Error('Vector index already exists'),
    });
    const client = new FalkorClient({ config: makeConfig(), connection: conn });

    await expect(client.ensureSchema()).resolves.toBeUndefined();
  });

  it('ensureSchema не выбрасывает при «already indexed» (FalkorDB v7 wire)', async () => {
    const conn = createMockConnection({
      vectorIndexError: new Error("Attribute 'embedding' is already indexed"),
    });
    const client = new FalkorClient({ config: makeConfig(), connection: conn });

    await expect(client.ensureSchema()).resolves.toBeUndefined();
  });

  it('ошибка создания индекса (не «already exists») пробрасывается', async () => {
    const conn = createMockConnection({
      vectorIndexError: new Error('connection refused'),
    });
    const client = new FalkorClient({ config: makeConfig(), connection: conn });

    await expect(client.ensureSchema()).rejects.toThrow(FalkorError);
  });

  it('операция без connect выбрасывает', async () => {
    const client = new FalkorClient({ config: makeConfig() });

    await expect(client.clear()).rejects.toThrow(/connect\(\)/);
  });

  it('close не закрывает инжектированное соединение', async () => {
    const conn = createMockConnection();
    const client = new FalkorClient({ config: makeConfig(), connection: conn });
    await client.connect();

    await client.close();

    expect(conn.close).not.toHaveBeenCalled();
  });
});