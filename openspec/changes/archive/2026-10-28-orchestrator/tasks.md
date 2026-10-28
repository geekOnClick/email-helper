# Tasks

## 1. Конфигурация границ цикла

- [x] 1.1 Добавить опц. поля в `ConfigSchema` (`src/config/schema.ts`): `AGENT_MAX_ITERATIONS` (`z.coerce.number().int().positive().default(10)`), `AGENT_MAX_TOOL_RESULT_CHARS` (`z.coerce.number().int().positive().default(20000)`). Проверка: `npx tsc --noEmit`; `loadConfig({})` возвращает `10` и `20000`.

## 2. Загрузчик системного промпта

- [x] 2.1 Реализовать `src/agents/skill-loader.ts`: `loadSkill(roleName: string): string` — читает `skills/${roleName}.md` через `node:fs/promises` (путь от cwd проекта); при отсутствии файла бросает ошибку с указанием ожидаемого пути. Проверка: `npx tsc --noEmit`; unit-тест — `loadSkill('orchestrator')` возвращает содержимое `skills/orchestrator.md`; для несуществующего `loadSkill('nope')` бросает с путём в сообщении.

## 3. Движок цикла tool-calling

- [x] 3.1 Реализовать `src/agents/loop.ts`: типы `ToolResolver`, `ToolLoopOptions`, `ToolLoopResult` (`{ content, toolCalls, iterations, truncated, usage? }`), функцию `serializeToolResult(value, maxChars)` (JSON.stringify → усечение с маркером `...[результат усечён: N символов из TOTAL]`; не-сериализуемое → `String(value)`). Проверка: `npx tsc --noEmit`; unit-тест `serializeToolResult` — короткий результат без изменений, длинный усечён с маркером, `null`→`"null"`, `undefined`→`"undefined"`.
- [x] 3.2 Реализовать `RegistryToolResolver` в `loop.ts`: `resolve(toolCall: ToolCall)` → для неизвестного тулa `ToolResultMessage{content:"Тул не найден: <name>"}`; для невалидных args (`parseError` или `args===null`) `ToolResultMessage{content:"Невалидные аргументы тулa <name>: <parseError>"}`; иначе вызов handler в try/catch → результат через `serializeToolResult`, при исключении `ToolResultMessage{content:"Ошибка тулa <traceName>: <message>"}`. Проверка: unit-тест (стаб-реестр) — успех, исключение, неизвестный тул, невалидные args.
- [x] 3.3 Реализовать `runToolLoop(opts)` в `loop.ts`: цикл — `client.chat({ messages: opts.messages, tools: opts.tools, role: 'orchestrator', toolChoice? })` → если `toolCalls` пусты, финал (`truncated:false`); иначе для каждого `toolCall` вызвать `opts.resolver.resolve`, дописать `AssistantMessage(toolCalls)` затем все `ToolResultMessage` в `messages`, `iteration++`; при `iteration>=maxIterations` — стоп с `truncated:true` и последним `content`. Аккумулировать `toolCalls` и `usage` (из последней итерации). Проверка: `npx tsc --noEmit`.
- [x] 3.4 Unit-тест `runToolLoop` с мок `RouterAiClient` (injectable `fetch`/обёртка): финал-текст без вызовов → 1 итерация, `truncated:false`; один tool_call → результат → финал (2 итерации); несколько tool_calls в одном ответе → все исполнены; исчерпание итераций → `truncated:true`. Проверка: тесты зелёные.

## 4. Контракт субагентов

- [x] 4.1 Реализовать `src/agents/subagent.ts`: интерфейс `Subagent` (`{ name, description, run(input: string): Promise<string> }`), класс `SubagentRegistry` (`register`, `get`, `list`), функцию `createDelegateTool(registry): ToolDef` — тул `delegate` с `inputSchema { subagent: string, instruction: string }`, handler: неизвестный субагент → строка-ошибка (без throw); успех → ответ субагента (с усечением нет — усечение делает resolver при возврате). Проверка: `npx tsc --noEmit`; unit-тест — делегирование стаб-субагенту возвращает его ответ; неизвестный → ошибка-строка; пустой реестр → `createDelegateTool` не вызывается оркестратором (покрыть в 5.2).

## 5. Оркестратор

- [x] 5.1 Реализовать `src/agents/orchestrator.ts`: типы `OrchestratorOptions` (`{ client, config, tools?, subagents?, maxIterations?, maxToolResultChars?, skill? }`), класс `Orchestrator` — в конструкторе грузит скил `orchestrator` (если не передан `skill`), строит набор тулов (`mapToolsToOpenAi(listTools())` + `delegate` через `createDelegateTool` при непустом `subagents`), хранит `messages: ChatMessage[]` со стартовым `SystemMessage`. Метод `run(userText): Promise<OrchestratorResult>` — добавляет `UserMessage`, прогоняет `runToolLoop`, дополняет историю финальным `AssistantMessage`, возвращает `{ content, toolCalls, iterations, truncated, usage? }`. Проверка: `npx tsc --noEmit`.
- [x] 5.2 Unit-тест `Orchestrator`: мок клиента с двумя репликами — вторая реплика помнит первую (в `messages` второго запроса есть `UserMessage`+`AssistantMessage` первой); системный промпт первым сообщением; набор тулов пустого реестра не содержит `delegate`, со стаб-субагентом — содержит. Проверка: тесты зелёные.
- [x] 5.3 Unit-тест делегирования в цикле оркестратора: оркестратор со стаб-субагентом, мок клиента возвращает `tool_call: delegate{analyzer, "..."}` → финал — стаб-субагент вызван, его ответ попал в `role:"tool"`, финальный `content` возвращён. Проверка: тест зелёный.

## 6. Системный промпт и экспорт

- [x] 6.1 Наполнить `skills/orchestrator.md` вместо каркаса-заглушки: роль оркестратора, доступные тулы (список из реестра + `delegate`), зоны ответственности (разбор интента, план, делегирование, сбор ответа), формат ответа (план 1–3 пункта → прогресс → итог), ограничения (не отправлять письма без подтверждения, не угадывать учётные данные, переспрашивать при непонятной задаче). Проверка: файл содержит секции Роль/Доступные тулы/Зоны ответственности/Формат ответа/Ограничения.
- [x] 6.2 Заменить заглушку `src/agents/index.ts` экспортом: `runToolLoop`, `Orchestrator`, `Subagent`, `SubagentRegistry`, `createDelegateTool`, `loadSkill`, типы. Проверка: `npx tsc --noEmit`; `import { Orchestrator } from '../agents/index.js'` резолвится.

## 7. Финальная проверка

- [x] 7.1 Gated-тест цикла оркестратора `tests/integration/orchestrator-loop.test.ts`: при `INTEGRATION_LLM=1` — один простой запрос к живому RouterAI через `Orchestrator` (без тулов), проверка `content` непустой, `truncated:false`; при исчерпании попыток/500 — пропуск с фиксированной observation (как в llm-client). Без флага skipped. Проверка: без флага skip; с флагом — зелёный либо observation.
- [x] 7.2 `npm test` — зелёный. Проверка: exit 0.
- [x] 7.3 `npx tsc --noEmit` — без ошибок. Проверка: exit 0.
- [x] 7.4 `npm run lint` — без ошибок. Проверка: exit 0.
- [x] 7.5 `openspec validate orchestrator --strict` — проходит. Проверка: exit 0.

## Workflow follow-up

- После проверки — запустить `/opsx-archive` для зашивания change и создания основного спека `agent/orchestrator`.
- При восстановлении живого RouterAI — повторить gated-тест (7.1) с реальным `tool` и зафиксировать wire-формат делегирования/цикла в observation.
- Следующие change'ы Фазы 2: `analyzer-agent` (capability `agent/analyzer`, наполнение `skills/analyzer.md`), `helper-agent` (capability `agent/helper`, наполнение `skills/helper.md`) — подключают субагентов в `SubagentRegistry` оркестратора.