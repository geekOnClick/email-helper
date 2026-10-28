# Tasks

## 1. Расширение фильтра FalkorClient

- [x] 1.1 В `src/tools/vector/falkor.ts`: изменить `VectorSearchInput.filter` с `{prop, value}` на `{login?: string, folder?: string}`, обновить Cypher `WHERE` на множественный фильтр `($login IS NULL OR node.login = $login) AND ($folder IS NULL OR node.folder = $folder)`, передавать `$login`/`$folder` как `null` при отсутствии. Проверка: `npx tsc --noEmit`; `tests/falkor-client.test.ts` зелёный (обновить мок-тест под новый filter shape).

## 2. Тул embeddings.index

- [x] 2.1 Реализовать `src/tools/vector/embeddings-index.tool.ts`: `EmbeddingsIndexArgs` (`login`, `uid`, `folder?`), `EmbeddingsIndexDeps` (`sessionStore`, `embeddingsClient`, `falkorClient`), `createEmbeddingsIndexTool(deps): ToolDef` — handler: `sessionStore.get(login)` → провайдер → `fetch(uid, folder)` → `EmailFull`, `buildIndexText(subject, body)` (тема+'\n'+тело, при пустом теле — тема), `embeddingsClient.embed([text])` → `[0]`, `falkorClient.indexEmail({emailId, login, folder, uid, subject, from, date, snippet, embedding})`. Throws при отсутствии подключения. Проверка: `npx tsc --noEmit`.

- [x] 2.2 Пополнить экспорт `src/tools/vector/index.ts`: `+export { createEmbeddingsIndexTool }`, типы.

## 3. Тул vector.search

- [x] 3.1 Реализовать `src/tools/vector/vector-search.tool.ts`: `VectorSearchArgs` (`query`, `k?` default 5, `filter?: {login?, folder?}`), `VectorSearchDeps` (`embeddingsClient`, `falkorClient`), `createVectorSearchTool(deps): ToolDef` — handler: `embed([query])` → `[0]`, `falkorClient.searchByEmailVector({query, k, filter})` ← результат. Проверка: `npx tsc --noEmit`.

- [x] 3.2 Пополнить экспорт `src/tools/vector/index.ts`: `+export { createVectorSearchTool }`, типы.

## 4. Регистрация и сборка

- [x] 4.1 Реализовать `src/tools/vector/register-tools.ts`: `RegisterVectorToolsDeps` (`sessionStore`, `embeddingsClient`, `falkorClient`), `registerVectorTools(deps)` — регистрирует оба тулa через `registerTool`. Проверка: `npx tsc --noEmit`.

- [x] 4.2 В `src/agents/helper.ts`: добавить `'embeddings.index'`, `'vector.search'` в `HELPER_TOOLS`. Проверка: `npx tsc --noEmit`; `tests/helper.test.ts` зелёный (whitelist может требовать обновления, см. задачу 5.1).

## 5. Интеграция в compose

- [x] 5.1 В `src/agents/compose.ts`: добавить опц. `embeddingsClient?`/`falkorClient?` в `ComposeAgentsOptions`; при их наличии звать `registerVectorTools({sessionStore: getSharedSessionStore(), embeddingsClient, falkorClient})` после регистрации mail-тулов. Проверка: `npx tsc --noEmit`; `tests/compose-agents.test.ts` зелёный.

## 6. Системный промпт

- [x] 6.1 Пополнить `skills/helper.md`: в разделе доступных тулов добавить `embeddings.index` (индексация письма: тема+тело → вектор → FalkorDB; idempotent) и `vector.search` (поиск писем по смыслу: запрос + опц. фильтр аккаунта/папки). Проверка: `loadSkill('helper')` содержит имена обоих тулов.

## 7. Юнит-тесты тулов

- [x] 7.1 `tests/embeddings-index-tool.test.ts`: мок sessionStore (stub EmailFull), мок EmbeddingsClient (fixed vector), мок FalkorClient (records indexEmail): (1) новое письмо → indexEmail с emailId=login:folder:uid и embedding; (2) нет подключения → throws; (3) пустое тело → embedding из темы. Проверка: `npm test -- embeddings-index-tool` зелёный.

- [x] 7.2 `tests/vector-search-tool.test.ts`: мок EmbeddingsClient + FalkorClient: (1) поиск по запросу → embed+search; (2) с фильтром; (3) default k=5. Проверка: `npm test -- vector-search-tool` зелёный.

## 8. Интеграционный gated-тест

- [x] 8.1 `tests/integration/embeddings-index-tool.test.ts` (`INTEGRATION_FALKOR=1`): round-trip через тул с mock-embeddings + живой FalkorDB — индексация письма → поиск возвращает его. Без флага — skipped. Проверка: без флага skip; с флагом — зелёный.

## 9. Финальная проверка

- [x] 9.1 `npm test` — зелёный. Проверка: exit 0.
- [x] 9.2 `npx tsc --noEmit` — без ошибок. Проверка: exit 0.
- [x] 9.3 `npm run lint` — без ошибок. Проверка: exit 0.
- [x] 9.4 `openspec validate semantic-search --strict` — проходит. Проверка: exit 0.

## Workflow follow-up

- После проверки — `/opsx-archive` (синхронизация modified-спек `agent/helper`, `storage/falkor` + new `mail/semantic-search`).
- При восстановлении RouterAI — повторить gated-тесты `INTEGRATION_LLM=1` (embeddings + тул) и зафиксировать wire-формат в observation.
- После `semantic-search` Фаза 3 завершена. Дальше по PLAN.md раздел 6 — Фаза 4 (отправка) или Фаза 5 (CLI).