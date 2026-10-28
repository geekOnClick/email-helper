# Design

## Context

Готовы `Orchestrator` (`src/agents/orchestrator.ts`, принимает `subagents: Subagent[]`), `Analyzer` (`src/agents/analyzer.ts`, заархивирован) и движок `runToolLoop` (`src/agents/loop.ts`, не зависит от роли). Анализатор подключён через `createAnalyzer(opts)` → `OrchestratorOptions.subagents`, контракт `agent/orchestrator` (глубина делегирования = 1: `delegate` только у оркестратора) соблюдён. Роль `helper` уже резолвится в `MODEL_HELPER` (`src/llm/models.ts`), конфиг-поле есть; лимиты `AGENT_MAX_ITERATIONS`/`AGENT_MAX_TOOL_RESULT_CHARS` переиспользуются. 5 рутинных тулов (`mail.connect`, `mail.listFolders`, `mail.search`, `mail.fetch`, `mail.downloadAttachments`) определены и регистрируются через `registerMailConnectTools(deps)` (`src/tools/mail/register-tools.ts`) на общий `MailSessionStore`; но `registerMailConnectTools` пока нигде не вызывается — слоя инициализации реестра нет. Мотивация — см. `proposal.md`; требования — см. `specs/agent/helper/spec.md`. Живой RouterAI временно 500 (observation в `archive/2026-10-28-llm-client/design.md`): дизайн опирается на контракты `llm/routerai`/`agent/orchestrator`/`agent/analyzer` и покрывается мок-тестами; gated-тест оставлен на восстановление сервиса.

## Goals / Non-Goals

**Goals:**

- Второй реальный `Subagent`-реализация `Helper`, замыкающая роль `helper` (дешёвая модель): собственный цикл `runToolLoop` (роль `'helper'`, скил `skills/helper.md`) на наборе рутинных тулов реестра.
- Слой сборки `composeAgents(opts)`: единая точка инициализации — регистрирует mail-тулы (shared-сессия), строит обоих субагентов, возвращает готовый `Orchestrator` с `subagents: [analyzer, helper]`.
- Сохранение глубины делегирования = 1 (помощник без `delegate`).
- Переиспользование готовых типов/лимитов — без новых полей конфига, без новых зависимостей.

**Non-Goals:**

- Тул `mail.send` и отправка писем — Фаза 4.
- Векторное хранилище и `embeddings.index`/`vector.search` — Фаза 3.
- Транспорт (CLI/Telegram) — Фазы 5/7. `composeAgents` — программный API, вызывается транспортом.
- Конкурентность/изоляция между пользователями — один оркестратор на диалог.
- Стриминг, агрегация usage — Фаза 8.

## Decisions

### D1. Помощник — `Subagent`, крутит свой `runToolLoop`, как и анализатор

Контракт `Subagent` требует `{ name, description, run(input): Promise<string> }`. `run`:
1. Грузит скил `helper` (в `createHelper`, один раз — кешируется), строит `[SystemMessage(skill), UserMessage(input)]`.
2. Формирует набор тулов: фильтр `listTools()` по whitelist рутинных тулов (D2), `mapToolsToOpenAi`.
3. Зовёт `runToolLoop({ client, messages, tools, role: 'helper', maxIterations, maxToolResultChars })` (без `extraTools` — `delegate` не передаём).
4. Возвращает `loopResult.content`.

Stateless между вызовами — как анализатор (D2 в `archive/2026-10-28-analyzer-agent/design.md`): контекст диалога держит оркестратор, инструкция делегирования несёт нужное. **Альтернатива:** хранить контекст — rejected (изоляция доменов, проще тестировать).

### D2. Whitelist тулов помощника — вся почтовая рутина

`HELPER_TOOLS = ['mail.connect', 'mail.listFolders', 'mail.search', 'mail.fetch', 'mail.downloadAttachments']` (константа в `helper.ts`). Это все 5 тулов Фазы 1. Фильтр: `listTools().filter(t => HELPER_TOOLS.includes(t.name))`. Анализатор получает только `mail.fetch` (его зона — анализ содержимого), помощник — всю рутину (подключение/поиск/чтение/скачивание) — по PLAN.md раздел 3.1. `delegate` НЕ входит (глубина = 1). **Альтернатива:** общий реестр целиком — rejected (не весь реестр рутинный; будущие тулы анализа/отправки не рутинные).

### D3. Фабрика `createHelper(opts)` — симметрично `createAnalyzer`

```ts
interface HelperOptions {
  client: RouterAiClient;
  config: Config;
  maxIterations?: number;        // default config.AGENT_MAX_ITERATIONS
  maxToolResultChars?: number;   // default config.AGENT_MAX_TOOL_RESULT_CHARS
  skill?: string;                 // default loadSkill('helper')
}
function createHelper(opts: HelperOptions): Promise<Subagent>
```

Async-фабрика (как `createAnalyzer`, как `Orchestrator.create`) — грузит скил. `Helper` приватный, наружу `Subagent`.

### D4. Слой сборки `composeAgents(opts)` — единая инициализация

```ts
interface ComposeAgentsOptions {
  client: RouterAiClient;
  config: Config;
  accounts: MailAccount[];            // для registerMailConnectTools
  oauth2?: CreateMailProviderOptions['oauth2'];
  tokenStorePath?: string;
  downloadDir?: string;
  maxIterations?: number;
  maxToolResultChars?: number;
}
async function composeAgents(opts: ComposeAgentsOptions): Promise<Orchestrator>
```

Что делает:
1. `registerMailConnectTools({ accounts, oauth2, tokenStorePath, sessionStore: getSharedSessionStore(), downloadDir })` — регистрирует 5 тулов (idempotent по `getSharedSessionStore`; но `registerTool` throws на дубли, поэтому `composeAgents` вызывается один раз за процесс. Тесты используют `resetTools()` между — см. D5).
2. `analyzer = await createAnalyzer({ client, config, ... })`, `helper = await createHelper({ client, config, ... })`.
3. `return Orchestrator.create({ client, config, subagents: [analyzer, helper], ... })`.

**Альтернатива A:** не регистрировать тулы в `composeAgents`, ждать явного вызова `registerMailConnectTools` от транспорта — rejected (цель — единая точка сборки; иначе транспорт должен знать о `registerMailConnectTools` + `getSharedSessionStore`, дублирование). **Альтернатива B:** `Helper` сам регистрирует тулы в `createHelper` — rejected (side-effect прячется внутри фабрики субагента; нарушает принцип: субагент потребляет тулы, но не владеет их регистрацией). Регистрация — ответственность `composeAgents` (assembly layer), не субагента.

### D5. Тесты и `registerTool`-дубликаты

`registerTool` throws `тул уже зарегистрирован: <name>` при повторной регистрации. `composeAgents` зовёт `registerMailConnectTools` → дубликаты в тестах. Решение: unit-тесты `Helper` не зовут `composeAgents`; вместо этого регистрируют только нужные stub-тулы через `registerTool` (паттерн `analyzer.test.ts`). `composeAgents` тестируется отдельно минимально: проверка, что после `composeAgents(resetTools)` оркестратор имеет в наборе `delegate` + оба субагента зарегистрированы. `composeAgents`-тест зовёт `resetTools()` в `beforeEach` (как остальные тесты).

### D6. Подключение к оркестратору

`Orchestrator.create({ ...opts, subagents: [analyzer, helper] })` — `SubagentRegistry.register` кидает на дубликат имени. Оркестратор добавит `delegate` (т.к. реестр непуст) — теперь оба субагента доступны через `delegate({ subagent: 'analyzer'|'helper', instruction })`. Контракт `agent/orchestrator` не тронут (used as-is).

### D7. Структура модулей и экспорт

- `src/agents/helper.ts` — `HELPER_TOOLS`, `Helper` (private), `createHelper(opts): Promise<Subagent>`, `HelperOptions`.
- `src/agents/compose.ts` — `composeAgents(opts): Promise<Orchestrator>`, `ComposeAgentsOptions`.
- `src/agents/index.ts` — `+export { createHelper }`, `+export type { HelperOptions }`, `+export { composeAgents }`, `+export type { ComposeAgentsOptions }`.
- `skills/helper.md` — наполняется.

### D8. Тесты — мок-паттерн + gated

Юнит (`tests/helper.test.ts`) с мок `RouterAiClient` (переиспользуем `mockClient`/`tc` как в `analyzer.test.ts`): (1) финал без тулов → 1 итерация, `role:'helper'`, системный промпт первым; (2) `mail.search` (stub) → результат → финал (2 итерации); (3) ошибка тулa → ошибка-как-результат, финал; (4) исчерпание итераций → без исключения; (5) набор: есть `mail.connect`/`mail.search`/`mail.downloadAttachments`, нет `delegate`. `composeAgents`-минимум: `tests/compose-agents.test.ts` — `composeAgents` строит оркестратор с `delegate`; оба субагента в `getOpenAiTools` через `delegate`-вызов (или проверка, что `delegate` в наборе). Gated `tests/integration/helper-loop.test.ts` (`INTEGRATION_LLM=1`) — прогон `createHelper(...).run(...)` через живой RouterAI, observation при 500 (как `analyzer-loop.test.ts`).

## Risks / Trade-offs

- **[Риск: живой RouterAI 500 — цикл помощника не верифицирован end-to-end]** → Mitigation: построено на контрактах `llm/routerai`/`agent/orchestrator`/`agent/analyzer`; мок-тесты покрывают сценарии. Gated-тест заработает при восстановлении сервиса; observation зафиксирует реальный shape.
- **[Риск: `registerMailConnectTools` не idempotent — повторный вызов кидает на дубликат тулов]** → Mitigation: `composeAgents` вызывается один раз за процесс; в тестах `resetTools()` в `beforeEach`. Если позже понадобится ре-инициализация — обернуть `registerMailConnectTools` проверкой `getTool(name)` (отдельный change).
- **[Риск: помощник зовёт `mail.connect` с учётными данными из конфига]** → Mitigation: `mail.connect` берёт аккаунт по логину из `registerMailConnectTools` (deps.accounts); пароль не попадает в промпт/историю (тул возвращает провайдера+логин, не пароль — спека `mail/connection`). Помощник не угадывает учётные данные (скил `helper.md` ограничение).
- **[Трейд-офф: whitelist рутинных тулов зашит константой]** Расширение — правка константы, без нового механизма. При появлении `mail.send` (Фаза 4) и векторных тулов (Фаза 3) — добавятся; их интеграция в whitelist и idempotency решается в тех change'ах.
- **[Трейд-офф: `composeAgents` регистрирует тулы (side-effect)]** Это сознательное решение (D4) — единая точка сборки. Альтернатива (регистрация извне) перенесла бы знание о mail-тулах в транспорт. Принимаем side-effect ради инкапсуляции сборки.

## Migration Plan

Greenfield-модуль `src/agents/helper.ts` + `src/agents/compose.ts` поверх существующих `src/agents/` и `src/tools/mail/`. Развёртывание:

1. Наполнить `skills/helper.md`.
2. `src/agents/helper.ts`: `HELPER_TOOLS`, `Helper` (private), `createHelper` (async фабрика).
3. `src/agents/compose.ts`: `composeAgents` (регистрация mail-тулов + оба субагента + `Orchestrator.create`).
4. Пополнить экспорт `src/agents/index.ts`.
5. Юнит-тесты `tests/helper.test.ts` (мок клиента, stub-тулы), `tests/compose-agents.test.ts` (минимум).
6. Gated-тест `tests/integration/helper-loop.test.ts`.
7. `npm test`, `tsc`, `lint`, `openspec validate helper-agent --strict`.

Откат: удалить `helper.ts`, `compose.ts`, откатить `index.ts` и `skills/helper.md` — обратно-совместимо (контракт `agent/orchestrator` не тронут).

## Open Questions

- Нет отложенных unknowns: wire-формат и live-поведение RouterAI — deferred до восстановления сервиса (gated-тест, observation по итогам), но не меняют спеки/подход (помощник оперирует типизированным `ChatResult` через `runToolLoop`).