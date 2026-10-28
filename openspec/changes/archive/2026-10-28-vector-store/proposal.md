# Proposal

## Why

Фаза 2 замкнула ядро агента (оркестратор + анализатор + помощник) и дала тулы для работы с почтой, но семантического поиска по содержимому писем нет: помощник умеет искать только по IMAP-критериям (дата, отправитель, тема-подстрока), а не по смыслу. Это блокирует ключевой сценарий PLAN.md раздел 5 — «найди письма про X и проанализируй». Для этого нужна векторная БД (FalkorDB) с векторным индексом над embedding-ами писем и источник векторов (RouterAI `/embeddings`). Этот change закладывает фундамент — клиентов FalkorDB и embeddings с графовой моделью и векторным индексом — который разблокирует следующий change `semantic-search` (тулы `embeddings.index`/`vector.search` поверх фундамента).

## What Changes

- **Клиент FalkorDB** (`src/tools/vector/falkor.ts`): обёртка над npm-пакетом `falkordb` v7 — подключение по `FALKORDB_HOST/PORT/PASSWORD` (порт 6380 локально), injectable-соединение для моков, выбор графа, parameterized Cypher-запросы (MERGE/CREATE/MATCH), гарантированное создание векторного индекса (idempotent). Первая новая runtime-зависимость со времени Фазы 0 — фиксируется в Impact.
- **Графовая модель** (в рамках `storage/falkor`): узел `Email` (id = `login:folder:uid`, тема, дата, отправитель, папка, тело-сниппет, вектор в поле `embedding`) + узлы `Account`/`Folder` со связями `(:Account)-[:HAS_FOLDER]->(:Folder)-[:CONTAINS]->(:Email)`. Ключ узла Email стабилен (логин+папка+UID), повторная индексация перезаписывает (MERGE).
- **Векторный индекс** над полем `embedding` узла `Email`: размерность 1024 (`baai/bge-m3`), cosine-сходство, создаётся при инициализации графа. KNN-запрос — `CALL db.idx.vector.queryNodes('Email','embedding',k,vecf32($q)) YIELD node, score`.
- **Клиент embeddings** (`src/llm/embeddings.ts`): POST `/embeddings` к тому же `baseUrl`+`apiKey`, что и `RouterAiClient.chat()`, модель `EMBEDDINGS_MODEL`, возвращает `number[][]` (пакетный режим). Переиспользует паттерн injectable `FetchLike`, AbortController-таймаут, ретраи 429/5xx/сеть, `redactKey` — симметрично клиенту чата.
- **Выравнивание конфига**: default `FALKORDB_PORT` в `ConfigSchema` меняется с 6379 на 6380 — соответствует `docker-compose.yml` (`${FALKORDB_PORT:-6380}`) и `.env.example`. Рабочий конфиг не меняется (только значение по умолчанию для чистой установки).
- **Экспорт**: `src/llm/index.ts` (+`EmbeddingsClient`/типы), `src/tools/vector/index.ts` (+`FalkorClient`/типы).
- **Тесты**: юнит-тесты с моками (injectable соединение FalkorDB, injectable fetch embeddings — паттерн `tests/llm-client.test.ts`); gated-тесты — `INTEGRATION_FALKOR=1` против живого FalkorDB на порту 6380, `INTEGRATION_LLM=1` против живого RouterAI `/embeddings` (с observation при 500 — как в `tests/integration/routerai-chat.test.ts`).

## Capabilities

### New Capabilities

- `storage/falkor`: клиент FalkorDB и графовая модель векторного хранилища писем — узлы `Email`/`Account`/`Folder` со связями, векторный индекс над `embedding` (размерность 1024, cosine), parameterized Cypher-запросы для индексации и поиска
- `llm/embeddings`: клиент embeddings RouterAI (`POST /embeddings`, модель `EMBEDDINGS_MODEL`) — источник векторов для векторного хранилища, с ретраями и сокрытием API-ключа (симметрично `llm/routerai`)

### Modified Capabilities

Нет. Контракт `llm/routerai` (чат-комплишен) не трогается — embeddings это отдельный эндпоинт и ответственность, поэтому новый capability `llm/embeddings`, а не modified `llm/routerai`. Спека `agent/helper` тоже не меняется (whitelist рутинных тулов — реляционная деталь реализации; расширение его векторными тулами разберётся в `semantic-search`, где тулы появятся).

## Impact

- **Новый код:** `src/tools/vector/falkor.ts` (`FalkorClient` — `connect`/`close`/`ensureSchema`/`indexEmail`/`searchByEmailVector`/`clear`; injectable `FalkorConnection`), `src/llm/embeddings.ts` (`EmbeddingsClient.embed(texts): Promise<number[][]>`, типы, zod-схема ответа).
- **Новые runtime-зависимости:** `falkordb` v7.0.0 (первая новая со времени Фазы 0) — `npm i falkordb`. Без новых dev-зависимостей.
- **Конфиг:** выравнивание default `FALKORDB_PORT` 6379→6380 в `src/config/schema.ts` (правка конфига, не спеки); поле `EMBEDDINGS_MODEL` уже есть (default `baai/bge-m3`). Новых полей нет — ретраи/таймаут embeddings переиспользуют `LLM_REQUEST_TIMEOUT_MS`/`LLM_RETRIES`/`LLM_RETRY_BASE_MS`.
- **Внешние системы:** FalkorDB в Docker (`docker/docker-compose.yml`, контейнер `email-helper-falkordb`, порт 6380, healthy — запущен локально); RouterAI `/embeddings` на живую сейчас отдаёт серверный 500 (как и `/chat/completions` — observation в `archive/2026-10-28-llm-client/design.md`), wire-формат embeddings не верифицирован против живого API — покрыт моками, gated-тест с observation при 500.
- **Не затрагивает:** `llm/routerai` (chat — as-is), `agent/*` (whitelist + compose — as-is в этом change), `mail/*` (тулы Фазы 1 — as-is), спеки `agent/helper`/`mail/*`. Тулы `embeddings.index`/`vector.search` и подключение помощника — `semantic-search` (Фаза 3b).
- **Новые спеки:** `storage/falkor`, `llm/embeddings`.