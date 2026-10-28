# Design

## Context

Фаза 2 замкнула ядро агента (оркестратор+субагенты через `RouterAiClient.chat()`/`runToolLoop`). Заглушка `src/tools/vector/index.ts` (`export {}`) и поля конфига `FALKORDB_*`/`EMBEDDINGS_MODEL` заложены ещё в Фазе 0, но клиента FalkorDB и embeddings-клиента нет. `RouterAiClient` (`src/llm/routerai-client.ts`) — образец injectable-транспорта (`FetchLike`), ретраев (`isRetryableStatus`: 429/5xx) и `redactKey`; `parseChatResponse` (`src/llm/schema.ts`) — образец zod-схемы ответа. Мотивация — см. `proposal.md` (Why); требования — см. `specs/storage/falkor/spec.md` и `specs/llm/embeddings/spec.md`. FalkorDB поднят локально (Docker, контейнер `email-helper-falkordb`, порт 6380, пароль `falkordb`, healthy — `docker/docker-compose.yml`). RouterAI на живую отдаёт серверный 500 на `/chat/completions` и `/embeddings` (observation в `archive/2026-10-28-llm-client/design.md`) — дизайн опирается на контракты и покрывается моками; gated-тесты оставлены на восстановление сервиса.

`falkordb` npm v7.0.0: `FalkorDB.connect({host,port,username,password})` → `db.selectGraph(name)` → `graph.query(cypher,{params})`, `graph.createNodeVectorIndex(label,dim,simFn,...props)`, `db.close()`. KNN — `CALL db.idx.vector.queryNodes('Email','embedding',k,vecf32($q)) YIELD node, score`. `baai/bge-m3` = 1024 dim.

## Goals / Non-Goals

**Goals:**

- Клиент FalkorDB с injectable-соединением: подключение/отключение, идемпотентное создание схемы (узлы/связи/векторный индекс), индексация письма (MERGE + связь с аккаунтом/папкой), векторный поиск (KNN + опц. фильтр), сброс.
- Клиент embeddings: `embed(texts: string[]): Promise<number[][]>` к RouterAI `/embeddings`, модель из `EMBEDDINGS_MODEL`, с ретраями/таймаутом/redactKey — симметрично чат-клиенту.
- Графовая модель Email/Account/Folder + векторный индекс (1024 dim, cosine).
- Юнит-тесты с моками + gated-тесты против живых FalkorDB (6380) и RouterAI `/embeddings` (с observation при 500).

**Non-Goals:**

- Тулы `embeddings.index`/`vector.search`, подключение помощника, сборка тела для embeddings (тема+тело) — `semantic-search` (Фаза 3b).
- Гибридный поиск (IMAP-критерии + векторы) как единый тул — `semantic-search`.
- Переиндексация всего ящика/инкрементальная синхронизация — `semantic-search` или позже.
- Транспорт (CLI/Telegram) — Фазы 5/7.
- Полноценный пул соединений — одно соединение на экземпляр клиента (как `MailSessionStore`).

## Decisions

### D1. Embeddings-клиент — отдельный модуль, новый capability `llm/embeddings` (не modified `llm/routerai`)

`src/llm/embeddings.ts`: класс `EmbeddingsClient` (рядом с `routerai-client.ts`, симметричный по структуре). Тот же `FetchLike`-паттерн, `LLM_REQUEST_TIMEOUT_MS`/`LLM_RETRIES`/`LLM_RETRY_BASE_MS`, `redactKey`. Не метод `RouterAiClient` — разные эндпоинты (`/embeddings` vs `/chat/completions`), разные тела/ответы, разные типы (массив векторов vs чат с tool_calls). Почему **новый capability**, а не modified `llm/routerai`: спека `llm/routerai` (`openspec/specs/llm/routerai/spec.md`) описывает исключительно чат-комплишен; embeddings — самостоятельная ответственность (источник векторов), не меняет требование чата. **Альтернатива:** метод `embed()` в `RouterAiClient` — rejected (класс чат-клиента раздувается; контракт `llm/routerai` пришлось бы модифицировать ради несвязанного эндпоинта).

### D2. API embeddings-клиента

```ts
export interface EmbeddingsClientOptions {
  config: Config;
  fetch?: FetchLike; // injectable, как RouterAiClient
}
export class EmbeddingsClient {
  constructor(opts: EmbeddingsClientOptions);
  async embed(texts: string[]): Promise<number[][]>;
}
```

Тело запроса: `{ model: config.EMBEDDINGS_MODEL, input: texts }`. Ответ (OpenAI-вид): `{ data: [{ embedding: number[], index: number }, ...] }`. Zod-схема `embeddingsResponseSchema` (в `embeddings.ts`): `data` — массив с `embedding` (`z.array(z.number())`), `min(1)`. Нормализация: сортировка по `index` (на случай перемешивания) → `number[][]`. Пустой `texts: []` → ранний возврат `[]` без запроса (спека: «длина равна числу текстов»).

### D3. FalkorDB-клиент — `src/tools/vector/falkor.ts` (по структуре PLAN.md), injectable-соединение

```ts
export interface FalkorConnection {
  // Минимальный интерфейс над falkordb npm для мока (как FetchLike над fetch).
  close(): Promise<void>;
  query(cypher: string, params?: Record<string, unknown>): Promise<FalkorQueryReply>;
  createNodeVectorIndex(
    label: string, dim: number, similarityFunction: string, ...properties: string[]
  ): Promise<void>;
  // (probeNodeOptional для queryNodes тоже в интерфейсе; см. D6)
}
export interface FalkorClientOptions {
  config: Config;
  connection?: FalkorConnection; // injectable; если нет — создаётся реальный
  graphName?: string;             // default 'emails'
}
export class FalkorClient {
  constructor(opts: FalkorClientOptions);
  async connect(): Promise<void>;       // создаёт соединение + ensureSchema
  async close(): Promise<void>;
  async ensureSchema(): Promise<void>;  // векторный индекс (идемпотентно)
  async indexEmail(input: IndexEmailInput): Promise<void>;
  async searchByEmailVector(query: VectorSearchInput): Promise<VectorSearchResult[]>;
  async clear(): Promise<void>;
}
```

`connection` injectable — паттерн `FetchLike`: тесты подставляют mock-соединение, не трогают реальный FalkorDB. Реальный `FalkorConnection` (фабрика `createFalkorConnection(config)`) обёртка над `FalkorDB.connect`+`selectGraph`. **Альтернатива A:** клиент в `src/storage/falkor.ts` (отдельный слой) — rejected (PLAN.md раздел 4 уже задаёт `src/tools/vector/falkor.ts`; тулы поверх клиента в том же каталоге, tighter cohesion). **Альтернатива B:** мок через `FalkorDB.connect` — rejected (неудобно мокать реальную библиотеку; injectable-интерфейс чище, как в `RouterAiClient`).

### D4. Графовая модель и ключ Email

- `Email` (label): `emailId` (уникальный `login:folder:uid`, главный ключ MERGE), `login`, `folder`, `uid`, `subject`, `from` (строка), `date` (ISO-строка), `snippet` (обрезанное тело, ~500 символов), `embedding` (vector), `indexedAt` (timestamp).
- `Account` (label): `login` (ключ).
- `Folder` (label): `path` (ключ), `login` (для принадлежности аккаунту).
- Связи: `(:Account {login})-[:HAS_FOLDER]->(:Folder {path, login})`, `(:Folder {path, login})-[:CONTAINS]->(:Email {emailId})`.
- Идентификатор `emailId` = `${login}:${folder}:${uid}` — стабилен, уникален в рамках аккаунта+папки. MERGE по `emailId` → повторная индексация перезаписывает (спека: «перезаписывая узел»).

### D5. Векторный индекс и его создание

`createNodeVectorIndex('Email', 1024, 'cosine', 'embedding')` — при `ensureSchema`. Размерность 1024 = `baai/bge-m3` (HuggingFace model card). Cosine — стандарт для семантического поиска (bge-m3 нормализует, cosine = мерить смысл). Идемпотентность: `createNodeVectorIndex` FalkorDB на существующий индекс не падает (поведение библиотеки верифицируется в gated-тесте; fallback — перехватывать ошибку «index already exists»). **Трейд-офф:** размерность зашита константой `EMBEDDING_DIM = 1024` (связана с `EMBEDDINGS_MODEL` в конфиге). При смене модели — правка константы + пересоздание индекса (`clear()`). Не вводим auto-detect размерности (overhead, модель статична в PLAN.md).

### D6. Запросы (Cypher с параметрами)

Индексация (MERGE узлов + связи, в одном запросе):
```cypher
MERGE (a:Account {login: $login})
MERGE (f:Folder {path: $folder, login: $login})
MERGE (a)-[:HAS_FOLDER]->(f)
MERGE (e:Email {emailId: $emailId})
SET e.login = $login, e.folder = $folder, e.uid = $uid,
    e.subject = $subject, e.from = $sender, e.date = $date,
    e.snippet = $snippet, e.embedding = vecf32($embedding), e.indexedAt = $now
MERGE (f)-[:CONTAINS]->(e)
```
Поиск (KNN + опц. фильтр по свойству):
```cypher
CALL db.idx.vector.queryNodes('Email', 'embedding', $k, vecf32($query))
YIELD node, score
WHERE $filterProp IS NULL OR node[$filterProp] = $filterValue
RETURN node.emailId AS emailId, node.login AS login, node.folder AS folder,
       node.uid AS uid, node.subject AS subject, node.from AS sender,
       node.date AS date, node.snippet AS snippet, score
ORDER BY score DESC
```
Сброс: `MATCH (n) DETACH DELETE n` (узлы Email/Account/Folder; DETACH сносит связи). **Параметры** (`{params}`) — безопасность (инъекция Cypher), как в FalkorDB docs. `vecf32()` — приведение массива к binary vector (требование индекса). **Альтернатива для фильтра:** предикат в `WHERE` после `YIELD` — принят (проще, чем собирать динамический MATCH). Гибридный поиск (IMAP-критерии + векторы как единый тул) — до `semantic-search`.

### D7. Конфиг и выравнивание порта

Правка `src/config/schema.ts`: `FALKORDB_PORT` default `6379` → `6380`. Это правка конфига (не спеки): соответствует `docker-compose.yml` и `.env.example`; рабочий конфиг (`.env` = 6380) не меняется. Новых полей нет: `FALKORDB_HOST/PORT/PASSWORD` и `EMBEDDINGS_MODEL` уже есть; ретраи/таймаут embeddings переиспользуют `LLM_*`.

### D8. Структура модулей и экспорт

- `src/llm/embeddings.ts` — `EmbeddingsClient`, `EmbeddingsClientOptions`, `embeddingsResponseSchema`, типы.
- `src/llm/index.ts` — `+export { EmbeddingsClient }`, `+export type { EmbeddingsClientOptions }`, типы.
- `src/tools/vector/falkor.ts` — `FalkorClient`, `FalkorClientOptions`, `FalkorConnection`, `createFalkorConnection`, типы `IndexEmailInput`/`VectorSearchInput`/`VectorSearchResult`.
- `src/tools/vector/index.ts` — `+export { FalkorClient, createFalkorConnection }`, типы (замена `export {}`).
- `src/config/schema.ts` — правка default порта.

### D9. Тесты — моки + gated

**Embeddings** (`tests/embeddings-client.test.ts`): мок `FetchLike` (паттерн `responseFactory` из `tests/llm-client.test.ts`): (1) пакет текстов → `number[][]` нужной длины; (2) модель из `EMBEDDINGS_MODEL` в теле запроса; (3) повтор на 429 → успех; (4) исчерпание ретраев на 500 → `RouterAiError` (или `EmbeddingsError`); (5) malformed JSON → ошибка; (6) ключ не в сообщении (redact). Gated `tests/integration/routerai-embeddings.test.ts` (`INTEGRATION_LLM=1`) против живого `/embeddings`, observation при 500 (как `routerai-chat.test.ts`).

**Falkor** (`tests/falkor-client.test.ts`): мок `FalkorConnection` (записывает cypher+params, возвращает заданный `FalkorQueryReply`): (1) `ensureSchema` зовёт `createNodeVectorIndex('Email',1024,'cosine','embedding')`; (2) `indexEmail` шлёт MERGE с правильным `emailId`/`embedding`; (3) `searchByEmailVector` шлёт KNN с `vecf32($query)` и фильтром; (4) `clear` шлёт DETACH DELETE; (5) повторный `ensureSchema` не падает. Gated `tests/integration/falkor-client.test.ts` (`INTEGRATION_FALKOR=1`) против живого FalkorDB на 6380: connect→ensureSchema→indexEmail→search→clear round-trip.

## Risks / Trade-offs

- **[Риск: wire-формат RouterAI `/embeddings` не верифицирован (сервис 500)]** → Mitigation: построено на контракте OpenAI embeddings v1; zod-схема принимает `{data:[{embedding:number[],index}]}`; мок-тесты покрывают сценарии. Gated-тест заработает при восстановлении сервиса; observation зафиксирует реальный shape.
- **[Риск: `createNodeVectorIndex` поведение на дубликате не задокументировано в типах]** → Mitigation: gated-тест (D9) верифицирует идемпотентность против живого FalkorDB; если падает — fallback с перехватом «already exists».
- **[Риск: `EMBEDDING_DIM=1024` зашит константой]** → Mitigation: константа рядом с `EMBEDDINGS_MODEL` в коде; при смене модели — правка + `clear()`+переиндексация (планируется в `semantic-search`).
- **[Трейд-офф: одно соединение на клиент]** Как `MailSessionStore`. Для CLI-сессии и тестов достаточно; пул соединений — если потребуется в проде (Фаза 8).
- **[Трейд-офф: injectable `FalkorConnection` — лишний слой абстракции]** Принимаем ради тестируемости (мок без реального FalkorDB), как `FetchLike`. Реальный adapter тонкий.

## Migration Plan

Greenfield-модуль `src/llm/embeddings.ts` + `src/tools/vector/falkor.ts` поверх существующих `src/llm/` и `src/tools/vector/`. Развёртывание:

1. `npm i falkordb` (новая runtime-зависимость) + `import`/`@types` проверка (falkordb v7 тащит свои типы).
2. Правка `src/config/schema.ts` (default порта 6380).
3. `src/llm/embeddings.ts` (`EmbeddingsClient` + zod-схема); пополнить экспорт `src/llm/index.ts`.
4. `src/tools/vector/falkor.ts` (`FalkorClient` + `FalkorConnection` + `createFalkorConnection`); пополнить `src/tools/vector/index.ts`.
5. Юнит-тесты `tests/embeddings-client.test.ts`, `tests/falkor-client.test.ts` (моки).
6. Gated-тесты `tests/integration/routerai-embeddings.test.ts`, `tests/integration/falkor-client.test.ts`.
7. `npm test`, `tsc`, `lint`, `openspec validate vector-store --strict`.

Откат: удалить `embeddings.ts`/`falkor.ts`, откатить экспорты и `schema.ts` — обратно-совместимо (контракты `llm/routerai`/`agent/*`/`mail/*` не тронуты; откат `falkordb` из `package.json`).

## Open Questions

- Нет отложенных unknowns: wire-формат RouterAI embeddings и идемпотентность `createNodeVectorIndex` — deferrable (gated-тесты с observation верифицируют при восстановлении сервиса), не меняют спеки/подход/task breakdown.