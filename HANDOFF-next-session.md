# HANDOFF: следующая сессия — analyzer-agent

Проект **email-helper** в `~/Рабочий стол/projects/email-helper`. Разработка по SDD (OpenSpec).

## Контекст для старта

1. Прочитай `PLAN.md` (полный план фаз; Фаза 2 — раздел 5, решения в разделе 8),
   `openspec/config.yaml` (артефакты на русском, структурные заголовки и SHALL/MUST — на
   английском), и `openspec/changes/archive/` — увидишь стиль SDD-артефактов и что уже сделано.
2. `openspec/specs/` содержит **5 main-спек**: `mail/connection`, `mail/search`,
   `mail/attachments`, `llm/routerai`, `agent/orchestrator`. `openspec validate --specs --strict`
   → чиисто (5 passed).
3. **Фаза 0 (bootstrap)** и вся **Фаза 1 (mail-connect, mail-search, mail-attachments)**
   завершены и заархивированы. Реализованы 5 тулов: `mail.connect`, `mail.listFolders`,
   `mail.search`, `mail.fetch`, `mail.downloadAttachments` (регистрируются через
   `src/tools/mail/register-tools.ts` → глобальный реестр `src/tools/registry.ts`, `ToolDef`).
   Провайдеры: Яндекс (basic/пароль приложения), Outlook (OAuth2 device code flow — basic-auth
   отключён, см. observation в `archive/2026-10-27-mail-connect/design.md`).
4. **Фаза 2 идёт.** ЗАВЕРШЕНЫ и заархивированы два change'а:
   a) **llm-client** (capability `llm/routerai`) → `archive/2026-10-28-llm-client/`. OpenAI-совместимый
      клиент RouterAI в `src/llm/`: `routerai-client.ts` (`RouterAiClient.chat()`: POST
      `/chat/completions`, injectable fetch, AbortController-таймаут, ретраи 429/5xx/сеть, `redactKey`),
      `schema.ts` (zod, принимает ОБА формата: v1 `tool_calls[]` и legacy `function_call`, нормализует
      к `ToolCall`), `tool-mapping.ts` (имя с точкой ↔ подчёркивание, `mapToolsToOpenAi`),
      `models.ts` (`resolveModel`: явный model > роль > `MODEL_HELPER`), `types.ts`, `index.ts`.
      Конфиг: `+LLM_REQUEST_TIMEOUT_MS`, `LLM_RETRIES`, `LLM_RETRY_BASE_MS`.
   b) **orchestrator** (capability `agent/orchestrator`) → `archive/2026-10-28-orchestrator/`. Каркас
      оркестратора в `src/agents/`:
      - `loop.ts` — `runToolLoop()`: переиспользуемый движок цикла tool-calling
        (модель → `tool_calls` → resolver → `role:"tool"` → повтор), НЕ зависит от роли/промпта.
        `RegistryToolResolver`: успех/исключение/неизвестный тул/невалидные args → ошибка-как-результат
        (цикл не роняет). Параметр `extraTools` — доп. тулы вне реестра (напр. `delegate`). Защита
        от зацикливания (`maxIterations`, флаг `truncated` в `ToolLoopResult`).
      - `result-serializer.ts` — `serializeToolResult()`: JSON→усечение с маркером
        (`maxToolResultChars`).
      - `subagent.ts` — `Subagent { name, description, run(input): Promise<string> }`,
        `SubagentRegistry` (`register`/`get`/`list`/`hasAny`), `createDelegateTool(registry): ToolDef`
        — тул `delegate` (`{ subagent, instruction }`); неизвестный субагент → ошибка-строка без throw.
      - `orchestrator.ts` — `Orchestrator.create(opts)`/`run(userText)`: фасад роли `orchestrator`;
        грузит скил `skills/orchestrator.md`, строит набор тулов (`listTools()` + `delegate` ТОЛЬКО при
        непустом `subagentRegistry`), держит контекст диалога (`messages: ChatMessage[]`),
        `getHistory()`, `getOpenAiTools()`. Делегирование глубины=1: `delegate` есть только в наборе
        оркестратора.
      - `skill-loader.ts` — `loadSkill(roleName)`: чтение `skills/<role>.md`.
      - `index.ts` — экспорт.
      Конфиг: `+AGENT_MAX_ITERATIONS` (default 10), `+AGENT_MAX_TOOL_RESULT_CHARS` (default 20000).
      Системный промпт orchestrator НАПОЛНЕН (`skills/orchestrator.md`). Субагенты-реализации НЕ
      делались — это следующие change'ы (в т.ч. `analyzer-agent`). Тестов: 19 unit + 1 gated
      (`tests/orchestrator.test.ts`, `tests/integration/orchestrator-loop.test.ts`).
5. **ВАЖНАЯ observation** (в `design.md` заархивированных llm-client и orchestrator): живой RouterAI
   на момент проверки (2026-10-28) отдаёт серверный `{"error":"internal error","code":"500"}` на
   `/chat/completions` и `/models` — временное состояние сервиса. Wire-формат `tool_calls` и цикл
   оркестрации **НЕ верифицированы против живого API**; построены по контракту OpenAI v1 и покрыты
   моками (тесты зелёные). Gated-тесты: `tests/integration/routerai-chat.test.ts`
   (`INTEGRATION_LLM=1`) и `tests/integration/orchestrator-loop.test.ts` (`INTEGRATION_LLM=1`). При
   восстановлении сервиса — повторить gated-тесты и зафиксировать реальный shape в observation.
6. **Тесты зелёные:** `npm test` → **171 passed / 9 skipped**. Скипы gated: `INTEGRATION_TEST=1`
   (почта), `INTEGRATION_LLM=1` (LLM/оркестратор). `tsc`, `lint`, `openspec validate --specs --strict`
   — чисто.
7. **Git-состояние (важно):** в репо **только один `initial commit` (`f62f69e`)** — он содержит Фазы
   0+1. **Вся Фаза 2 (llm-client + orchestrator) НЕ закоммичена** — лежит в рабочем дереве как
   modified (`skills/orchestrator.md`, `src/agents/index.ts`, `src/config/schema.ts`,
   `src/llm/index.ts`) + untracked (`src/agents/{loop,orchestrator,result-serializer,skill-loader,subagent}.ts`,
   `src/llm/*`, `tests/orchestrator.test.ts`, `tests/integration/*`, `openspec/specs/{agent,llm}/`,
   `openspec/changes/archive/2026-10-28-*`). В openspec это уже заархивировано формально, но в git —
   нет. Перед стартом `analyzer-agent` имеет смысл закоммитить Фазу 2 (или сделать это в конце
   своего change'а). Не потеряй рабочее дерево.
8. **Runtime-состояние (вне git, локально):** Outlook OAuth2 авторизован — refresh token в
   `.tokens/oauth.json`. Реальные аккаунты и пароль приложения Яндекс — в `.env` (код читает через
   `loadConfigWithAccounts()`). FalkorDB поднят в docker (порт 6380). `MS_CLIENT_ID` в `.env.example`
   — public client_id Thunderbird (`9e5f94bc-...`). `ROUTERAI_API_KEY` в `.env` (валидный, но
   сервис временно 500).
9. **SDD-цикл:** `/opsx-propose <change>` → `/opsx-apply` → `/opsx-archive`. Это slash-команды pi
   (`.pi/prompts/opsx-*.md`), под капотом — openspec CLI (установлен глобально, v1.14.3; PATH может
   не содержать — добавляй `/home/geekonclick/.nvm/versions/node/v22.11.0/bin`). Применяй эти
   команды. Стиль артефактов и modified/new capability pattern — см. `archive/` (особенно последний
   change `orchestrator` — ближе всего по теме).

## Задача: продолжаем Фазу 2 (PLAN.md раздел 5)

Следующий change — **`analyzer-agent`** (capability `agent/analyzer`): субагент-анализатор писем.

### Область analyzer-agent (ориентир, уточни в proposal/design по коду)

- Реализация субагента-анализатора (роль `analyzer`, дорогая модель `MODEL_ANALYZER`): глубокий
  анализ содержимого писем, саммари одного/нескольких писем, извлечение сущностей, классификация
  тематики.
- Наполнение `skills/analyzer.md` (сейчас каркас-заглушка) — системный промпт роли анализатора.
- Анализатор — это `Subagent` (контракт из `src/agents/subagent.ts`): `{ name: 'analyzer',
  description, run(input) }`. `run()` крутит свой `runToolLoop` (роль `analyzer`, свой скил), но со
  **СВОИМ набором тулов** (анализатор НЕ получает `delegate` — глубина делегирования=1; получает только
  нужные тулы реестра, напр. `mail.fetch` для извлечения тел, БЕЗ рутины подключения/скачивания —
  это работа помощника). Опирайся на готовые `runToolLoop`, `loadSkill`, `RouterAiClient`.
- **Тул `mail.analyze` (capability `mail/analyze`? или в рамках `agent/analyzer`?) — САМ РАЗБЕРИСЬ**
  по PLAN.md раздел 3.2: тул `mail.analyze` значится как «анализ содержимого письма(ий), саммари»,
  субагент — анализатор. Реши в proposal: вводить ли отдельный тул `mail.analyze` ИЛИ анализ делается
  самим субагентом-анализатором через `delegate` от оркестратора + `mail.fetch`. **Это ключевой
  архитектурный вопрос — зафиксируй решение в `design.md` (D-пункт) со сравнением альтернатив.**
- **Регистрация анализатора в `SubagentRegistry` оркестратора:** как оркестратор получает субагентов
  (`OrchestratorOptions.subagents`)? Сейчас передаётся извне — нужен слой сборки агента
  (composeAgents / фабрика), либо анализатор сам регистрируется. Опирайся на существующий seam,
  не ломай контракт (`SubagentRegistry.register`/`hasAny`, `createDelegateTool`).
- Юнит-тесты с мок `RouterAiClient` (как в `tests/orchestrator.test.ts` — там есть паттерн `mockClient`
  и `tc()` для построения `ToolCall`); gated-тест (`INTEGRATION_LLM=1`) оставь помеченным, как в
  `tests/integration/orchestrator-loop.test.ts`.
- **БЕЗ новых зависимостей.** БЕЗ изменений в спеках `llm/routerai` и `agent/orchestrator` (они
  used as-is). Возможно modified capability для `mail/*` — НЕТ, анализ не меняет поведение mail-тулов.

### Проверенные факты по коду (опирайся)

- `Subagent`-контракт: `src/agents/subagent.ts`. `SubagentRegistry` кидает при дублирующей
  регистрации (`субагент уже зарегистрирован: <name>`). `createDelegateTool` возвращает
  `ToolDef<DelegateArgs>`; handler сам ловит исключения субагента → `Ошибка субагента <name>: <msg>`.
- Движок: `src/agents/loop.ts` `runToolLoop(opts)` принимает `{ client, messages, tools?,
  toolChoice?, resolver?, extraTools?, maxIterations, maxToolResultChars, role? }`. Возвращает
  `ToolLoopResult { content, toolCalls, iterations, truncated, usage? }`. Анализатору для своего
  цикла нужны `role: 'analyzer'` и свой массив `tools` (подмножество реестра, БЕЗ `delegate`).
- Роль/модель: `AgentRole = 'orchestrator' | 'analyzer' | 'helper'` (`src/llm/types.ts`);_role_
  `analyzer` уже резолвится в `MODEL_ANALYZER` (`src/llm/models.ts`). Конфиг-поле уже есть
  (`MODEL_ANALYZER` default `z-ai/glm-5.2`).
- Тул `mail.fetch` (`src/tools/mail/mail-fetch.tool.ts`): args `{ login: string, uid: number,
  folder?: string }`, возвращает `EmailFull` (тело + заголовки + метаданные вложений). Удобный тул
  для анализатора (тело письма — входной материал для LLM).
- Реестр: `getTool(name)`/`listTools()` (`src/tools/registry.ts`). Подмножество тулов анализатора
  собирай через фильтр `listTools().filter(t => ALLOWED.has(t.name))` (значение своей константы),
  затем `mapToolsToOpenAi`.
- Оркестратор подключает субагентов через `OrchestratorOptions.subagents: Subagent[]`
  (`src/agents/orchestrator.ts`). Слой сборки (кто создаёт `Analyzer` и кладёт в массив) — в новом
  `analyzer-agent`; сейчас такого слоя нет (тесты передают субагентов руками).

### Старт

**Начни с `/opsx-propose analyzer-agent`.** Перед proposal прочитай:

- `src/agents/subagent.ts`, `src/agents/loop.ts`, `src/agents/orchestrator.ts` (как субагенты
  подключаются),
- `skills/analyzer.md` (что наполнять),
- `openspec/specs/agent/orchestrator/spec.md` (контракт делегирования, чтоб не нарушить — там
  requirement «Делегирование субагентам» и «Нет зарегистрированных субагентов → тул `delegate`
  отсутствует»),
- `archive/2026-10-28-orchestrator/proposal.md` + `design.md` (ближайший стиль),
- `tests/orchestrator.test.ts` (паттерн мока клиента `mockClient()` и построения `ToolCall` через
  `tc()`).