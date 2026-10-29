# Tasks

## 1. Агрегация токенов LLM по итерациям прогона

- [x] 1.1 Создать хелпер агрегации usage в `src/llm/types.ts` (или `src/observability/usage.ts`): функция `addUsage(acc: Usage | undefined, next: Usage | undefined): Usage` — суммирует `promptTokens`/`completionTokens`/`totalTokens`, корректно обрабатывает `undefined` (итерация без usage → `acc` без изменений). Unit-тест `tests/usage-aggregation.test.ts`: сумма двух итераций, одна `undefined`, обе `undefined`.
- [x] 1.2 Изменить `runToolLoop` в `src/agents/loop.ts`: аккумулятор `totalUsage`, суммировать `result.usage` каждой итерации через `addUsage`; вернуть `totalUsage` в `ToolLoopResult.usage` (вместо `lastUsage`). Обновить существующие тесты loop/orchestrator, проверяющие `usage` (если проверяли «последняя итерация» → «агрегат»).

## 2. Логгер вызовов тулов

- [x] 2.1 Создать `src/observability/logger.ts`: интерфейс `ToolLogger { logToolCall(event: ToolLogEvent): void }`, тип `ToolLogEvent { toolName, status: 'ok'|'error', durationMs, summary }`. Реализация по умолчанию `ConsoleToolLogger` — пишет в `process.stderr` структурированной строкой. Фабрика `noopToolLogger` (no-op, для тестов/по умолчанию).
- [x] 2.2 Интегрировать `toolLogger?` в `ToolLoopOptions` (`src/agents/loop.ts`) и `RegistryToolResolver`: обернуть исполнение handler тулa в `Date.now()` таймер; после — `toolLogger.logToolCall({ toolName, status: ok|error, durationMs, summary: progressSummary(content) })`. Логгер опционален (no-op по умолчанию). Unit-тест `tests/tool-logger.test.ts`: мок-логгер фиксирует событие (имя, статус, длительность≥0, summary).
- [x] 2.3 Маскирование секретов в `summary` лога: при наличии известных секретов (пароли приложений, OAuth-токены) — `redact(summary, ...secrets)` из `src/tools/mail/redact.ts`. Секреты передаются через опцию логгера (например `ConsoleToolLogger({ secrets })`). Тест: summary с паролем → `[REDACTED]`.

## 3. Отчёт по сессии (CLI-транспорт)

- [x] 3.1 Создать `src/observability/session-stats.ts`: класс `SessionStats` с методами `recordRun(result: OrchestratorResult): void` (аккумулирует токены + вызовы тулов) и `getReport(): SessionReport { runs, toolCalls: {ok, error}, tokens: {prompt, completion, total} }`. Unit-тест `tests/session-stats.test.ts`: 2 прогона — суммирование токенов и вызовов; прогон без `usage` (отсутствует) — корректное отсутствие данных.
- [x] 3.2 Создать `formatSessionReport(report, isTTY): string` в `src/transport/cli/format.ts`: сводка прогонов, вызовов тулов (ok/error) и токенов. Unit-тест в `tests/cli-format.test.ts`: формат отчета содержит число прогонов, вызовы, токены.
- [x] 3.3 Интегрировать `SessionStats` в `CliRepl` (`src/transport/cli/repl.ts`): инстанс хранится в REPL; `recordRun(result)` после каждого `orchestrator.run`. Новая slash-команда `/stats` → вывод `formatSessionReport`. При выходе (`/quit`/EOF) — вывод итогового отчёта. Обновить тесты `cli-repl.test.ts`: `/stats` выводит сводку; выход выводит отчёт.

## 4. E2E-сценарии (CLI + MCP)

- [x] 4.1 E2E-сценарий CLI «поиск→анализ→скачивание→ответ» в `tests/integration/cli-e2e-search.test.ts`: стаб `RouterAiClient` со скриптованными `toolCalls` (итерация 1: `mail.search` → 2 письма; итерация 2: `mail.fetch` + `mail.downloadAttachments`; финал — текст-саммари). Стаб `MailProvider` с предзаготовленными письмами. Прогон через `CliRepl` + `MockConsoleIO`, проверка вывода прогресса и ответа.
- [x] 4.2 E2E-сценарий CLI «подключение→поиск→отправка» в `tests/integration/cli-e2e-send.test.ts`: стаб LLM (итерация 1: `mail.search`; итерация 2: `mail.send`); стаб SMTP (smtp-server npm или мок). Проверка последовательности вызовов и финального ответа.
- [x] 4.3 E2E-сценарий MCP «search→fetch→send» в `tests/integration/mcp-e2e-search.test.ts`: `composeAgents` со стаб LLM + стаб провайдером; `createMcpServer` + `InMemoryTransport` + `Client`; последовательность `callTool` (mail.connect → mail.search → mail.fetch → mail.send) с проверкой результатов.

## 5. Документация

- [x] 5.1 Создать `README.md` в корне: разделы — назначение, стек, установка (Node 20+, Docker FalkorDB), конфигурация (`.env` + аккаунты), запуск (CLI `npm start`, MCP `npm run mcp`/`npm run mcp:http`), тесты (`npm test`), структура репозитория, ссылки на `PLAN.md`/`agent.md`. Документация на русском.
- [x] 5.2 Актуализировать `agent.md`: убрать «Telegram (Фаза 7)» из таблицы стека и архитектуры; добавить MCP в таблицу стека и архитектуру; обновить список тулов (добавить `mail.listFolders`, `embeddings.index`, `vector.search`); убрать упоминание Telegram из «Транспорты».

## 6. Очистка и финальные проверки

- [x] 6.1 Удалить `src/transport/telegram/index.ts` и каталог `src/transport/telegram/`. Проверить `grep -r "transport/telegram\|telegram"` по `src/` — не должно быть импортов/ссылок. Проверка: `tsc` компилирует без ссылок на удалённое.
- [x] 6.2 `npm test` — зелёный (все unit + observability + E2E + integration). Проверка: exit 0.
- [x] 6.3 `npx tsc --noEmit` — без ошибок. Проверка: exit 0.
- [x] 6.4 `npm run lint` — без ошибок. Проверка: exit 0.
- [x] 6.5 `openspec validate observability --strict` — проходит. Проверка: exit 0.
