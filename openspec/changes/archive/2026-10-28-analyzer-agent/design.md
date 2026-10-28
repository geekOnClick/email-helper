# Design

## Context

Готовы `RouterAiClient` (`src/llm/routerai-client.ts`, один шаг `chat()` → `ChatResult`), движок `runToolLoop` (`src/agents/loop.ts`, не зависит от роли), загрузчик `loadSkill` (`src/agents/skill-loader.ts`) и контракт субагентов в `src/agents/subagent.ts` (`Subagent`, `SubagentRegistry`, `createDelegateTool`). Оркестратор (`src/agents/orchestrator.ts`) принимает `OrchestratorOptions.subagents: Subagent[]` и добавляет тул `delegate` только при непустом реестре (глубина делегирования = 1). Роль `analyzer` уже резолвится в `MODEL_ANALYZER` (`src/llm/models.ts`), конфиг-поле `MODEL_ANALYZER` есть; лимиты `AGENT_MAX_ITERATIONS`/`AGENT_MAX_TOOL_RESULT_CHARS` переиспользуются. Тул `mail.fetch` (`MailFetchArgs { login, uid, folder? }` → `EmailFull` с `body`) даёт анализатору тело письма как входной материал. Мотивация — см. `proposal.md`; требования — см. `specs/agent/analyzer/spec.md`. Живой RouterAI временно 500 (observation из `archive/2026-10-28-llm-client/design.md`): дизайн опирается на контракт `llm/routerai`/`agent/orchestrator` и покрывается мок-тестами; gated-тест оставлен на восстановление сервиса.

## Goals / Non-Goals

**Goals:**

- Первый реальный `Subagent`-реализация `Analyzer`, замыкающая роль `analyzer`: собственный цикл `runToolLoop` (роль `'analyzer'`, скил `skills/analyzer.md`) на ограниченном наборе тулов реестра.
- Подключение анализатора к оркестратору через существующий seam без изменения контракта `agent/orchestrator` (фабрика + передача в `subagents`).
- Сохранение глубины делегирования = 1: анализатор НЕ получает `delegate` в свой набор тулов.
- Переиспользование готовых лимитов/типов — без новых полей конфига и новых зависимостей.

**Non-Goals:**

- Тул `mail.analyze` как отдельный тул реестра (см. D1 — решение «анализ делается самим субагентом»).
- Субагент-помощник (`agent/helper`) — отдельный change.
- Слой сборки всего агента (composeAgents, который инициализирует transport+tools+subagents) — здесь только фабрика анализатора; полный bootstrap-слой позднее (когда появится помощник и транспорт).
- Стриминг, агрегация usage, подсчёт стоимости — Фаза 8.
- Векторный поиск/индексация (Фаза 3), отправка писем (Фаза 4), транспорты (Фазы 5–7).

## Decisions

### D1. Анализ делается самим субагентом, отдельный тул `mail.analyze` НЕ вводится

**Контрактный вопрос PLAN.md раздел 3.2** — там значатся и субагент-анализатор, и тул `mail.analyze`. Возможны две альтернативы:

- **(A) Отдельный тул `mail.analyze` в реестре** с args `{ login, uids[], kind: 'summary'|'entities'|'topics' }`, handler которого внутри крутит цикл анализатора или зовёт LLM напрямую.
- **(B) Анализ — поведение субагента-анализатора**: оркестратор через `delegate({ subagent: 'analyzer', instruction })` передаёт задачу; анализатор сам вызывает `mail.fetch` (и др. тулы чтения) в своём цикле и возвращает текстовый ответ. Отдельного тулa нет.

**Выбор: (B).** Обоснование:

- `runToolLoop` уже даёт механизм «модель → тулы → финал»; вводить `mail.analyze` — дублировать этот цикл внутри handler'а тулa, ломая единый механизм tool-calling (и `agent/orchestrator` D1/D2).
- Анализ — это LLM-задача по природе (не детерминированная функция тулa): саммари/сущности/тематика требуют интерпретации моделью, а не фиксированного алгоритма. Делать это «тулом» означает прятать LLM-вызов за детерминированной сигнатурой, что противоречит спеке `agent/orchestrator` (тулы реестра исполняются deterministically, ошибка-как-результат).
- `(B)` естественно ложится в существующий seam: `delegate` уже существует, `Subagent`-контракт уже требует только `run(input): Promise<string>`. Анализатор — это и есть «тул», который оркестратор вызывает через `delegate`; текстовый результат делегирования возвращается в цикл оркестратора как `role:'tool'` и интерпретируется оркестратором при сборке финального ответа.
- Гибкость: анализатор сам решает, сколько писем прочитать (`mail.fetch` по UID), какие тулы чтения звать, в сколько итераций уложиться — без новых сущностей в реестре под каждый сценарий анализа.

**Альтернатива (A)** даёт явную точку вызова `mail.analyze` (удобно для MCP/Фаза 6 — единый реестр тулов экспонируется наружу), но это не бесплатно: `mail.analyze` почти наверняка потребует LLM, а暴露 LLM-вызова как обычного тулa ломает инвариант «тулы реестра — детерминированные». Для MCP точка делегирования → анализатор появится естественно как `delegate` (он уже `ToolDef`), а анализ как доменная задача остаётся за субагентом. При необходимости позже (post-Фаза 2) можно ввести thin `mail.analyze`-обёртку, делегирующую в анализатор — но это отдельный change, не сейчас.

**Следствие:** `mail.analyze` не входит в capabilities этого change; в proposal/impact зафиксировано «не вводится». Если будущий MCP-слой потребует именно имя `mail.analyze`, добавить позже как modified capability без переделки анализатора.

### D2. `Analyzer` — `Subagent`, который крутит свой `runToolLoop`

Контракт `Subagent` требует `{ name, description, run(input): Promise<string> }`. `run`:

1. Грузит скил `analyzer` (в `createAnalyzer`, один раз — кешируется в поле), строит стартовый контекст `[SystemMessage(skill), UserMessage(input)]`.
2. Формирует набор тулов: фильтр `listTools()` по whitelist-множеству (D3), маппит `mapToolsToOpenAi`.
3. Зовёт `runToolLoop({ client, messages, tools, role: 'analyzer', maxIterations, maxToolResultChars })` (без `extraTools` — `delegate` НЕ передаём).
4. Возвращает `loopResult.content` (финальный текстовый ответ модели).

Анализатор **не хранит диалог между вызовами** — каждый `run(input)` независим (без состояния). Оркестратор хранит свой контекст; инструкция делегирования уже несёт нужный контекст. Это соответствует контракту (субагент — функция `input→text`). **Альтернатива:** хранить контекст в анализаторе между делегированиями — rejected (субагент stateless, изоляция контекстов доменов; оркестратор сам контекстуален).

### D3. Whitelist тулов анализатора — минимум для чтения

`ANALYZER_TOOLS = ['mail.fetch']` (константа в `analyzer.ts`). Расширяемо: при появлении `vector.search` (Фаза 3) и др. тулов чтения — добавятся. Фильтр: `listTools().filter(t => ANALYZER_TOOLS.includes(t.name))`. **Не** `mail.connect`/`mail.listFolders`/`mail.search`/`mail.downloadAttachments` — это рутина помощника; анализатор работает поверх УЖЕ подключённой сессии и известных UID (переданных оркестратором в инструкции делегирования). **Альтернатива:** давать весь реестр — rejected (аутентификация/поиск/скачивание — не зона анализатора; нарушение разделения ролей по PLAN.md раздел 3.1).

### D4. Фабрика `createAnalyzer(opts)` — слой сборки

```ts
interface AnalyzerOptions {
  client: RouterAiClient;
  config: Config;
  maxIterations?: number;        // default config.AGENT_MAX_ITERATIONS
  maxToolResultChars?: number;   // default config.AGENT_MAX_TOOL_RESULT_CHARS
  skill?: string;                 // default loadSkill('analyzer')
}
function createAnalyzer(opts: AnalyzerOptions): Subagent
```

Фабрика (а не `Analyzer.create`, как у оркестратора) выбрана для простоты: возвращает `Subagent` — готов для `OrchestratorOptions.subagents`. Не статичный метод класса, т.к. анализатор stateless и не нуждается в фабричной ассинхронности (скил можно грузить в фабрике асинхронно, но `loadSkill` синхронный `readFile` — оставим sync; оркестратор делал async фабрику т.к. хотел `loadSkill` async-готовности, но там `readFile` sync). Реально `loadSkill` синхронный (`node:fs/promises.readFile` — async), значит `createAnalyzer` д.б. `async` ИЛИ грузим скил лениво в первом `run`. **Решение:** `createAnalyzer` — `async` (грузит скил один раз), совпадает с паттерном `Orchestrator.create`. Возвращает `Promise<Subagent>`.

**Альтернатива:** статичный `Analyzer` с `loadSkill` лениво в `run` — rejected (нагрев первого вызова, сложнее тестировать).

### D5. Регистрация в оркестраторе — без изменения контракта

Оркестратор уже принимает `subagents: Subagent[]`. Никакого нового API. Слой сборки:

```ts
// pattern (в прикладном коде / transport слое):
const analyzer = await createAnalyzer({ client, config });
const orchestrator = await Orchestrator.create({
  client, config,
  subagents: [analyzer],
});
```

В этом change factory-функции достаточно; composeAgents-слоя (который собирает ВСЕХ субагентов) нет — он появится с helper-agent'ом. Регистрация повторяющегося имени `analyzer` кидает `субагент уже зарегистрирован` (по контракту `SubagentRegistry.register`).

### D6. Устойчивость и лимиты — переиспользуются

`runToolLoop` + `RegistryToolResolver` уже: ошибка тулa/неизвестный/невалидные args → ошибка-как-результат (цикл не роняет); `maxIterations` → `truncated`. Анализатор передаёт `config.AGENT_MAX_ITERATIONS`/`AGENT_MAX_TOOL_RESULT_CHARS` (с override в опциях/тестах). Новой логики устойчивости — нет.

### D7. Структура модуля и экспорт

- `src/agents/analyzer.ts` — `AnalyzerOptions`, `createAnalyzer(opts): Promise<Subagent>`, константа `ANALYZER_TOOLS`. Класс `Analyzer` — приватный (или не экспортируется), наружу только `Subagent` (минимизирует поверхность API).
- `src/agents/index.ts` — `+export { createAnalyzer }`, `+export type { AnalyzerOptions }`.
- `skills/analyzer.md` — наполняется.

### D8. Тесты — мок-паттерн + gated

Юнит (`tests/analyzer.test.ts`) с мок `RouterAiClient` из `tests/orchestrator.test.ts` (`mockClient(results)`, `tc(...)`): (1) финал без тулов → 1 итерация; (2) `mail.fetch` → финал (2 итерации, в истории `role:'tool'` с телом); (3) ошибка тулa → ошибка-как-результат, финал; (4) исчерпание итераций → `truncated:true`; (5) `delegate` отсутствует в `tools` анализатора; (6) регистрация анализатора + стаб-субагента в одном реестре → оба доступны; (7) повторная регистрация `analyzer` → throw. Gated `tests/integration/analyzer-loop.test.ts` (`INTEGRATION_LLM=1`): один прогон анализа через живой RouterAI (без тулов, как `orchestrator-loop.test.ts`), с observation при 500 (как в llm-client).

## Risks / Trade-offs

- **[Риск: живой RouterAI 500 — цикл анализатора не верифицирован end-to-end]** → Mitigation: построено на контракте `llm/routerai`/`agent/orchestrator` (`ChatResult.toolCalls`, `runToolLoop`); мок-тесты покрывают сценарии. Gated-тест заработает при восстановлении сервиса; observation зафиксирует реальный shape.
- **[Риск: анализатор зовёт тулы, требующие активную IMAP-сессию (mail.fetch), но сессию открывал помощник]** → Mitigation: тул `mail.fetch` сам вернёт `ConnectError` если сессии нет → это ошибка-как-результат в цикле анализатора (модель получит «подключение не установлено» и сообщит об этом). Сборка общения (кто подключает) — задача оркестратора в инструкции делегирования. Контракта «сессия гарантирована» нет — это операционная ответственность оркестратора, не спека анализатора.
- **[Трейд-офф: whitelist тулов зашит константой]** Расширение — правка константы, без нового change-механизма. При росте числа тулов чтения — вынести в конфиг (Фаза 3+). Сейчас достаточно.
- **[Риск: анализатор stateless — теряет контекст между делегированиями]** Это желаемое (изоляция доменов); оркестратор хранит контекст всего диалога и в `instruction` передаёт нужное. Трейд-офф: возможны повторные `mail.fetch` тех же писем при нескольких делегированиях — приемлемо для MVP.

## Migration Plan

Greenfield-модуль `src/agents/analyzer.ts` поверх существующих `src/agents/` и `src/llm/`. Развёртывание:

1. Наполнить `skills/analyzer.md`.
2. `src/agents/analyzer.ts`: `ANALYZER_TOOLS`, `Analyzer` (private), `createAnalyzer` (async фабрика).
3. Пополнить экспорт `src/agents/index.ts`.
4. Юнит-тесты `tests/analyzer.test.ts` (мок клиента, стаб-реестр `mail.fetch`).
5. Gated-тест `tests/integration/analyzer-loop.test.ts`.
6. `npm test`, `tsc`, `lint`, `openspec validate analyzer-agent --strict`.

Откат: удалить `src/agents/analyzer.ts` и правку `index.ts`, откатить `skills/analyzer.md` к каркасу — обратно-совместимо (контракт `agent/orchestrator` не тронут).

## Open Questions

- Нет отложенных unknowns: wire-формат `tool_calls`/цикла анализатора и live-поведение RouterAI — deferred до восстановления сервиса (gated-тест, observation по итогам), но не меняют спеки/подход (анализатор оперирует типизированным `ChatResult` через `runToolLoop`).