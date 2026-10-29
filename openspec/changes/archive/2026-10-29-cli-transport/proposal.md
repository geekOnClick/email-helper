# Proposal

## Why

Фазы 0–4 построили ядро агента (почта IMAP/SMTP, LLM-оркестрация, векторный поиск, отправка писем) без способа взаимодействия с пользователем. Нужен терминальный транспорт: REPL-чат, собирающий агента из `.env` и принимающий запросы пользователя, с отображением прогресса tool-вызовов и форматированными отчётами. Это первый человекориентированный интерфейс агента и базовый MVP-доступ к нему (PLAN.md Фаза 5).

## What Changes

- **NEW** `transport/cli`: интерактивный REPL в терминале — ввод запроса → ответ агента; bootstrap-сборка агента из конфига (`loadConfigWithAccounts`, `RouterAiClient`, опц. `EmbeddingsClient`/`FalkorClient`, `composeAgents`); slash-команды (`/help`, `/quit`, `/clear`, `/reset`); форматированный вывод ответа и прогресса tool-вызовов; читаемые сообщения об ошибках; абстракция ввода/вывода для тестируемости.
- **MODIFIED** `agent/orchestrator`: опциональный хук прогресса — цикл tool-calling испускает события (вызов тулa, результат тулa, номер итерации, достижение лимита) при наличии наблюдателя; без наблюдателя поведение не меняется (backward-compatible). Даёт транспорту реалтайм-вывод прогресса вместо постфактум-сводки.
- Переключение точки входа `src/index.ts` со skeleton-проверки на запуск CLI.
- Новых runtime-зависимостей нет: `node:readline/promises` (built-in), минимальное ANSI-форматирование inline.

## Capabilities

### New Capabilities

- `transport/cli`: терминальный REPL-транспорт агента — bootstrap из конфига, REPL-цикл, slash-команды, форматирование вывода и прогресс tool-вызовов.

### Modified Capabilities

- `agent/orchestrator`: добавляется поведение испускания событий прогресса цикла tool-calling при подключённом наблюдателе (новое требование).

## Impact

- **Новые файлы:** `src/transport/cli/` (REPL, bootstrap, команды, форматтер, I/O-абстракция), тесты (`tests/cli-*.test.ts`).
- **Модификация:** `src/agents/loop.ts` (опц. `onEvent` в `ToolLoopOptions`), `src/agents/orchestrator.ts` (опц. `onEvent`/проброс в `run`), `src/index.ts` (запуск CLI).
- **Спеки:** new `specs/transport/cli/spec.md`, modified `specs/agent/orchestrator/spec.md`.
- **Зависимости:** без новых runtime-deps; dev-deps без изменений.
- **Совместимость:** backward-compatible — опц. хук; существующие вызовы `Orchestrator.run()` без наблюдателя работают идентично.
- **Безопасность:** CLI не выводит секреты (пароли, токены) — берёт их из конфига по логину, как и тулы; прогресс показывает имена тулов и краткие аргументы без секретов.
