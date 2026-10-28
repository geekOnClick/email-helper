# Design

## Context

Фаза 3-фундамент (`archive/2026-10-28-vector-store/`) дала `FalkorClient` (`src/tools/vector/falkor.ts`: `indexEmail`, `searchByEmailVector`, `clear`, injectable `FalkorConnection`) и `EmbeddingsClient` (`src/llm/embeddings.ts`: `embed(texts)`). Но они не соединены в тулы реестра, и помощник их не видит (`HELPER_TOOLS` = 5 mail-тулов). `mail.fetch` (`src/tools/mail/mail-fetch.tool.ts`) читает письмо через `sessionStore.get(login).fetch(uid, folder)` → `EmailFull` (тема+тело). `composeAgents` — точка сборки (регистрирует mail-тулы). Мотивация — см. `proposal.md` (Why); требования — см. спеки `mail/semantic-search`, `agent/helper`, `storage/falkor`. RouterAI `/embeddings` сейчас 500 (observation в HANDOFF) — тулы строятся на моках; FalkorDB здоров (6380, gated-тест зелёный). Контракты `llm/embeddings`, `llm/routerai`, `agent/orchestrator`, `agent/analyzer`, `mail/*` — used as-is. Спеки `storage/falkor` и `agent/helper` — modified (расширенный набор).

## Goals / Non-Goals

**Goals:**

- Тул `embeddings.index` (login+uid+folder? → mail.fetch → embed тема+тело → FalkorClient.indexEmail).
- Тул `vector.search` (query + filter? + k → embed → FalkorClient.searchByEmailVector).
- Гибридный фильтр: KNN + опц. login + опц. folder (расширение `VectorSearchInput`).
- Векторные тулы в whitelist помощника + регистрация в `composeAgents`.

**Non-Goals:**

- Переиндексация всего ящика / инкрементальная синхронизация — позже.
- Embedding вложений-документов — после Фазы 3 (PLAN.md 8.4).
- Транспорт (CLI/Telegram) — Фазы 5/7.
- Изменение `FalkorClient` API структуры (только фильтр поиска расширяется).

## Decisions

### D1. Тул `embeddings.index` — через sessionStore, не через реестр

Тул `embeddings.index` принимает `{login, uid, folder?}`. Чтение письма — через `sessionStore.get(login).fetch(uid, folder)` (тот же путь, что `mail.fetch`), а НЕ через `getTool('mail.fetch')`. Причина: тул должен зависеть от deps-инъекции (как `mail.fetch` от `sessionStore`), а не от реестра (ругающееся на время выполнения). Deps тулa: `{sessionStore, embeddingsClient, falkorClient}`. **Альтернатива:** вызов `mail.fetch` handler через `getTool('mail.fetch').handler(args)` — rejected (связывает тул с реестром, усложняет тестирование, дублирует валидацию).

### D2. Текст для embedding — тема + тело

`buildIndexText(subject, body)`: объединение `subject + '\n' + body`, обрезка тела до snippet (~500 символов) для хранения в графе (`IndexEmailInput.snippet`), но в embedding идёт полный «тема + тело» (bge-m3 до 8192 токенов — тело влезает; PLAN.md 8.4 — «тема + тело»). Пустое тело → embedding из темы. `EmailFull.hasBody` false → snippet пустой, текст = тема.

### D3. Тул `vector.search` — embedding запроса через `EmbeddingsClient`

Тул принимает `{query, k?, filter?}`. `EmbeddingsClient.embed([query])` → `number[][]` → `[0]`. `k` default 5. `filter?: {login?, folder?}` → маппится в `VectorSearchInput`. Deps: `{embeddingsClient, falkorClient}`.

### D4. Расширение `VectorSearchInput` — modified `storage/falkor`

`VectorSearchInput.filter` из `{prop, value}` → `{login?: string, folder?: string}`. Cypher `WHERE` меняется на множественный:

```cypher
CALL db.idx.vector.queryNodes('Email', 'embedding', $k, vecf32($query))
YIELD node, score
WHERE ($login IS NULL OR node.login = $login)
  AND ($folder IS NULL OR node.folder = $folder)
RETURN node.emailId AS emailId, node.login AS login, node.folder AS folder,
       node.uid AS uid, node.subject AS subject, node.from AS sender,
       node.date AS date, node.snippet AS snippet, score
ORDER BY score DESC
```

`$login`/`$folder` — `null` если не задан. **Альтернатива:** оставить `{prop,value}` и фильтровать постфактум — rejected (теряет смысл KNN: top-k режется до фильтра). Спека `storage/falkor` modified (требование «Векторный поиск писем»).

### D5. Сборка тулов — `registerVectorTools` + опц. в `composeAgents`

`src/tools/vector/register-tools.ts`: `registerVectorTools(deps: {sessionStore, embeddingsClient, falkorClient})` регистрирует оба тулa (паттерн `registerMailConnectTools`). `composeAgents` получает опц. `embeddingsClient?` и `falkorClient?`; при их наличии зовёт `registerVectorTools` перед созданием субагентов (чтобы тулы попали в whitelist). Если не переданы — векторные тулы не регистрируются, helper работает без них (graceful: compose не падает). **Альтернатива:** обязательные поля — rejected (транспорт без FalkorDB должен мочь поднять агента).

### D5a. Включение векторных тулов в helper

`HELPER_TOOLS` пополняется `'embeddings.index'`, `'vector.search'`. Спека `agent/helper` modified (сценарий «Доступны векторные тулы»). Register-toolkits: helper фильтрует `listTools()` по whitelist — если векторные тулы не зарегистрированы, helper просто не получит их (фильтр пропустит). Это совместимо с D5 (опц. deps).

### D6. Скил помощника `skills/helper.md`

Пополнить раздел доступных тулов: добавить `embeddings.index` (индексация письма в векторную БД) и `vector.search` (поиск писем по смыслу). Без новых ограничений (векторные тулы — рутина, не анализ).

### D7. Структура модулей и экспорт

- `src/tools/vector/embeddings-index.tool.ts` — `createEmbeddingsIndexTool(deps): ToolDef`, `EmbeddingsIndexArgs`/`EmbeddingsIndexDeps`.
- `src/tools/vector/vector-search.tool.ts` — `createVectorSearchTool(deps): ToolDef`, `VectorSearchArgs`/`VectorSearchDeps`.
- `src/tools/vector/register-tools.ts` — `registerVectorTools`.
- `src/tools/vector/index.ts` — `+export` тулов и `registerVectorTools`.
- `src/tools/vector/falkor.ts` — правка `VectorSearchInput` + Cypher `WHERE`.

### D8. Тесты — моки + gated

**`tests/embeddings-index-tool.test.ts`**: мок `sessionStore` (returns stub `EmailFull`), мок `EmbeddingsClient` (returns fixed vector), мок `FalkorClient` (records `indexEmail`): (1) индексация нового письма → `indexEmail` с корректным `emailId`/`embedding`; (2) нет подключения → ошибка; (3) пустое тело → embedding из темы; (4) повторная индексация → `indexEmail` зовётся (idempotency на стороне FalkorDB). Gated `tests/integration/embeddings-index-tool.test.ts` (`INTEGRATION_FALKOR=1`) — round-trip с mock-embeddings + живым FalkorDB.

**`tests/vector-search-tool.test.ts`**: мок `EmbeddingsClient` (returns fixed vector), мок `FalkorClient` (returns fixed `VectorSearchResult[]`): (1) поиск по запросу → вызывает embed + search; (2) с фильтром login; (3) default k=5.

## Risks / Trade-offs

- **[Риск: RouterAI 500 — тул `embeddings.index`/`vector.search` не работают end-to-end]** → Mitigation: тулы покрыты моками; `composeAgents` graceful без FalkorClient. Gated-тест заработает при восстановлении сервиса.
- **[Риск: тул `embeddings.index` требует активное `mail.connect`]** → Mitigation: ошибка-как-результат (как `mail.fetch`); скил `helper.md` напоминает про подключение.
- **[Трейд-офф: embedding полного тела, не snippet]** bge-m3 поддерживает 8192 токенов — тело письма обычно влезает. Длинные письма обрежет модель — приемлемо для семантического поиска. Snippet хранится отдельно для отображения.

## Migration Plan

Greenfield-тулы поверх существующего фундамента. Развёртывание:

1. Правка `src/tools/vector/falkor.ts` (`VectorSearchInput.filter`, Cypher `WHERE`).
2. `src/tools/vector/embeddings-index.tool.ts`, `vector-search.tool.ts`, `register-tools.ts`.
3. Пополнить экспорт `src/tools/vector/index.ts`.
4. `src/agents/helper.ts` (`HELPER_TOOLS`), `src/agents/compose.ts` (опц. deps + `registerVectorTools`), `skills/helper.md`.
5. Юнит-тесты `tests/embeddings-index-tool.test.ts`, `tests/vector-search-tool.test.ts`.
6. Gated-тест `tests/integration/embeddings-index-tool.test.ts` (`INTEGRATION_FALKOR=1`).
7. `npm test`, `tsc`, `lint`, `openspec validate semantic-search --strict`.

Откат: удалить тулы, откатить `falkor.ts` (filter), `helper.ts`, `compose.ts`, `skills/helper.md`.

## Open Questions

- Нет отложенных unknowns: wire-формат RouterAI embeddings и live round-trip тулов — deferrable (gated-тесты с observation), не меняют спеки/подход/tasks.