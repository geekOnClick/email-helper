# Tasks

## 1. Зависимость и конфиг

- [x] 1.1 Установить `falkordb` (v7.0.0) как runtime-зависимость: `npm i falkordb`. Проверка: `package.json` содержит `falkordb` в `dependencies`; `node -e "import('falkordb')"` разрешается без ошибки.
- [x] 1.2 Выровнять default `FALKORDB_PORT` в `src/config/schema.ts` с 6379 на 6380 (соответствие `docker-compose.yml` и `.env.example`). Проверка: `npx tsc --noEmit`; существующий `tests/config.test.ts` зелёный (или обновить ожидание default порта, если он его фиксирует).

## 2. Клиент embeddings

- [x] 2.1 Реализовать `src/llm/embeddings.ts`: zod-схема ответа `embeddingsResponseSchema` (`{data: [{embedding: number[], index: number}], ...}`, `data.min(1)`), тип `EmbeddingsClientOptions` (`config`, `fetch?: FetchLike`), класс `EmbeddingsClient` с методом `embed(texts: string[]): Promise<number[][]>` — POST `/embeddings` к `config.ROUTERAI_BASE_URL` с `Authorization: Bearer <key>`, тело `{model: config.EMBEDDINGS_MODEL, input: texts}`; ретраи 429/5xx/сеть (`isRetryableStatus`-логика как в `routerai-client.ts`), AbortController-таймаут `LLM_REQUEST_TIMEOUT_MS`, `redactKey` в сообщениях об ошибках; ранний возврат `[]` для пустого `texts`; нормализация ответа сортировкой по `index` → `number[][]`. Переиспользовать `RouterAiError` или ввести `EmbeddingsError` (решить в коде, симметрично чат-клиенту). Проверка: `npx tsc --noEmit`.
- [x] 2.2 Пополнить экспорт `src/llm/index.ts`: `+export { EmbeddingsClient }`, `+export type { EmbeddingsClientOptions }`, `+export { embeddingsResponseSchema }`, нужные типы. Проверка: `npx tsc --noEmit`; `import { EmbeddingsClient } from '../src/llm/index.js'` резолвится.
- [x] 2.3 Реализовать юнит-тесты `tests/embeddings-client.test.ts` с мок `FetchLike` (паттерн `responseFactory`/`jsonResponse` из `tests/llm-client.test.ts`): (1) пакет из 2 текстов → `number[][]` длины 2; (2) тело запроса содержит `model: config.EMBEDDINGS_MODEL`; (3) повтор на 429 → успех на 2-й попытке; (4) исчерпание ретраев на 500 → ошибка без выброса наружу; (5) malformed JSON → ошибка парсинга; (6) ключ (`secret-key-123`) не в сообщении ошибки (redact); (7) пустой `texts: []` → `[]` без вызова fetch. Проверка: `npm test -- embeddings-client` зелёный.

## 3. Клиент FalkorDB

- [x] 3.1 Реализовать `src/tools/vector/falkor.ts`: интерфейс `FalkorConnection` (`close()`, `query(cypher, params?)`, `createNodeVectorIndex(label, dim, simFn, ...props)` — для injectable-мока), типы `IndexEmailInput` (`emailId`, `login`, `folder`, `uid`, `subject`, `from`, `date` (ISO-строка), `snippet`, `embedding: number[]`), `VectorSearchInput` (`query: number[]`, `k: number`, `filter?: {prop, value}`), `VectorSearchResult` (метаданные + `score`), класс `FalkorClient` (`connect`/`close`/`ensureSchema`/`indexEmail`/`searchByEmailVector`/`clear`) с `FalkorClientOptions` (`config`, `connection?`, `graphName?` default `'emails'`), константа `EMBEDDING_DIM = 1024`. Cypher-запросы по design D6 (MERGE индексации, KNN-поиск с опц. фильтром через `WHERE $filterProp IS NULL OR node[$filterProp] = $filterValue`, `clear` = `MATCH (n) DETACH DELETE n`). Фабрика `createFalkorConnection(config): FalkorConnection` — обёртка над `FalkorDB.connect`+`selectGraph`. Проверка: `npx tsc --noEmit`.
- [x] 3.2 Пополнить `src/tools/vector/index.ts`: `+export { FalkorClient, createFalkorConnection }`, `+export type { FalkorClientOptions, FalkorConnection, IndexEmailInput, VectorSearchInput, VectorSearchResult }`. Проверка: `npx tsc --noEmit`.
- [x] 3.3 Реализовать юнит-тесты `tests/falkor-client.test.ts` с мок `FalkorConnection` (записывает переданные `cypher`+`params` и аргументы `createNodeVectorIndex`, возвращает заданный `query`-ответ): (1) `ensureSchema` зовёт `createNodeVectorIndex('Email', 1024, 'cosine', 'embedding')`; (2) `indexEmail` шлёт MERGE с корректным `emailId = login:folder:uid` и `vecf32($embedding)` (проверка params); (3) `searchByEmailVector` шлёт KNN с `vecf32($query)`, `$k` и фильтром (`filterProp`/`filterValue`); (4) `clear` шлёт `MATCH (n) DETACH DELETE n`; (5) повторный `ensureSchema` не выбрасывает. Проверка: `npm test -- falkor-client` зелёный.

## 4. Интеграционные gated-тесты

- [x] 4.1 Реализовать `tests/integration/routerai-embeddings.test.ts` (`INTEGRATION_LLM=1`): один прогон `new EmbeddingsClient({config}).embed(['тестовая строка'])` против живого RouterAI `/embeddings`; проверка, что возвращается `number[][]` длины 1 с непустым вектором; при `RouterAiError` (500) — пропуск с observation (`console.log` статуса, как в `tests/integration/routerai-chat.test.ts`). Без флага — skipped. Проверка: без флага skip; с флагом — зелёный либо observation.
- [x] 4.2 Реализовать `tests/integration/falkor-client.test.ts` (`INTEGRATION_FALKOR=1`): round-trip против живого FalkorDB на `config.FALKORDB_PORT` (6380) — `client.connect()` → `ensureSchema()` → `clear()` → `indexEmail({...embedding: [1024 числа]})` → `searchByEmailVector({query, k: 5})` возвращает индексированное письмо → `clear()`. Без флага — skipped. Проверка: без флага skip; с флагом — зелёный (FalkorDB запущен, healthy).

## 5. Финальная проверка

- [x] 5.1 `npm test` — зелёный (новые тесты embeddings/falkor входят; существующие не сломаны). Проверка: exit 0.
- [x] 5.2 `npx tsc --noEmit` — без ошибок. Проверка: exit 0.
- [x] 5.3 `npm run lint` — без ошибок. Проверка: exit 0.
- [x] 5.4 `openspec validate vector-store --strict` — проходит. Проверка: exit 0.

## Workflow follow-up

- После проверки — запустить `/opsx-apply` для реализации по tasks.
- После реализации и зелёных тестов — `/opsx-archive` для зашивания change и создания основных спек `storage/falkor` и `llm/embeddings`.
- При восстановлении живого RouterAI — повторить gated-тест `4.1` с реальным `/embeddings` и зафиксировать wire-формат в observation.
- После `vector-store` Фаза 3 фундамент готов: следующий change — `semantic-search` (тулы `embeddings.index`/`vector.search`, сборка тела письма тема+тело, подключение векторных тулов в whitelist помощника, гибридный поиск).