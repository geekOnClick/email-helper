# Design

## Context

Готов `RouterAiClient` (`src/llm/routerai-client.ts`) — один шаг `chat(request) → ChatResult` с `toolCalls: ToolCall[]` (имя в доменном виде с точками, `args` распарсены или `parseError`). Готовы `mapToolsToOpenAi(listTools())` (`ToolDef` → `OpenAiTool`, `.`↔`_`) и реестр `src/tools/registry.ts` (`getTool`, `listTools`). Типы сообщений (`ChatMessage`, `AssistantMessage.toolCalls`, `ToolResultMessage`) — в `src/llm/types.ts`. Сериализация тулов/сообщений в wire-формат делает сам клиент (`serializeMessage`, `toOpenAiToolName`), поэтому оркестратор работает на доменных типах. Конфиг уже имеет `LLM_*` поля; моделей-ролей достаточно. Заглушка `src/agents/index.ts` пуста. **Живой RouterAI временно 500** (observation из `archive/2026-10-28-llm-client/design.md`) — дизайн опирается на контракт `llm/routerai` и покрывается мок-тестами; gated-тест цикла оставлен на восстановление сервиса. Мотивация и охват — см. `proposal.md`; требования — см. `specs/agent/orchestrator/spec.md`.

## Goals / Non-Goals

**Goals:**

- Переиспользуемый движок цикла tool-calling `runToolLoop`, не привязанный к роли/промпту: любой агент (оркестратор/анализатор/помощник) крутит его со своим системным промптом и набором тулов.
- Оркестратор как фасад: контекст диалога (история между репликами), скил из `skills/orchestrator.md`, набор тулов из реестра.
- Seam делегирования: интерфейс `Subagent` + `SubagentRegistry` + тул `delegate` — готов к подключению `analyzer`/`helper` в их change'ах; сейчас тестируется стабом.
- Устойчивость цикла к ошибкам тулов, неизвестным тулам, невалидным args, зацикливанию — без необработанных исключений наружу (кроме ошибок LLM-клиента, которые уже типизированы `RouterAiError`).

**Non-Goals:**

- Реализации субагентов `analyzer`/`helper` — отдельные change'ы (`analyzer-agent`, `helper-agent`) со своими спеками/скилами.
- `mail.analyze` — change анализатора; здесь лишь контракт, куда он встанет.
- Стриминг, подсчёт стоимости/usage-агрегация — Фаза 8 (observability). `usage` из `ChatResult` прокидывается в `ToolLoopResult`, но не суммируется.
- Транспорт (CLI/Telegram) — Фазы 5/7. Оркестратор — программный API, вызывается транспортом.
- MCP-экспозиция cycle — Фаза 6.
- Конкурентность/изоляция контекста между пользователями — один оркестратор на диалог; многопользовательский изолированный контекст — Фаза 7 (Telegram).

## Decisions

### D1. Цикл как чистая функция `runToolLoop`, а не метод клиента
Клиент `RouterAiClient` осознанно делает один шаг (спека `llm/routerai`, Non-Goals там). Цикл — отдельная забота агента. `runToolLoop({ client, request, tools, resolver, maxIterations, maxToolResultChars }) → Promise<ToolLoopResult>` живёт в `src/agents/loop.ts`, не трогает `llm/`. Любой агент вызывает её. **Альтернатива:** метод `client.chatWithTools()` — rejected (перегружает клиент осведомлённостью о реестре и политике loop).

### D2. Разделение `runToolLoop` (движок) и `Orchestrator` (фасад роли)
Loop не знает про скилы/контекст/субагентов — только про клиента, тулы и resolver. Оркестратор собирает: грузит скил, держит `history: ChatMessage[]`, мапит тулы, прогоны loop, копит `toolCalls`/`usage` по всем итерациям. Это позволит анализатору/помощнику переиспользовать тот же loop со своим фасадом. **Альтернатива:** один класс-агент с флагом роли — rejected (смешение механики и роли, difícil тестировать роли изолированно).

### D3. Resolver тулов как injectable зависимость loop
`ToolResolver = { resolve(name, args): Promise<ToolResultMessage> }` — loop вызывает `resolver.resolve(...)` для каждого `tool_call`. Реализация по умолчанию `RegistryToolResolver` обёртывает `getTool(name)` из реестра, исполняет handler, ловит исключения, возвращает `ToolResultMessage` с результатом ИЛИ с описанием ошибки. Это позволяет тестировать loop со стаб-resolver'ом без реестра и подменять поведение. **Альтернатива:** loop дергает `getTool` напрямую — rejected (связка с глобальным реестром, мешает DI/тестам).

### D4. Обработка ошибок тулов — ошибка как результат, не прерывание
Спека требует «тул выбросил исключение → результат с описанием, цикл продолжается». `RegistryToolResolver` оборачивает `handler(args)` в try/catch. Исключение → `ToolResultMessage{ content: "Ошибка тулa <name>: <message>" }`. Невалидные args (`ToolCall.parseError` или `args === null`) → `ToolResultMessage{ content: "Невалидные аргументы тулa <name>: <parseError>" }`. Неизвестный тул (`getTool` → undefined) → `ToolResultMessage{ content: "Тул не найден: <name>" }`. Никакое исключение тулa не выходит за resolver.

### D5. Усечение результата тулa
`serializeToolResult(value, maxChars)`: `JSON.stringify(value)` (или `String(value)` при не-JSON-сериализуемом). Если длиннее `maxChars` → срез + `\n...[результат усечён: <n> символов из <total>]`. `null`/`undefined` → `"null"`. Это защищает контекст от больших тел писем (`mail.fetch`) и списков (`mail.search`).

### D6. Лимит итераций — мягкая остановка
Цикл крутится, пока `toolCalls.length > 0` и `iteration < maxIterations`. При достижении лимита возвращаем `ToolLoopResult { truncated: true, finalContent: <последний content>, iterations: maxIterations }`. `truncated: false` при нормальном финале. Жёстко НЕ обрываем с throw — даём транспорту показать последний ответ с пометкой.

### D7. Контекст диалога в `Orchestrator`
`Orchestrator` хранит `messages: ChatMessage[]`, инициализируется системным промптом. `run(userText): Promise<OrchestratorResult>` добавляет `UserMessage`, прогоняет `runToolLoop` (передавая текущий `messages` как request-сообщения), затем дополняет историю `AssistantMessage(финаль)` и возвращает ответ. Между репликами история (включая `tool`-сообщения) сохраняется. `OrchestratorResult { content, toolCalls, iterations, truncated, usage? }`. **Альтернатива:** контекст в транспорте — rejected (оркестратор — естественный владелец диалога, транспорт тонкий).

### D8. Скил-лоадер — чтение `skills/<role>.md`
`loadSkill(roleName): string` читает `skills/${roleName}.md` через `node:fs`. Если файл отсутствует — бросает читаемую ошибку с путём. Не парсит markdown (промпт — весь файл как одна строка). Переиспользуется будущими агентами. **Альтернатива:** инлайн-промпт в коде — rejected (редактируется без пересборки, единое место).

### D9. Seam делегирования — `Subagent` + `SubagentRegistry` + тул `delegate`
```ts
interface Subagent {
  name: string;            // доменное, напр. 'analyzer'
  description: string;     // для тул-def
  run(input: string): Promise<string>;
}
interface SubagentRegistry {
  list(): Subagent[];
  get(name: string): Subagent | undefined;
}
```
`createDelegateTool(registry): ToolDef` — `delegate({ subagent, instruction })`. При вызове: `registry.get(subagent)` → `run(instruction)` → строку (с усечением по `maxToolResultChars` через общий сериализатор). Неизвестный субагент → ошибка-как-результат. Оркестратор включает `delegate` в набор тулов **только если `registry.list()` непуст** (спека: «нет субагентов → тулa delegate нет»). `OrchestratorOptions.subagents?: Subagent[]`. Реальной делегации пока нет (реестр пуст по умолчанию) — поведение покрыто тестом со стаб-субагентом.

### D10. Вложенные tool-calls субагентов (изоляция)
Subagent.run сам может крутить `runToolLoop` (субагент-помощник со своим реестром тулов). Чтобы избежать бесконечной вложенности/рекурсии (оркестратор → delegate → helper → delegate → ...), `delegate` есть только в наборе тулов оркестратора (он не в `listTools()` по умолчанию — добавляется Orchestrator'ом ad-hoc), а субагенты не получают `delegate` в свой набор. Глубина делегирования = 1. **Альтернатива:** счётчик глубины — rejected (избыточно для текущей архитектуры; проще ограничить набор тулов).

### D11. Возврат tool_calls в результате
`ToolLoopResult.toolCalls` аккумулирует все вызовы тулов всех итераций (для логирования/transport-прогресса — Фаза 5/8). Сами `assistant`-сообщения с `tool_calls` уже в истории (D7). `usage` — из последней итерации (не суммируем; агрегация — Фаза 8).

### D12. Конфиг
Добавить 2 опц. поля в `ConfigSchema` (back-compat): `AGENT_MAX_ITERATIONS` (`z.coerce.number().int().positive().default(10)`), `AGENT_MAX_TOOL_RESULT_CHARS` (`z.coerce.number().int().positive().default(20000)`). Оркестратор читает их в опциях (с override в тестах через injectable options).

### D13. Структура модулей
- `src/agents/loop.ts` — `runToolLoop`, `ToolLoopOptions`, `ToolLoopResult`, `serializeToolResult`, `ToolResolver`, `RegistryToolResolver`.
- `src/agents/subagent.ts` — `Subagent`, `SubagentRegistry`, `createDelegateTool`.
- `src/agents/skill-loader.ts` — `loadSkill`.
- `src/agents/orchestrator.ts` — `Orchestrator`, `OrchestratorOptions`, `OrchestratorResult`.
- `src/agents/index.ts` — экспорт (замена заглушки).

## Risks / Trade-offs

- **[Риск: живой RouterAI временно 500 — цикл не верифицирован end-to-end против API]** → Mitigation: loop построен на контракте `llm/routerai` (`ChatResult.toolCalls`); мок-тесты покрывают все ветви (финал, один вызов, несколько, ошибка, неизвестный, невалидные args, лимит). Gated-тест `INTEGRATION_LLM=1` оставлен — заработает при восстановлении сервиса; observation зафиксирует реальный shape.
- **[Риск: модель зацикливается, вызывая тулы без финала]** → Mitigation: D6 (`AGENT_MAX_ITERATIONS`, мягкая остановка с `truncated`).
- **[Риск: большие результаты тулов рвут контекст]** → Mitigation: D5 (усечение по `AGENT_MAX_TOOL_RESULT_CHARS`).
- **[Трейд-офф: вся история в одном массиве, без сжатия/summary]** Для MVP-диалогов (несколько реплик) приемлемо; compaction — Фаза 8. Замечание: `tool`-сообщения остаются в истории между репликами (по требованию «вторая реплика помнит первую»).
- **[Риск: невалидные args от модели роняют handler]** → Mitigation: D3/D4 — resolver проверяет `args`/`parseError` до handler, отдаёт ошибку-как-результат.
- **[Риск: контекст растёт из-за `tool`-сообщений между репликами]** Связано с предыдущим трейд-оффом; для текущего объёма — ок. Управление памятью диалога — Фаза 8.

## Migration Plan

Greenfield-модуль `src/agents/` поверх существующих `llm/` и `tools/`. Развёртывание:

1. Добавить опц. поля `AGENT_MAX_ITERATIONS`, `AGENT_MAX_TOOL_RESULT_CHARS` в `ConfigSchema`.
2. `skill-loader.ts` (D8).
3. `loop.ts`: `serializeToolResult`, `ToolResolver`/`RegistryToolResolver`, `runToolLoop`.
4. `subagent.ts`: интерфейсы, реестр, `createDelegateTool`.
5. `orchestrator.ts` (D7, D9): сборка набора тулов (registry + delegate-if-subagents), прогоны loop.
6. `index.ts` — экспорт.
7. Наполнить `skills/orchestrator.md`.
8. Юнит-тесты (мок клиента); gated-тест цикла.
9. `npm test`, `tsc`, `lint`, `openspec validate`.

Откат: удалить `src/agents/*` (вернуть заглушку `index.ts`), откатить 2 опц. поля конфига — обратно-совместимо.

## Open Questions

- Нет отложенных unknowns: формат `tool_calls` и live-поведение RouterAI — deferred до восстановления сервиса (gated-тест, observation по итогам), но не меняют спеки/подход (loop оперирует типизированным `ChatResult` из `llm/routerai`).