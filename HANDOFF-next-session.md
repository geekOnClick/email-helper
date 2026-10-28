# HANDOFF: следующая сессия — Фаза 3b (semantic-search: тулы над фундаментом)

Проект **email-helper** в `~/Рабочий стол/projects/email-helper`. Разработка по SDD (OpenSpec).

## Контекст для старта

1. Прочитай `PLAN.md` (полный план фаз; **Фаза 3 — раздел 5, строка 236**; решения в
   разделе 8), `openspec/config.yaml` (артефакты на русском, структурные заголовки и
   SHALL/MUST — на английском), и `openspec/changes/archive/` — увидишь стиль SDD-артефактов
   и что уже сделано.
2. `openspec/specs/` содержит **9 main-спек**: `mail/connection`, `mail/search`,
   `mail/attachments`, `llm/routerai`, `llm/embeddings`, `agent/orchestrator`,
   `agent/analyzer`, `agent/helper`, `storage/falkor`. `openspec validate --specs --strict`
   → чисто (9 passed).
3. **Фазы 0, 1, 2 и Фаза 3-фундамент (`vector-store`) ЗАВЕРШЕНЫ и заархивированы.**
   Реализованы 5 mail-тулов Фазы 1 + LLM-клиент + оркестратор + анализатор + помощник
   + клиент FalkorDB + клиент embeddings. `git log` → `8f22661 завершена фаза 3`
   (Фаза 3-фундамент закоммичена) + `c0cbdf0 окончание фазы 2 плана` + `f62f69e initial
   commit`. Рабочее дерево чистое.
4. **Фаза 3-фундамент (`vector-store`) → `archive/2026-10-28-vector-store/`.** Реализовано:
   a) **Клиент embeddings** `src/llm/embeddings.ts`: `EmbeddingsClient.embed(texts:
      string[]): Promise<number[][]>` — POST `/embeddings`, модель `EMBEDDINGS_MODEL`,
      injectable `FetchLike`, ретраи 429/5xx/сеть (через экспортированный из
      `routerai-client.ts` `isRetryableStatus`), AbortController-таймаут, `redactKey`,
      ранний возврат `[]` для пустого input, нормализация по `index`. zod-схема
      `embeddingsResponseSchema`. Reuses `RouterAiError` (error-модель несёт
      status/model/retryAfterMs). Экспорт: `src/llm/index.ts` (+`EmbeddingsClient`,
      `embeddingsResponseSchema`, типы; `isRetryableStatus` теперь public).
   b) **Клиент FalkorDB** `src/tools/vector/falkor.ts`: `FalkorClient`
      (`connect`/`close`/`ensureSchema`/`indexEmail`/`searchByEmailVector`/`clear`),
      injectable `FalkorConnection` (паттерн `FetchLike`), фабрика `createFalkorConnection`
      (обёртка над `FalkorDB.connect`+`selectGraph`). Графовая модель: `Email`
      (`emailId=login:folder:uid`, MERGE-перезапись), `Account`, `Folder`, связи
      `HAS_FOLDER`/`CONTAINS`. Векторный индекс `createNodeVectorIndex('Email',{dimension:
      1024, similarityFunction:'cosine'},'embedding')` (ВАЖНО: API `falkordb` v7 —
      options-объект, КЛАД CONTEXT7-ДОКИ БЫЛИ ДЛЯ СТАРОЙ ВЕРСИИ). KNN:
      `CALL db.idx.vector.queryNodes('Email','embedding',$k,vecf32($query)) YIELD node,
      score`. `EMBEDDING_DIM=1024` (bge-m3). `FalkorError`. Экспорт: `src/tools/vector/index.ts`.
   c) **Конфиг:** выровнен default `FALKORDB_PORT` 6379→6380 в `src/config/schema.ts`
      (правка конфига, не спеки). Новых полей нет — ретраи/таймаут embeddings
      переиспользуют `LLM_*`. `falkordb` v7.0.0 добавлена в runtime-зависимости.
   d) **Тесты:** `tests/embeddings-client.test.ts` (10 unit, мок fetch),
      `tests/falkor-client.test.ts` (9 unit, мок FalkorConnection),
      `tests/integration/routerai-embeddings.test.ts` (gated `INTEGRATION_LLM=1`,
      observation при 500), `tests/integration/falkor-client.test.ts` (gated
      `INTEGRATION_FALKOR=1`, round-trip — **верифицирован против живого FalkorDB на 6380,
      зелёный**).
   e) **Спеки:** созданы main-спеки `storage/falkor` (6 требований) и `llm/embeddings`
      (5 требований), синхронизированы при archive.
   f) **API-нюанс `falkordb` v7:** вектор в Cypher передаётся параметром `Float32Array`
      (клиент сериализует в list `vecf32($embedding)`); в `WHERE node[$filterProp] =
      $filterValue` фильтр — `filterProp IS NULL OR ...`.
5. **ВАЖНАЯ observation (продолжает действовать):** живой RouterAI на момент проверки
   (2026-10-29) отдаёт серверный `{"error":"internal error","code":500}` на
   `/chat/completions`, `/models` И `/embeddings` — временное состояние сервиса. Wire-форматы
   `tool_calls` и `/embeddings` **НЕ верифицированы против живого API**; построены по
   контракту OpenAI v1 и покрыты моками (тесты зелёные). `INTEGRATION_LLM=1`-тесты
   (`routerai-chat`, `routerai-embeddings`, `orchestrator-loop`, `analyzer-loop`,
   `helper-loop`) проверены 2026-10-29 — все проходят с observation (500). **При
   восстановлении сервиса — повторить gated-тесты и зафиксировать реальный shape в
   observation.** Embeddings-клиент и FalkorDB-клиент готовы; wire-формат `/embeddings`
   проверится gated-тестом `routerai-embeddings.test.ts` при восстановлении.
6. **Тесты зелёные:** `npm test` → **203 passed / 13 skipped** (41 файл). Скипы gated:
   `INTEGRATION_TEST=1` (почта), `INTEGRATION_LLM=1` (LLM/агенты/embeddings),
   `INTEGRATION_FALKOR=1` (FalkorDB — проходит зелёным против живой БД). `tsc`, `lint`,
   `openspec validate --specs --strict` — чисто.
7. **Git-состояние (чисто):** `git log` → `8f22661 завершена фаза 3` (Фаза 3-фундамент
   закоммичен) + 2 предыдущих коммита. Рабочее дерево чистое. Перед стартом `semantic-search`
   коммитить ничего не нужно.
8. **Runtime-состояние (вне git, локально):**
   - **FalkorDB поднят в docker**, контейнер `email-helper-falkordb`, **порт 6380**, статус
     `Up (healthy)`. Поднять/переподнять: `docker compose -f docker/docker-compose.yml up -d`.
     Пароль `falkordb`. Персистентность через volume `falkordb_data`.
   - Outlook OAuth2 авторизован — refresh token в `.tokens/oauth.json`.
   - Реальные аккаунты и пароль приложения Яндекс — в `.env` (через `loadConfigWithAccounts()`).
   - `ROUTERAI_API_KEY` в `.env` (валидный, но сервис временно 500).
   - `EMBEDDINGS_MODEL=baai/bge-m3` (1024 dim) в `.env.example` и `ConfigSchema` (default).
9. **Что готово под `semantic-search` (фундамент в `src/tools/vector/` и `src/llm/`):**
   - `FalkorClient` (граф, MERGE-индексация, KNN-поиск с фильтром, `clear`) — готов к
     использованию тулами `embeddings.index` и `vector.search`.
   - `EmbeddingsClient.embed(texts)` — готов (но live API пока 500; мок в тестах).
   - `IndexEmailInput` (`emailId`, `login`, `folder`, `uid`, `subject`, `from`, `date`,
     `snippet`, `embedding: number[]`), `VectorSearchInput` (`query`, `k`, `filter?`),
     `VectorSearchResult`.
   - `src/types/email.ts`: `EmailFull` (`body`, `subject`, `folder`, `uid`, `from`, `date`) —
     что индексируем: тема + тело → snippet + embedding.
   - `src/tools/mail/mail-fetch.tool.ts` возвращает `EmailFull` (источник данных для индексации).
   - `src/agents/helper.ts` (`HELPER_TOOLS` whitelist) + `src/agents/compose.ts`
     (точка сборки) — куда добавятся новые тулы.
   - `src/tools/registry.ts` (`ToolDef`, `registerTool`) — фактический реестр тулов.
10. **Готовый фундамент (чаще всего НЕ модифицируется в `semantic-search`):** `llm/routerai`,
    `llm/embeddings`, `storage/falkor`, `agent/orchestrator`, `agent/analyzer` — used as-is.
11. **SDD-цикл:** `/opsx-propose <change>` → `/opsx-apply` → `/opsx-archive`. Slash-команды pi
    (`.pi/prompts/opsx-*.md`), под капотом — openspec CLI (v1.14.3; PATH может не содержать —
    добавляй `/home/geekonclick/.nvm/versions/node/v22.11.0/bin`). Стиль артефактов и
    modified/new capability pattern — см. `archive/` (особенно последние два change'а
    `analyzer-agent`/`helper-agent` — ближе всего по структуре: субагент + фабрика + тул-набор;
    `vector-store` — образец injectable-клиента + gated-тест).

## Задача: Фаза 3b — `semantic-search` (PLAN.md раздел 3.2, 5)

**Цель:** тулы `embeddings.index` и `vector.search` над готовым фундаментом
(`FalkorClient` + `EmbeddingsClient`), гибридный поиск, подключение помощника.

Область (по PLAN.md раздел 3.2 + 5):
- **Тул `embeddings.index`**: принимает письмо (`login`, `uid`, `folder`?) → `mail.fetch`
  (EMailFull) → собрать текст (тема + тело) → `EmbeddingsClient.embed([text])` →
  `FalkorClient.indexEmail({...})`. Либо принимает готовый текст/письмо напрямую — реши в design.
- **Тул `vector.search`**: принимает запрос (строка) + опц. фильтры → `EmbeddingsClient.embed
  ([query])` → `FalkorClient.searchByEmailVector({query, k, filter})` → вернуть
  метаданные+score.
- **Гибридный поиск**: критерии (фильтры по папке/аккаунту/дате) + векторная близость.
  `FalkorClient.searchByEmailVector` уже умеет фильтр по одному свойству — расширить?
  Решить в design (множественные фильтры в Cypher WHERE).
- **Подключение помощника**: добавить `embeddings.index`, `vector.search` в `HELPER_TOOLS`
  whitelist (`src/agents/helper.ts`). Это modified capability `agent/helper` (расширить
  требование «Набор рутинных тулов без делегирования»)? — реши в proposal: спека `agent/helper`
  говорит «рутины (подключение, поиск, чтение, скачивание)» абстрактно; векторные тулы —
  новый вид рутины. См. `archive/2026-10-28-helper-agent/design.md` (D2 whitelist).

**SDD-изменение:** `semantic-search` (capability: `mail/semantic-search` + возможно
modified `agent/helper`). PLAN.md раздел 5 говорит про capability `mail/semantic-search`.

### Ключевые архитектурные вопросы (уточни в proposal/design)

- **Что индексируем.** PLAN.md раздел 8.4: «тема + тело (текст)». Сниппет (обрезка тела ~500
  символов, как в `IndexEmailInput.snippet`) — для хранения в графе. В embedding идёт
  тема + тело (или тема + snippet — реши: полный текст точнее, но длиннее; bge-m3 до 8192
  токенов — тело влезает). см. `src/types/email.ts` (`EmailFull.body`, `EmailFull.subject`).
- **Интеграция в compose.** Тул `embeddings.index` должен дёргать `mail.fetch` (тул из
  реестра) ИЛИ принимать готовый `EmailFull`? — design. Тул зависит от `EmbeddingsClient`+
  `FalkorClient` (новые зависимости, которых нет в `composeAgents` сейчас — туда передастся
  `FalkorClient`/`EmbeddingsClient`). Решить, кто создаёт клиентов (`composeAgents` или
  фабрика тулов) — симметрично `mail.connect`.
- **Доступ к `mail.fetch` из тулa `embeddings.index`.** Тул `embeddings.index` принимает
  `login`+`uid`+`folder` → зовёт `mail.fetch` handler (через `sessionStore`? через
  `getTool('mail.fetch')`?). Или принимает уже готовое тело? — design.
- **Вектор запроса в `vector.search`.** `vector.search` должен сам строить embedding
  запроса (через `EmbeddingsClient.embed([query])`) → значит тул зависит от
  `EmbeddingsClient`. Решить в design.
- **Гибридный поиск.** В PLAN.md — «критерии (фильтры) + векторная близость». `FalkorClient`
  `searchByEmailVector` принимает единственный `filter: {prop, value}`. Расширить
  `VectorSearchInput` (массив фильтров, дата?) — design. Либо фильтр оставляем простым,
  гибрид = KNN + опц. один фильтр. Решить.
- **Тесты.** FalkorDB-клиент верифицирован (`INTEGRATION_FALKOR=1` зелёный), но тул `embeddings.index`
  зависит ещё от `mail.fetch` (нужен мок sessionStore или stub `mail.fetch` тулa, паттерн
  `tests/helper.test.ts`). `vector.search` — мок `EmbeddingsClient`+`FalkorClient`.
  Gated-тест на live RouterAI+ FalkorDB — только после восстановления сервиса.

### Старт

**Начни с `/opsx-propose semantic-search`.** Перед proposal прочитай:

- `PLAN.md` раздел 3.2 (тулы `embeddings.index`, `vector.search`), раздел 5 (Фаза 3),
  раздел 8.4 (что индексируем: тема + тело), раздел 6 (Фаза 3 после Фазы 2).
- `src/tools/vector/falkor.ts` (`FalkorClient`, `IndexEmailInput`, `VectorSearchInput`,
  `VectorSearchResult`, `EMBEDDING_DIM`), `src/tools/vector/index.ts` (экспорты).
- `src/llm/embeddings.ts` (`EmbeddingsClient.embed`), `src/llm/index.ts` (экспорты).
- `src/tools/mail/mail-fetch.tool.ts` (источник `EmailFull` для индексации), `src/types/email.ts`
  (`EmailFull.body`/`subject`).
- `src/tools/registry.ts` (`ToolDef`, `registerTool`), `src/tools/mail/register-tools.ts`
  (паттерн регистрации тулов с deps).
- `src/agents/helper.ts` (`HELPER_TOOLS` whitelist), `src/agents/compose.ts` (точка сборки,
  куда передать FalkorClient/EmbeddingsClient).
- `archive/2026-10-28-helper-agent/` (паттерн whitelist тулов + modified-vs-new capability),
  `archive/2026-10-28-vector-store/` (ближайший стиль, injectable-клиенты).

## ⚠️ Runtime-блокер

Живой RouterAI отдаёт **500** на `/chat/completions` и `/embeddings`. Это значит:
- Тулы `embeddings.index`/`vector.search` построить можно (на моках), но **end-to-end не
  проверить** до восстановления сервиса.
- Gated-тест `INTEGRATION_LLM=1` для embeddings-клиента (и будущего тулa) провален в
  observation (500) — это ожидаемое поведение gated-теста, не ошибка.
- Проверь перед стартом: `source .env && curl -s -X POST "$ROUTERAI_BASE_URL/embeddings"
  -H "Authorization: Bearer $ROUTERAI_API_KEY" -H "Content-Type: application/json" -d
  '{"model":"baai/bge-m3","input":"test"}'` — если вернёт 200/вектор — сервис восстановился,
  повтори gated-тесты и зафиксируй wire-формат в observation.
- FalkorDB при этом работает (6380, healthy, gated-тест зелёный) — векторный round-trip
  проверен.