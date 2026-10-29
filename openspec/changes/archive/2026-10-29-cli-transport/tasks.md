# Tasks

## 1. Зависимости и каркас

- [x] 1.1 Установить `tsx` как devDep (`npm i -D tsx`) для дев-рантайма ESM-TS без пересборки. Проверка: `npx tsx --version` печатает версию.
- [x] 1.2 Создать каталог `src/transport/cli/` (пустой каркас). Проверка: каталог существует.

## 2. События прогресса в цикле tool-calling (MODIFIED agent/orchestrator)

- [x] 2.1 В `src/llm/types.ts` добавить тип `ToolProgressEvent` (discriminated union: `toolCall`/`toolResult`/`truncated`) рядом с `ToolCall`. Проверка: `tsc --noEmit` чист, тип экспортирован.
- [x] 2.2 Расширить `ToolLoopOptions` в `src/agents/loop.ts` опциональным `onToolEvent?: (event: ToolProgressEvent) => void`; испускать события после записи toolCall в историю, после резолва (через `serializeToolResult` с лимитом 200 для summary), и при `truncated`. Без `onToolEvent` — ноль новых вызовов. Проверка: `tsc --noEmit` чист.
- [x] 2.3 Расширить `Orchestrator.run(userText, opts?: { onToolEvent? })` пробросом хука в `runToolLoop`. НЕ расширять `OrchestratorOptions`. Проверка: `tsc --noEmit` чист.
- [x] 2.4 Тест `tests/loop-progress.test.ts`: цикл с `onToolEvent` испускает `toolCall`+`toolResult` по каждому тулу и `truncated` при лимите; без `onToolEvent` результат идентичен. Проверка: `npx vitest run tests/loop-progress.test.ts` зелёный.

## 3. Абстракция ввода/вывода

- [x] 3.1 Создать `src/transport/cli/io.ts`: интерфейс `ConsoleIO` (`readline`, `write`, `writeErr`, `clear`) и `NodeConsoleIO` (обёртка `readline/promises` над stdin/stdout, ANSI-clear, TTY-детект для цвета). Проверка: `tsc --noEmit` чист.
- [x] 3.2 Создать `tests/mock-io.ts` (общий мок): `MockConsoleIO` с очередью строк ввода и буферами out/err. Проверка: `tsc --noEmit` чист, используется в тестах групп 4–6.

## 4. Форматтер вывода

- [x] 4.1 Создать `src/transport/cli/format.ts`: `formatAnswer(result)` (ответ + опц. предупреждение об усечении), `formatToolProgress(event)`, `formatError(message)`, `formatHelp()`. Минимальный ANSI, plain-text при не-TTY. Проверка: `tsc --noEmit` чист.
- [x] 4.2 Тест `tests/cli-format.test.ts`: `formatAnswer` с `truncated:true` добавляет предупреждение; `formatToolProgress` для трёх типов событий; `formatError` обособлен; `formatHelp` содержит все slash-команды. Проверка: `npx vitest run tests/cli-format.test.ts` зелёный.

## 5. REPL и slash-команды

- [x] 5.1 Создать `src/transport/cli/repl.ts`: класс `CliRepl` с `start()` — цикл readline, маршрутизация `/`-строк в `handleCommand`, иначе `orchestrator.run(text, { onToolEvent })`. Slash-команды: `/help`, `/quit`, `/clear`, `/reset` (через фабрику `createAgent`). Проверка: `tsc --noEmit` чист.
- [x] 5.2 Тест `tests/cli-repl.test.ts` с `MockConsoleIO` и stub-оркестратором: запрос → ответ; пустой ввод → игнор; `/help` → справка; `/quit` → выход; `/clear` → clear вызван; `/reset` → фабрика вызвана; `/unknown` → ошибка+подсказка. Проверка: `npx vitest run tests/cli-repl.test.ts` зелёный.
- [x] 5.3 Тест `tests/cli-repl-progress.test.ts`: во время `orchestrator.run` события `onToolEvent` выводятся через `formatToolProgress` до финального ответа; `truncated` → предупреждение. Проверка: `npx vitest run tests/cli-repl-progress.test.ts` зелёный.

## 6. Bootstrap и точка входа

- [x] 6.1 Создать `src/transport/cli/bootstrap.ts`: `bootstrap()` грузит конфиг (`loadConfigWithAccounts`), строит `RouterAiClient`/`EmbeddingsClient`/`FalkorClient`, вызывает `composeAgents`, возвращает `{ orchestrator, createAgent, cleanup }` (cleanup → `getSharedSessionStore().disposeAll()`). Ошибки → throw с читаемым сообщением. Проверка: `tsc --noEmit` чист.
- [x] 6.2 Тест `tests/cli-bootstrap.test.ts` с мок-клиентами/конфигом: валидный конфиг → агент собран; невалидный конфиг → throw с сообщением; `cleanup()` вызывает `disposeAll`. Проверка: `npx vitest run tests/cli-bootstrap.test.ts` зелёный.
- [x] 6.3 Переписать `src/index.ts`: `main()` → `bootstrap()` → `new CliRepl(...).start()`, catch → stderr + `process.exit(1)`. Проверка: `tsc --noEmit` чист.
- [x] 6.4 Добавить `start`-скрипт в `package.json` (`tsx src/index.ts`). Проверка: `npm start -- --help`-эквивалент не падает на импорте (ручной smoke).

## 7. Интеграционный тест REPL

- [x] 7.1 Тест `tests/integration/cli-repl-integration.test.ts`: полный цикл через `composeAgents` со stub-`RouterAiClient` (фикстуры ответов с tool_calls) — ввод запроса → прогресс → финальный ответ; `/reset` обнуляет историю (вторая реплика не помнит первую). Проверка: `npx vitest run tests/integration/cli-repl-integration.test.ts` зелёный.

## 8. Финальные проверки

- [x] 8.1 `npm test` — зелёный (все unit + cli + integration). Проверка: exit 0.
- [x] 8.2 `npx tsc --noEmit` — без ошибок. Проверка: exit 0.
- [x] 8.3 `npm run lint` — без ошибок. Проверка: exit 0.
- [x] 8.4 `openspec validate cli-transport --strict` — проходит. Проверка: exit 0.

## Workflow follow-up

- После реализации и проверок: `/opsx-archive cli-transport` (синхронизация delta → main specs, перемещение в archive).
- Обновить `HANDOFF-next-session.md` под Фазу 6 (MCP) или иную следующую задачу.
