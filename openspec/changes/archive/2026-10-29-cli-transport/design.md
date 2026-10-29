# Design

## Context

Фазы 0–4 построили ядро: `composeAgents()` (`src/agents/compose.ts`) собирает `Orchestrator` из конфига (аккаунты, `RouterAiClient`, опц. `EmbeddingsClient`/`FalkorClient`); `Orchestrator.run(userText)` крутит `runToolLoop` и возвращает `OrchestratorResult` (`content`, `toolCalls`, `iterations`, `truncated`). Точка входа `src/index.ts` — stub skeleton-проверки. `runToolLoop` блокирующий, без событий в реальном времени — прогресс tool-вызовов доступен только постфактум в `result.toolCalls`.

Ограничения:
- Транспорт должен показывать прогресс во время исполнения (PLAN.md Фаза 5: «вывод прогресса tool-вызовов»), а не только финальный ответ.
- REPL и форматирование должны быть тестируемыми (mockable ввод/вывод), без захвата `process.stdin`/`stdout` напрямую.
- CLI — это транспорт, не новая доменная логика: он переиспользует `composeAgents`, реестр тулов и оркестратор как есть.
- Без новых runtime-зависимостей: `node:readline/promises` (built-in с Node 18+), минимальное ANSI inline.

## Goals / Non-Goals

**Goals:**
- Интерактивный REPL в терминале с slash-командами.
- Реалтайм-вывод прогресса tool-вызовов (имя тулa, краткий результат) во время исполнения.
- Тестируемость: ввод/вывод за абстракцией, bootstrap-сборка изолирована, события прогресса типизированы.
- Backward-compatible расширение оркестратора опциональным хуком прогресса.
- Корректное завершение (EOF, `/quit`, SIGINT) с освобождением ресурсов.

**Non-Goals:**
- История ввода, автодополнение, цветовые темы, curses/TUI-фреймворк (минимальный ANSI).
- WebSocket/Web-интерфейс (это Фазы 6/7: MCP/Telegram).
- Многосессионность, переключение аккаунтов в runtime (аккаунты из конфига на старте).
- Персистентность истории диалога между запусками (`/reset` = чистая сессия в памяти).

## Decisions

### D1: Абстракция ввода/вывода `ConsoleIO`

Определяю интерфейс `ConsoleIO { readline(): Promise<string>; write(text: string): void; writeErr(text: string): void; clear(): void }` — единственная поверхность, через которую REPL взаимодействует с потоком. Продакшен-реализация `NodeConsoleIO` обёртывает `readline/promises` над `process.stdin`/`stdout` и `console.error`. В тестах — `MockConsoleIO` с очередью строк и буфером вывода.

**Альтернатива:** прямое использование `process.stdin`/`stdout` в REPL. Отклонено — нетестируемо без захвата глобальных потоков и таймеров.

**Почему:** REPL и форматтер становятся чистыми функциями от `ConsoleIO`, тестируемыми синхронно (мок ввода → утверждения на write).

### D2: Опциональный хук прогресса в цикле tool-calling

Расширяю `ToolLoopOptions` опциональным `onToolEvent?(event: ToolProgressEvent): void`. `ToolProgressEvent` — discriminated union: `{ type: 'toolCall'; iteration; toolCall: ToolCall }`, `{ type: 'toolResult'; iteration; toolCallId; toolName; ok: boolean; summary: string }`, `{ type: 'truncated'; iterations }`. `runToolLoop` вызывает `onToolEvent` после записи вызова в историю (toolCall) и после резолва (toolResult), и при `truncated`. При отсутствии `onToolEvent` — ни одной новой аллокации/вызова, поведение идентично текущему.

`Orchestrator.run(userText, opts?: { onToolEvent? })` пробрасывает хук в `runToolLoop`. `OrchestratorOptions` НЕ расширяется (хук — per-run, не per-orchestrator) — это сохраняет семантику «набор тулов фиксируется в конструкторе, история между run».

**Альтернатива A:** `EventEmitter` на оркестраторе. Отклонено — лишний объект, lifecycle-сложности, subscribe/unsubscribe в REPL. Per-run callback проще и типизированнее.

**Альтернатива B:** не трогать оркестратор, парсить `result.toolCalls` постфактум. Отклонено — PLAN.md явно требует реалтайм-прогресс; постфактум-вывод бесполезен для долгих запросов (поиск+анализ+скачивание).

**Backward-compat:** `Orchestrator.run(text)` без второго аргумента работает идентично; существующие тесты оркестратора не меняются.

### D3: Событие прогресса — краткий summary результата

`toolResult.summary` строится в `runToolLoop` через существующий `serializeToolResult(result, maxChars)` с уменьшенным лимитом (напр. 200 символов) — переиспользуем готовый сериализатор. Секреты не попадают: тулы уже не возвращают пароли/токены (фазы 1/4); progress-событие содержит summary строки-результата, а не сырой объект. Имя тулa и `parseError`/краткие аргументы — без секретов (args тулов не содержат секретов по контрактам фаз 1/4).

### D4: REPL-цикл и slash-команды

`CliRepl` — класс с методом `start()` (асинхронный цикл). На каждой итерации: `io.readline()` → если EOF/`/quit` → `break` (с cleanup); если строка начинается с `/` → маршрутизация в `handleCommand`; иначе — `orchestrator.run(text, { onToolEvent: formatter.progress })`, затем `io.write(formatter.answer(result))`. Slash-команды: `/help`, `/quit`, `/clear`, `/reset`. `/reset` пересоздаёт `Orchestrator` (через колбэк-фабрику `createAgent`) для обнуления истории; тулы реестра остаются (не `resetTools`).

**Команды как символы, не состояние:** `/clear` — `io.clear()` (ANSI `\x1B[2J\x1B[H`); `/reset` — переинициализация агента + сообщение. Неизвестная `/x` — ошибка + подсказка `/help`.

### D5: Bootstrap-сборка агента

`src/transport/cli/bootstrap.ts` — `async function bootstrap(): Promise<{ orchestrator: Orchestrator; createAgent: () => Promise<Orchestrator> }>`. Грузит конфиг (`loadConfigWithAccounts`), строит `RouterAiClient`, опц. `EmbeddingsClient`/`FalkorClient` (по наличию `FALKORDB_HOST`), вызывает `composeAgents`. Возвращает и готовый оркестратор, и фабрику (для `/reset`). Ошибки конфига/сборки → throw с читаемым сообщением; `main()` ловит, печатает в stderr, `process.exit(1)`.

**Зависимости клиентов:** `RouterAiClient` — из config (ключ, base URL, таймауты, ретраи). `EmbeddingsClient` — из config (модель, base URL, ключ). `FalkorClient` — из config (host, port, password). Все уже существуют (Фазы 2/3).

### D6: Форматтер вывода

`src/transport/cli/format.ts` — чистые функции: `formatAnswer(result: OrchestratorResult): string` (ответ + опц. предупреждение об усечении), `formatToolProgress(event: ToolProgressEvent): string` (краткая строка с ANSI-цветом: `→ mail.search` / `✓ mail.search: 3 письма` / `✗ mail.search: ошибка`), `formatError(message: string): string` (ANSI-красный блок), `formatHelp(): string`. Минимальный ANSI без библиотек: `\x1B[36m` (cyan для прогресса), `\x1B[31m` (красный для ошибок), `\x1B[0m`.

### D7: SIGINT во время исполнения

`CliRepl` оборачивает `orchestrator.run` в `AbortController`: обработчик `SIGINT` вызывает `controller.abort()`. `runToolLoop` не принимает `AbortSignal` в текущем контракте — добавлять его в оркестратор — отдельная модификация, выходит за scope этой фазы. **Решение:** SIGINT только прерывает ожидание `readline` в idle (завершение сессии); во время исполнения `orchestrator.run` игнорируем SIGINT (или ловим как «interrupted, continuing»-сообщение). Минимально-полезно и не ломает контракт оркестратора. Фиксирую как trade-off в рисках.

### D8: Переключение точки входа

`src/index.ts` заменяет stub на: `main()` → `bootstrap()` → `new CliRepl(io, orchestrator, createAgent).start()` → `catch` ошибок → `process.exit(1)`. Скрипт `npm start` (новый в package.json) — `node --import tsx/esm src/index.ts` ИЛИ `npm run build && node dist/index.js`. Поскольку tsx не в devDeps, добавлю `tsx` как devDep для дев-рантайма; прод — через `tsc` + `node dist`.

**Альтернатива:** не добавлять `tsx`, только `node dist`. Отклонено — неудобно для разработки/демо (пересборка на каждый чих). `tsx` уже де-факто стандарт для TS-ESM дев-рантайма.

### D9: Регистрация и cleanup

`CliRepl` при выходе вызывает опциональный `cleanup()` (если предоставлен bootstrap) — закрытие shared `MailSessionStore` (отключение IMAP-сессий). `MailSessionStore` уже имеет `disconnect(login)`; добавлю `closeAll()` если его нет. SIGTERM/SIGINT (вне исполнения) → `cleanup()` + `process.exit(0)`.

## Risks / Trade-offs

- **[SIGINT не прерывает исполнение]** → Mitigation: документируем в `/help`; долгие запросы прерываются только по завершении. Будущая фаза может добавить `AbortSignal` в `runToolLoop`. Не блокирует MVP.
- **[ANSI-коды в не-TTY окружениях]** → Mitigation: проверка `process.stdout.isTTY` в `NodeConsoleIO`; если не TTY — убираем цветовые коды (plain text). Тесты используют `MockConsoleIO` без ANSI.
- **[Расширение оркестратора — риск регрессии]** → Mitigation: backward-compat по контракту (опц. аргумент); существующие тесты оркестратора (`orchestrator.test.ts`) остаются без изменений и подтверждают отсутствие регрессии; новые тесты проверяют событийность.
- **[Сборка агента падает на старте без аккаунтов]** → Mitigation: `ACCOUNTS` по умолчанию `'[]'` — агент соберётся без mail-тулов (только если есть векторные); REPL сообщит «нет подключённых аккаунтов» при первом запросе, но не упадёт. Это корректное поведение для конфигурации без почты.
- **[tsx как новая devDep]** → Mitigation: только dev, не влияет на прод-сборку; убирается одной строкой если не нужен.
- **[Параллелизм: REPL однопоточный]** → Trade-off: один запрос за раз (без очереди). Достаточно для CLI-MVP; многопользовательская并发 — это MCP/Telegram (Фазы 6/7).
