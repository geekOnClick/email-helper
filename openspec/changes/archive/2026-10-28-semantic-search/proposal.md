# Proposal

## Why

Фаза 3-фундамент (`vector-store`) дала клиентов FalkorDB и embeddings, но они пока не соединены в тулы, доступные агенту: помощник по-прежнему ищет письма только по IMAP-критериям, а не по смыслу. Сценарий PLAN.md раздел 5 — «найди письма про X и проанализируй» — требует тулов `embeddings.index` (тема+тело письма → вектор → FalkorDB) и `vector.search` (запрос → вектор → top-k писем), которые надстроятся над готовым фундаментом (`FalkorClient` + `EmbeddingsClient`) и подключатся в whitelist помощника. Этот change замыкает Фазу 3: агент впервые сможет индексировать и искать письма семантически.

## What Changes

- **Тул `embeddings.index`** (`src/tools/vector/embeddings-index.tool.ts`): принимает `login`+`uid`+`folder?` → через shared `MailSessionStore` читает письмо (`provider.fetch`, как `mail.fetch`) → собирает текст (тема + тело) → `EmbeddingsClient.embed([text])` → `FalkorClient.indexEmail({emailId: login:folder:uid, ...метаданные, embedding, snippet})`. Idempotent (MERGE в FalkorDB). Deps: `sessionStore`, `embeddingsClient`, `falkorClient`.
- **Тул `vector.search`** (`src/tools/vector/vector-search.tool.ts`): принимает `query` (строка) + опц. `filter` (`{login}` и/или `{folder}`) + `k` (default 5) → `EmbeddingsClient.embed([query])` → `FalkorClient.searchByEmailVector({query, k, filter})` → возвращает метаданные+score. Гибрид = KNN + опц. фильтр по свойствам узла (расширение `VectorSearchInput` на 0..2 фильтров: login + folder).
- **Расширение `FalkorClient.searchByEmailVector`**: `VectorSearchInput.filter` из одного `{prop,value}` → опц. `login` + опц. `folder` (множественный фильтр в Cypher `WHERE`). Modified capability `storage/falkor` (меняется форма фильтра поиска) ИЛИ оставить `storage/falkor` as-is и фильтровать постфактум? — решено в design: расширить `VectorSearchInput` (modified `storage/falkor`, т.к. меняется observable-поведение поиска — фильтр по двум свойствам).
- **Регистрация тулов** (`src/tools/vector/register-tools.ts`): `registerVectorTools({sessionStore, embeddingsClient, falkorClient})` — паттерн `registerMailConnectTools`.
- **Подключение в `composeAgents`**: `composeAgents` получает опц. `falkorClient`/`embeddingsClient` (injectable, как `client`), при наличии регистрирует векторные тулы через `registerVectorTools`. `HELPER_TOOLS` whitelist в `src/agents/helper.ts` пополняется `embeddings.index` + `vector.search`.
- **Спека `agent/helper` (modified)**: требование «Набор рутинных тулов без делегирования» расширяется сценарием доступности векторных тулов (индексация + семантический поиск) — теперь это тоже рутина помощника.
- **Тесты**: юнит-тесты тулов с моками (`MailSessionStore` stub, `EmbeddingsClient` mock, `FalkorClient` mock — паттерн `tests/falkor-client.test.ts`); gated-тест `INTEGRATION_FALKOR=1` round-trip `indexEmail`→`search` через тулы (с mock-embeddings, т.к. RouterAI 500); gated-тест `INTEGRATION_LLM=1` на тул с живым RouterAI (observation при 500).

## Capabilities

### New Capabilities

- `mail/semantic-search`: тулы `embeddings.index` и `vector.search` — индексация письма (тема+тело → embedding → FalkorDB) и семантический поиск писем по векторной близости с опц. фильтром по аккаунту/папке

### Modified Capabilities

- `agent/helper`: расширение набора рутинных тулов помощника — добавляются векторные тулы (`embeddings.index`, `vector.search`) как новый вид рутины (индексация + поиск по смыслу)
- `storage/falkor`: расширение фильтра векторного поиска — поддержка опц. фильтрации по `login` и `folder` одновременно (был один `{prop,value}`)

## Impact

- **Новый код:** `src/tools/vector/embeddings-index.tool.ts` (`createEmbeddingsIndexTool`), `src/tools/vector/vector-search.tool.ts` (`createVectorSearchTool`), `src/tools/vector/register-tools.ts` (`registerVectorTools`); пополнение экспорта `src/tools/vector/index.ts`.
- **Модификации:** `src/tools/vector/falkor.ts` (`VectorSearchInput.filter` → `login?`+`folder?`, Cypher `WHERE` под множественный фильтр), `src/agents/helper.ts` (`HELPER_TOOLS` += 2 тулa), `src/agents/compose.ts` (опц. `falkorClient`/`embeddingsClient` + `registerVectorTools`).
- **Без новых runtime-зависимостей** — переиспользуются `FalkorClient`, `EmbeddingsClient`, `MailSessionStore`, `registerTool`.
- **Конфиг:** без новых полей.
- **Внешние системы:** FalkorDB (6380, healthy — верифицирован) + RouterAI `/embeddings` (сейчас 500 — gated-тест с observation). Тул `embeddings.index` зависит от `mail.fetch`-провайдера (через `sessionStore`, требует активное `mail.connect`).
- **Не затрагивает:** `llm/routerai`, `llm/embeddings` (клиент as-is), `agent/orchestrator`, `agent/analyzer`, `mail/*` (тулы Фазы 1 — as-is, `mail.fetch` вызывается через sessionStore, не модифицируется).
- **Новые/modified спеки:** new `mail/semantic-search`, modified `agent/helper`, modified `storage/falkor`.