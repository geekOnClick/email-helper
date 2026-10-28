# HANDOFF: следующая сессия — Фаза 3 (векторное хранилище и семантический поиск)

Проект **email-helper** в `~/Рабочий стол/projects/email-helper`. Разработка по SDD (OpenSpec).

## Контекст для старта

1. Прочитай `PLAN.md` (полный план фаз; **Фаза 3 — раздел 5, строка 236**; решения в
   разделе 8), `openspec/config.yaml` (артефакты на русском, структурные заголовки и
   SHALL/MUST — на английском), и `openspec/changes/archive/` — увидишь стиль SDD-артефактов
   и что уже сделано.
2. `openspec/specs/` содержит **7 main-спек**: `mail/connection`, `mail/search`,
   `mail/attachments`, `llm/routerai`, `agent/orchestrator`, `agent/analyzer`,
   `agent/helper`. `openspec validate --specs --strict` → чисто (7 passed).
3. **Фаза 0 (bootstrap)** и вся **Фаза 1 (mail-connect, mail-search, mail-attachments)**
   завершены и заархивированы. Реализованы 5 тулов: `mail.connect`, `mail.listFolders`,
   `mail.search`, `mail.fetch`, `mail.downloadAttachments` (регистрируются через
   `src/tools/mail/register-tools.ts` → глобальный реестр `src/tools/registry.ts`, `ToolDef`).
   Провайдеры: Яндекс (basic/пароль приложения), Outlook (OAuth2 device code flow —
   basic-auth отключён, см. observation в `archive/2026-10-27-mail-connect/design.md`).
4. **Фаза 2 ЗАВЕРШЕНА и заархивирована** (4 change'а):
   a) **llm-client** → `archive/2026-10-28-llm-client/`. OpenAI-совместимый клиент RouterAI
      в `src/llm/`: `routerai-client.ts` (`RouterAiClient.chat()`: POST `/chat/completions`,
      injectable fetch, AbortController-таймаут, ретраи 429/5xx/сеть, `redactKey`),
      `schema.ts` (zod, принимает ОБА формата: v1 `tool_calls[]` и legacy `function_call`,
      нормализует к `ToolCall`), `tool-mapping.ts` (имя с точкой ↔ подчёркивание,
      `mapToolsToOpenAi`), `models.ts` (`resolveModel`: явный model > роль > `MODEL_HELPER`),
      `types.ts`, `index.ts`. Конфиг: `+LLM_REQUEST_TIMEOUT_MS`, `LLM_RETRIES`,
      `LLM_RETRY_BASE_MS`.
   b) **orchestrator** → `archive/2026-10-28-orchestrator/`. Каркас в `src/agents/`:
      `loop.ts` (`runToolLoop` — переиспользуемый движок цикла tool-calling, НЕ зависит от
      роли/промпта; `RegistryToolResolver`: ошибка-как-результат; `extraTools`; защита от
      зацикливания), `result-serializer.ts` (`serializeToolResult`), `subagent.ts`
      (`Subagent`, `SubagentRegistry`, `createDelegateTool`), `orchestrator.ts`
      (`Orchestrator.create(opts)/run(userText)`, контекст диалога, `delegate` только при
      непустом реестре), `skill-loader.ts` (`loadSkill`), `index.ts`. Конфиг:
      `+AGENT_MAX_ITERATIONS` (default 10), `+AGENT_MAX_TOOL_RESULT_CHARS` (default 20000).
   c) **analyzer-agent** → `archive/2026-10-28-analyzer-agent/`. `src/agents/analyzer.ts`:
      `Analyzer` (роль `analyzer`, дорогая `MODEL_ANALYZER`) — `Subagent`, крутит свой
      `runToolLoop` с whitelist `['mail.fetch']`, БЕЗ `delegate`. Фабрика
      `createAnalyzer(opts): Promise<Subagent>`. Наполнен `skills/analyzer.md`. Решение
      (design D1): тул `mail.analyze` НЕ вводится — анализ делается самим субагентом через
      `delegate` + `mail.fetch`.
   d) **helper-agent** → `archive/2026-10-28-helper-agent/`. `src/agents/helper.ts`:
      `Helper` (роль `helper`, дешёвая `MODEL_HELPER`) — `Subagent`, крутит свой `runToolLoop`
      с whitelist всех 5 рутинных тулов, БЕЗ `delegate`. Фабрика `createHelper(opts)`.
      `src/agents/compose.ts`: `composeAgents(opts)` — единая точка сборки
      (регистрирует mail-тулы через `registerMailConnectTools` на shared `MailSessionStore`,
      строит analyzer+helper, возвращает `Orchestrator` с `subagents: [analyzer, helper]`).
      Наполнен `skills/helper.md`.
   Контракты: `agent/orchestrator` (глубина делегирования = 1: `delegate` только у
   оркестратора), `agent/analyzer`, `agent/helper`, `llm/routerai` — все used as-is, НЕ
   модифицируются в Фазе 3.
5. **ВАЖНАЯ observation** (в `design.md` заархивированных llm-client/orchestrator/analyzer/
   helper): живой RouterAI на момент проверки (2026-10-28) отдаёт серверный
   `{"error":"internal error","code":500}` на `/chat/completions` и `/models` — временное
   состояние сервиса. Wire-формат `tool_calls` и циклы агентов **НЕ верифицированы против
   живого API**; построены по контракту OpenAI v1 и покрыты моками (тесты зелёные).
   Gated-тесты (`INTEGRATION_LLM=1`): `tests/integration/{routerai-chat,orchestrator-loop,
   analyzer-loop,helper-loop}.test.ts`. **При восстановлении сервиса — повторить gated-тесты
   и зафиксировать реальный shape в observation.** Это касается и Фазы 3: embeddings-эндпоинт
   `/embeddings` тоже не верифицирован против живого API — нужен gated-тест.
6. **Тесты зелёные:** `npm test` → **184 passed / 11 skipped** (37 файлов). Скипы gated:
   `INTEGRATION_TEST=1` (почта), `INTEGRATION_LLM=1` (LLM/агенты). `tsc`, `lint`,
   `openspec validate --specs --strict` — чисто.
7. **Git-состояние (чисто):** `git log` → `c0cbdf0 окончание фазы 2 плана` (Фаза 2
   закоммичена) + `f62f69e initial commit` (Фазы 0+1). Рабочее дерево чистое. Перед стартом
   Фазы 3 коммитить ничего не нужно.
8. **Runtime-состояние (вне git, локально):**
   - **FalkorDB поднят в docker**, контейнер `email-helper-falkordb`, **порт 6380**, статус
     `Up (healthy)`. Поднять/переподнять: `docker compose -f docker/docker-compose.yml up -d`.
     Пароль `falkordb` (по умолчанию). Персистентность через volume `falkordb_data`.
   - Outlook OAuth2 авторизован — refresh token в `.tokens/oauth.json`.
   - Реальные аккаунты и пароль приложения Яндекс — в `.env` (код читает через
     `loadConfigWithAccounts()`).
   - `MS_CLIENT_ID` в `.env.example` — public client_id Thunderbird (`9e5f94bc-...`).
   - `ROUTERAI_API_KEY` в `.env` (валидный, но сервис временно 500).
   - `EMBEDDINGS_MODEL=baai/bge-m3` в `.env.example` и в `ConfigSchema` (default).
   - **⚠️ Несоответствие порта FalkorDB:** `docker-compose.yml` маппит `${FALKORDB_PORT:-6380}:6379`,
     `.env.example` задаёт `FALKORDB_PORT=6380`, но в `ConfigSchema` default `6379`
     (`src/config/schema.ts:45`). Локально `.env` задаёт 6380, так что рабочий конфиг
     корректен, но default в schema расходится с compose — при дизайне FalkorDB-клиента
     учти, что подключаться надо на `config.FALKORDB_PORT` (из `.env` = 6380), а не на
     хардкод. Можно заодно выровнять default в schema на 6380 (modified capability? — нет,
     это конфиг, не спека; просто правка `schema.ts`, если решишь).
9. **Что уже есть под Фазу 3 (заглушки/сеймы):**
   - `src/tools/vector/index.ts` — заглушка `export {}` (Фаза 3 наполнит: `falkor.ts`,
     `embeddings.ts`, `search.ts` по структуре PLAN.md раздел 4).
   - В `src/llm/` **нет embeddings-клиента** — Фаза 3 создаст (напр. метод `embed()` в
     `RouterAiClient` или отдельный клиент на тот же baseUrl + ключ, POST `/embeddings`,
     модель `EMBEDDINGS_MODEL=baai/bge-m3`). Решение — в design.
   - `falkordb` npm-пакет **НЕ установлен** — Фаза 3 добавит зависимость (`npm i falkordb`).
     Это первая новая runtime-зависимость со времён Фазы 0 — зафиксируй в proposal Impact.
   - `HELPER_TOOLS` whitelist в `src/agents/helper.ts` сейчас = 5 тулов Фазы 1. Новые тулы
     Фазы 3 (`embeddings.index`, `vector.search`) — добавятся в whitelist помощника
     (по PLAN.md раздел 3.2 они субагента-помощника). Это modified capability `agent/helper`
     или новый capability? — реши в proposal.
10. **SDD-цикл:** `/opsx-propose <change>` → `/opsx-apply` → `/opsx-archive`. Slash-команды pi
    (`.pi/prompts/opsx-*.md`), под капотом — openspec CLI (установлен глобально, v1.14.3;
    PATH может не содержать — добавляй `/home/geekonclick/.nvm/versions/node/v22.11.0/bin`).
    Стиль артефактов и modified/new capability pattern — см. `archive/` (особенно последние
    два change'а `analyzer-agent`/`helper-agent` — ближе всего по структуре: субагент +
    фабрика + тул-набор).

## Задача: Фаза 3 (PLAN.md раздел 5, строка 236)

**Цель:** индексация писем в FalkorDB, поиск по смыслу.

Область Фазы 3 (по PLAN.md):
- Клиент FalkorDB (`falkordb` npm), соединение из Docker (порт 6380).
- Графовая модель: узел `Email` (id, тема, дата, отправитель, папка) + связь к
  `Account`/`Folder`.
- Векторный индекс над embedding тела/темы письма.
- `embeddings.index` (RouterAI embeddings через `baai/bge-m3`).
- `vector.search` — семантический поиск писем.
- Гибридный поиск: критерии (фильтры) + векторная близость.
- Тесты с встроенным/тестовым FalkorDB.

**SDD-изменения по PLAN.md:** `vector-store`, `semantic-search` (capabilities:
`storage/falkor`, `mail/semantic-search`).

### Ключевые архитектурные вопросы (уточни в proposal/design)

- **Дробление Фазы 3 на change'ы.** PLAN.md предлагает два: `vector-store`
  (capability `storage/falkor`) и `semantic-search` (capability `mail/semantic-search`).
  `vector-store` — FalkorDB-клиент + графовая модель + векторный индекс + embeddings-клиент
  (фундамент); `semantic-search` — тулы `embeddings.index` и `vector.search` + гибридный
  поиск (поверх фундамента). **Начни с `vector-store`** (он разблокирует второй). Реши в
  proposal, входит ли embeddings-клиент в `vector-store` или в `semantic-search` —
  обоснованно.
- **Embeddings-клиент.** Новый метод в `RouterAiClient` (`embed(texts): Promise<number[][]>`,
  POST `/embeddings`, модель `EMBEDDINGS_MODEL`) ИЛИ отдельный модуль `src/llm/embeddings.ts`.
  Это modified capability `llm/routerai` (добавляется требование embeddings) или новый
  capability `llm/embeddings`? — если отдельный модуль без изменения контракта
  `RouterAiClient.chat()`, то новый. Зафиксируй решение в design (D-пункт).
- **FalkorDB-клиент.** Где живёт: `src/tools/vector/falkor.ts` (по PLAN.md структуре) ИЛИ
  `src/storage/falkor.ts` (отдельный слой хранилища, не «тул»)? Тулы (`embeddings.index`,
  `vector.search`) — в `src/tools/vector/`, поверх клиента. Решение — в design.
- **Подключение помощника.** Новые тулы `embeddings.index`, `vector.search` — субагента
  помощника (PLAN.md раздел 3.2). Добавляются в `HELPER_TOOLS` whitelist
  (`src/agents/helper.ts`). Это modified capability `agent/helper` (меняется набор тулов)?
  — по контракту `agent/helper` спека требует «рутинные тулы (подключение, поиск, чтение,
  скачивание)»; векторные тулы — это тоже рутина помощника, но новый вид. Реши: modified
  `agent/helper` (расширить требование «Набор рутинных тулов без делегирования» сценарием
  векторных тулов) ИЛИ оставить спеку `agent/helper` как есть (whitelist — реализационная
  деталь, спека говорит «рутинные тулы» абстрактно). Если спека не меняется — `skip_specs`
  для `agent/helper` части не нужен, просто правка кода.
- **Тесты.** FalkorDB поднят локально (порт 6380, healthy) — можно писать gated-тест
  (`INTEGRATION_FALKOR=1`) против живого FalkorDB (аналог `INTEGRATION_LLM=1`/`INTEGRATION_TEST=1`).
  Unit-тесты — с моком FalkorDB-клиента (injectable, как `FetchLike` в `RouterAiClient`).
  Embeddings-клиент — мок (возвращаем предопределённые векторы), gated-тест
  (`INTEGRATION_LLM=1`) против живого RouterAI `/embeddings` (если сервис восстановится).

### Старт

**Начни с `/opsx-propose vector-store`.** Перед proposal прочитай:

- `PLAN.md` раздел 5 (Фаза 3, строка 236) + раздел 3.2 (тулы `embeddings.index`,
  `vector.search`) + раздел 8.4 (объём писем, что индексируем: тема + тело).
- `src/llm/routerai-client.ts` (паттерн injectable `FetchLike`, ретраи, redact — образец
  для embeddings-клиента), `src/llm/types.ts`, `src/llm/models.ts`, `src/llm/index.ts`.
- `src/tools/vector/index.ts` (заглушка), `src/tools/registry.ts` (`ToolDef`, `registerTool`).
- `src/agents/helper.ts` (`HELPER_TOOLS` whitelist), `src/agents/compose.ts` (как тулы
  регистрируются и субагенты подключаются — `vector-store` не должен ломать этот seam).
- `src/config/schema.ts` (поля `FALKORDB_HOST/PORT/PASSWORD`, `EMBEDDINGS_MODEL` —
  обратить внимание на несоответствие default порта 6379 vs compose 6380).
- `docker/docker-compose.yml` (порт 6380, пароль, персистентность).
- `src/types/email.ts` (`EmailFull`, `EmailMessage` — что индексируем: тема + тело).
- `openspec/specs/llm/routerai/spec.md` (контракт, чтоб понять, modified или new capability
  для embeddings), `openspec/specs/agent/helper/spec.md` (whitelist контракта).
- `archive/2026-10-28-llm-client/` (ближайший стиль для клиента с injectable transport +
  ретраи), `archive/2026-10-28-helper-agent/` (ближайший стиль для modified-vs-new
  capability решения и тул-набора).
- `tests/llm-client.test.ts` (паттерн мока fetch для embeddings-клиента),
  `tests/integration/routerai-chat.test.ts` (паттерн gated-теста с observation при 500).