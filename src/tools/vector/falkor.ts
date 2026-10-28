/**
 * Клиент FalkorDB: векторное хранилище писем.
 * Фаза 3, change vector-store.
 *
 * Injectable `FalkorConnection` (над `falkordb` npm v7) — паттерн `FetchLike`:
 * тесты подставляют мок-соединение, не трогая реальную БД. Реальный адаптер
 * `createFalkorConnection` — тонкая обёртка над `FalkorDB.connect`+`selectGraph`.
 *
 * Графовая модель и Cypher — см. design.md D4–D6.
 * Контракт — см. `openspec/changes/vector-store/specs/storage/falkor/spec.md`.
 */
import { FalkorDB } from 'falkordb';
import type { Graph, GraphReply, QueryParam } from 'falkordb';
import type { Config } from '../../config/schema.js';

/** Размерность вектора embeddings модели `baai/bge-m3`. */
export const EMBEDDING_DIM = 1024;

/** Имя графа по умолчанию. */
const DEFAULT_GRAPH_NAME = 'emails';

/**
 * Минимальный интерфейс над `falkordb` Graph для injectable-мока.
 * Симметричен подмножеству API `Graph` (query, createNodeVectorIndex, delete).
 */
export interface FalkorConnection {
  query(cypher: string, params?: Record<string, QueryParam>): Promise<GraphReply<unknown>>;
  createNodeVectorIndex(
    label: string,
    options: { dimension: number; similarityFunction: 'cosine' | 'euclidean' },
    ...properties: string[]
  ): Promise<unknown>;
  close(): Promise<void>;
}

/** Данные для индексации одного письма. */
export interface IndexEmailInput {
  /** Стабильный ключ `login:folder:uid`. */
  emailId: string;
  login: string;
  folder: string;
  uid: number;
  subject: string;
  /** Отправитель (строка). */
  from: string;
  /** Дата письма в ISO-строке. */
  date: string;
  /** Обрезанное тело (~500 символов). */
  snippet: string;
  /** Вектор письма (размерность EMBEDDING_DIM). */
  embedding: number[];
}

/** Запрос векторного поиска. */
export interface VectorSearchInput {
  /** Вектор запроса (той же размерности, что и у писем). */
  query: number[];
  /** Число ближайших соседей. */
  k: number;
  /** Опц. фильтр по свойству узла (напр. { prop: 'login', value: 'a@yandex.com' }). */
  filter?: { prop: string; value: string };
}

/** Найденное письмо с оценкой близости. */
export interface VectorSearchResult {
  emailId: string;
  login: string;
  folder: string;
  uid: number;
  subject: string;
  from: string;
  date: string;
  snippet: string;
  score: number;
}

export interface FalkorClientOptions {
  config: Config;
  /** Инжектируемое соединение (для тестов); при отсутствии создаётся реальное. */
  connection?: FalkorConnection;
  /** Имя графа (по умолчанию 'emails'). */
  graphName?: string;
}

/** Ошибка клиента FalkorDB (не несёт секрета). */
export class FalkorError extends Error {
  constructor(message: string, opts?: { cause?: unknown }) {
    super(message);
    this.name = 'FalkorError';
    if (opts?.cause !== undefined) this.cause = opts.cause;
  }
}

/**
 * Создаёт реальное соединение с FalkorDB (обёртка над `falkorDB.connect`).
 * Возвращает `FalkorConnection`, готовый к работе с выбранным графом.
 */
export async function createFalkorConnection(config: Config): Promise<FalkorConnection> {
  let db: FalkorDB;
  try {
    db = await FalkorDB.connect({
      host: config.FALKORDB_HOST,
      port: config.FALKORDB_PORT,
      password: config.FALKORDB_PASSWORD || undefined,
    });
  } catch (err) {
    throw new FalkorError(
      `FalkorDB: ошибка подключения к ${config.FALKORDB_HOST}:${config.FALKORDB_PORT}: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    );
  }

  const graph: Graph = db.selectGraph(DEFAULT_GRAPH_NAME);
  return {
    query: (cypher, params) => graph.query<unknown>(cypher, params ? { params } : undefined),
    createNodeVectorIndex: (label, options, ...properties) =>
      graph.createNodeVectorIndex(label, options, ...properties),
    close: () => db.close(),
  };
}

/**
 * Векторное хранилище писем.
 * Stateless в смысле домена: каждый вызов — самостоятельная транзакция в графе.
 */
export class FalkorClient {
  private connection: FalkorConnection | null;
  private readonly ownsConnection: boolean;
  private readonly config: Config;
  private readonly graphName: string;

  constructor(opts: FalkorClientOptions) {
    this.config = opts.config;
    this.graphName = opts.graphName ?? DEFAULT_GRAPH_NAME;
    this.connection = opts.connection ?? null;
    this.ownsConnection = !opts.connection;
  }

  /** Подключается к FalkorDB (если соединение не инжектировано) и создаёт схему. */
  async connect(): Promise<void> {
    if (!this.connection) {
      this.connection = await createFalkorConnection(this.config);
    }
    await this.ensureSchema();
  }

  /** Имя графа (для инспекции/тестов). */
  getGraphName(): string {
    return this.graphName;
  }

  /**
   * Создаёт векторный индекс над embedding-ами писем, если его ещё нет.
   * Идемпотентно: перехватывает ошибку «index already exists».
   */
  async ensureSchema(): Promise<void> {
    const conn = this.requireConnection();
    try {
      await conn.createNodeVectorIndex(
        'Email',
        { dimension: EMBEDDING_DIM, similarityFunction: 'cosine' },
        'embedding',
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!/already exists/i.test(msg)) {
        throw new FalkorError(`FalkorDB: ошибка создания векторного индекса: ${msg}`, { cause: err });
      }
      // Индекс уже существует — идемпотентно ок.
    }
  }

  /** Индексирует письмо (MERGE по emailId, перезапись embedding/метаданных). */
  async indexEmail(input: IndexEmailInput): Promise<void> {
    const conn = this.requireConnection();
    await conn.query(
      `
      MERGE (a:Account {login: $login})
      MERGE (f:Folder {path: $folder, login: $login})
      MERGE (a)-[:HAS_FOLDER]->(f)
      MERGE (e:Email {emailId: $emailId})
      SET e.login = $login, e.folder = $folder, e.uid = $uid,
          e.subject = $subject, e.from = $sender, e.date = $date,
          e.snippet = $snippet, e.embedding = vecf32($embedding),
          e.indexedAt = $now
      MERGE (f)-[:CONTAINS]->(e)
      `,
      {
        emailId: input.emailId,
        login: input.login,
        folder: input.folder,
        uid: input.uid,
        subject: input.subject,
        sender: input.from,
        date: input.date,
        snippet: input.snippet,
        embedding: new Float32Array(input.embedding),
        now: new Date().toISOString(),
      },
    );
  }

  /** Векторный поиск top-k писем (KNN) с опц. фильтром по свойству узла. */
  async searchByEmailVector(input: VectorSearchInput): Promise<VectorSearchResult[]> {
    const conn = this.requireConnection();
    const reply = await conn.query(
      `
      CALL db.idx.vector.queryNodes('Email', 'embedding', $k, vecf32($query))
      YIELD node, score
      WHERE $filterProp IS NULL OR node[$filterProp] = $filterValue
      RETURN node.emailId AS emailId, node.login AS login, node.folder AS folder,
             node.uid AS uid, node.subject AS subject, node.from AS sender,
             node.date AS date, node.snippet AS snippet, score
      ORDER BY score DESC
      `,
      {
        k: input.k,
        query: new Float32Array(input.query),
        filterProp: input.filter?.prop ?? null,
        filterValue: input.filter?.value ?? null,
      },
    );

    const rows = reply.data ?? [];
    return rows.map((row) => {
      const r = row as Record<string, unknown>;
      return {
        emailId: String(r['emailId'] ?? ''),
        login: String(r['login'] ?? ''),
        folder: String(r['folder'] ?? ''),
        uid: Number(r['uid']),
        subject: String(r['subject'] ?? ''),
        from: String(r['sender'] ?? ''),
        date: String(r['date'] ?? ''),
        snippet: String(r['snippet'] ?? ''),
        score: Number(r['score']),
      };
    });
  }

  /** Сброс хранилища: удаляет все узлы и связи. */
  async clear(): Promise<void> {
    const conn = this.requireConnection();
    await conn.query('MATCH (n) DETACH DELETE n');
  }

  /** Закрывает соединение, если оно принадлежит клиенту. */
  async close(): Promise<void> {
    if (this.connection && this.ownsConnection) {
      await this.connection.close();
    }
    this.connection = null;
  }

  private requireConnection(): FalkorConnection {
    if (!this.connection) {
      throw new FalkorError('FalkorDB: клиент не подключён — вызовите connect() первым');
    }
    return this.connection;
  }
}