# Design

## Context

Ядро агента (оркестратор, тулы, транспорты CLI + MCP) завершено и протестировано (Фазы 0–6, 310 тестов). Данные для observability уже частично присутствуют в коде, но не выводятся:

- **Токены LLM:** `RouterAiClient` парсит `usage` (`prompt_tokens`/`completion_tokens`/`total_tokens`) из ответа RouterAI (`src/llm/schema.ts`), `runToolLoop` возвращает `ToolLoopResult.usage` — но это **usage последней итерации**, не агрегат. `OrchestratorResult.usage` пробрасывает его как есть. Нигде не суммируется, не выводится.
- **Вызовы тулов:** `runToolLoop` испускает `ToolProgressEvent` (toolCall/toolResult/truncated) через `onToolEvent` — но это UI-канал прогресса (вывод в REPL в реальном времени), не лог аудита (нет длительности, нет агрегации, формат привязан к терминалу).
- **Секреты:** `src/tools/mail/redact.ts` — функция `redact(text, ...secrets)` маскирует известные секреты. Но для логирования args тулов нужен безопасный serializer.

Транспорты: CLI REPL (`src/transport/cli/repl.ts`) имеет slash-команды `/help` `/quit` `/clear` `/reset`, возвращает `ReplExit { reason }` — нет хука отчёта при выходе. MCP-сервер (`src/mcp/`) — stateless по вызовам, сессия = один HTTP-запрос или stdio-соединение.

Документация: `README.md` отсутствует; `agent.md` упоминает отменённый Telegram (Фаза 7), не отражает MCP (Фаза 6). `src/transport/telegram/index.ts` — пустой stub.

## Goals / Non-Goals

**Goals:**
- Агрегация токенов LLM по всем итерациям прогона (не только последняя) — в `ToolLoopResult`/`OrchestratorResult`.
- Структурированный лог вызовов тулов (имя, статус, длительность, summary без секретов) — отдельный аудиторский канал, не путать с UI-прогрессом.
- Сводный отчёт по сессии CLI-транспорта (вызовы тулов + токены) — по команде `/stats` и при выходе.
- E2E-сценарии через CLI и MCP со стаб-провайдерами.
- `README.md` + актуализация `agent.md`; удаление telegram stub.

**Non-Goals:**
- Внешняя система логирования ( Loki/Grafana/file rotation) — лог в `stderr`/консоль, без runtime-зависимостей.
- Observability для MCP-транспорта как отдельной сессии — MCP stateless, отчёт по сессии имеет смысл только для stateful CLI-REPL. MCP логирует вызовы тулов в stderr, отчёта по сессии не имеет (каждый вызов `tools/call` автономен).
- Мониторинг расходов в реальном времени в Web (Фаза 9).
- Семантическая.redaction аргументов тулов по схеме — переиспользуем существующий `redact()` от известных секретов аккаунтов.

## Decisions

### D1: Агрегация токенов — изменение семантики `usage` поля, не новое поле

**Выбор:** `ToolLoopResult.usage` и `OrchestratorResult.usage` меняют семантику с «последняя итерация» на «агрегат всех итераций прогона». Тип `Usage` не меняется (`{ promptTokens?, completionTokens?, totalTokens? }`), но значения — суммы.

**Почему:** Поле уже есть и проходит через все слои. Добавление нового `totalUsage` дало бы два поля с неясной семантикой, а старое `usage` осталось бы «последним» — путаница. Изменение семантики — внутренний тип (тесты обновляются), внешний MCP/CLI-контракт не меняется (REPL не выводил usage ранее).

**Альтернатива:** Новое поле `aggregatedUsage` — отвергнута (двусмысленность). Хранение массива `usage[]` по итерациям — отвергнуто (избыточно, спека требует итог).

**Реализация:** Хелпер `addUsage(acc, next)` в `src/llm/types.ts` или `src/observability/usage.ts`; в `runToolLoop` аккумулятор `totalUsage` суммируется по итерациям; возвращается в `usage`.

### D2: Логгер тулов — отдельный интерфейс, не перегрузка `onToolEvent`

**Выбор:** Новый интерфейс `ToolLogger` в `src/observability/logger.ts`:
```ts
interface ToolLogger {
  logToolCall(event: ToolLogEvent): void;
}
interface ToolLogEvent {
  toolName: string;
  status: 'ok' | 'error';
  durationMs: number;
  summary: string; // краткое описание результата/ошибки, без секретов
}
```
Инжектируется через `ToolLoopOptions.toolLogger?` (опц.). `RegistryToolResolver` оборачивает исполнение тулa в `Date.now()` таймер, после — вызывает `toolLogger.logToolCall` с длительностью и summary (переиспользует `progressSummary()`).

**Почему:** `onToolEvent` — UI-канал (форматированный вывод в терминал, real-time, привязан к итерации). Логгер — аудиторский канал (длительность, агрегация, формат не зависит от транспорта). Разделение каналов = чистая ответственность.

**Альтернатива:** Расширить `ToolProgressEvent` полем `durationMs` и использовать `onToolEvent` для логирования — отвергнута (смешивает UI и аудит, MPL-репл уже потребляет события).

### D3: Маскирование секретов в логах — переиспользование `redact()` + JSON-serializer

**Выбор:** `summary` для лога строится из `progressSummary(content)` (уже ограничено 200 символов). Дополнительно — `redact(summary, ...knownSecrets)` от секретов аккаунтов (пароли приложений, токены OAuth), которые bootstrap может передать в логгер. Args тулов в лог не пишутся (args могут содержать логины/email — не секреты, но тело результата `mail.fetch` может содержать приватное содержимое письма — ограничено summary).

**Почему:** `redact()` уже существует и протестирован. Args не логируются — минимизация площади утечки. Summary результата уже усечено. Секреты аккаунтов (пароли) в args тулов не передаются (в `session-store`), но могут появиться в сообщениях об ошибках — `redact` покрывает.

**Альтернатива:** Структурная redaction по JSON-схеме тулa (поле `password` → `[REDACTED]`) — отвергнута (over-engineering для текущих тулов, где пароли не в args).

### D4: Сводный отчёт по сессии — `SessionStats` аккумулятор в REPL

**Выбор:** Новый класс `SessionStats` в `src/observability/session-stats.ts`:
```ts
class SessionStats {
  recordRun(result: OrchestratorResult): void; // += токены, += вызовы
  getReport(): SessionReport; // { runs, toolCalls: {ok, error}, tokens: {prompt, completion, total} }
}
```
CLI REPL держит инстанс `SessionStats`, после каждого `orchestrator.run` вызывает `recordRun(result)`. Новая slash-команда `/stats` выводит `formatSessionReport(stats.getReport())`. При выходе (`/quit`/EOF) REPL выводит итоговый отчёт перед «До свидания».

**Почему:** REPL — единственный stateful транспорт (MCP stateless). Аккумулятор живёт в REPL, не в оркестраторе (оркестратор хранит историю диалога, но не агрегаты статистики — это транспортная ответственность).

**Альтернатива:** Хранить `SessionStats` в самом `Orchestrator` — отвергнута (оркестратор — доменный слой, статистика сессии — транспортная).

### D5: E2E-тесты — стаб LLM + стаб mail-провайдер, без реальных сетевых вызовов

**Выбор:** E2E-тесты в `tests/integration/`:
- **Сценарий 1 (CLI):** поиск→анализ→скачивание→ответ. Стаб `RouterAiClient` со скриптованными `toolCalls` (1-я реплика: `mail.search`; 2-я итерация: `mail.fetch`; финал — текст). Стаб `MailProvider` возвращает предзаготовленные письма. Прогон через `CliRepl` + `MockConsoleIO`, проверка вывода.
- **Сценарий 2 (CLI):** подключение→поиск→отправка. Аналогично, с `mail.connect`→`mail.search`→`mail.send` + подтверждение.
- **Сценарий 3 (MCP):** полный цикл через `InMemoryTransport` — уже покрыт `mcp-bootstrap.test.ts` (Фаза 6). Дополнить сценарием `search→fetch→send` через `Client.callTool`.

**Почему:** Реальные LLM/IMAP/SMTP — недетерминированы, требуют секретов. Стабы дают детерминированные E2E. Переиспользование `MockConsoleIO` (Фаза 5) и `InMemoryTransport` (Фаза 6).

**Альтернатива:** E2E против реального ящика (`agent-accounts.txt`) — отвергнута (секреты, нестабильность, не для CI).

### D6: Документация — `README.md` с нуля, `agent.md` точечная правка

**Выбор:**
- `README.md`: установка (Node 20+, Docker для FalkorDB), конфигурация (`.env`, аккаунты), запуск (`npm start` CLI, `npm run mcp`/`mcp:http`), тесты (`npm test`), структура репозитория, ссылка на `PLAN.md`/`agent.md`.
- `agent.md`: убрать строку «Telegram (Фаза 7)» из таблицы стека и архитектуры; добавить MCP; обновить список тулов (добавить `mail.listFolders`, `embeddings.index`, `vector.search`); убрать упоминание Telegram из «Транспорты».

**Почему:** README — точка входа, сейчас отсутствует. agent.md — точечная правка (структура верна, устарели 2 места).

### D7: Удаление telegram stub

**Выбор:** Удалить `src/transport/telegram/index.ts` и каталог `src/transport/telegram/`. Проверить, что нет импортов (grep).

**Почему:** Фаза 7 отменена, stub — мёртвый код. Удаление исключает путаницу.

## Risks / Trade-offs

- **D1 — изменение семантики `usage`:** Существующие тесты оркестратора/loop, проверяющие `usage`, обновятся. Риск: пропущенный тест упадёт — приемлемо (tsc + test поймают). Контракт `OrchestratorResult` внутренний, внешних потребителей нет.
- **D2 — новый канал `toolLogger`:** Добавляет параметр в `ToolLoopOptions`. Риск: забытая интеграция в один из путей (subagent?). Mitigation: `toolLogger?` опционален, по умолчанию no-op; интегрируется только в `RegistryToolResolver` (единая точка исполнения тулов).
- **D3 — args не логируются:** Теряется видимость «с какими аргументами звали тул». Mitigation: имя тулa + summary результата достаточно для аудита; args можно добавить позже по необходимости (non-goal).
- **D5 — E2E на стабах:** Не проверяет реальные интеграции (IMAP/SMTP/RouterAI). Mitigation: они покрыты unit-тестами провайдеров и контрактом RouterAI; E2E проверяет склейку оркестратор↔тулы↔транспорт.
- **D4 — SessionStats только в CLI:** MCP не имеет отчёта по сессии. Принято (MCP stateless). При необходимости MCP может логировать per-call в stderr (через тот же `toolLogger`).
