# Design

## Context

Ядро агента готово: оркестратор + реестр тулов (`src/tools/registry.ts`, `ToolDef` с `name`, `description`, `inputSchema` (JSON Schema), `handler`). Сборка агента инкапсулирована в `bootstrap()` (`src/transport/cli/bootstrap.ts`): грузит конфиг + аккаунты, строит клиенты, вызывает `composeAgents` (регистрирует mail/vector-тулы в реестр), возвращает `{ orchestrator, cleanup }`. Тулы уже не возвращают секреты по контрактам фаз 1/4 (редакт в `mail/redact.ts`). Текущая точка входа `src/index.ts` запускает CLI-REPL.

MCP-сервер — новый транспорт поверх того же реестра. Мотивация — см. `proposal.md` (Why).

## Goals / Non-Goals

**Goals:**
- Экспонировать тулы реестра по MCP без дублирования доменной логики.
- Поддержка двух транспортов: stdio (локальные клиенты) и Streamable HTTP (удалённые/веб).
- Переиспользование `bootstrap()` для сборки агента → единый путь инициализации с CLI.
- Корректное освобождение ресурсов (mail-сессии, FalkorDB) при выходе.
- Контрактные тесты через MCP-клиент в тестах.

**Non-Goals:**
- MCP-ресурсы и prompts — только tools (тулы — ядро агента).
- Sampling (`createMessage`) — MCP-сервер не вызывает LLM; он только исполняет тулы.
- Аутентификация MCP-клиентов (Bearer/OAuth) — отложено; stdio локален, HTTP на localhost.
- Сессии/dialog state в MCP-сервере — stateless per request (HTTP) / single-session (stdio); история диалога не ведётся (в отличие от CLI-REPL). Это слой тулов, не чат.

## Decisions

### D1: SDK `@modelcontextprotocol/sdk` v1.32.2 (stable v1-line)

**Выбор:** `@modelcontextprotocol/sdk@^1.32.2` — единый пакет с `McpServer`, `StdioServerTransport`, `StreamableHTTPServerTransport`.

**Альтернативы:** v2 (`@modelcontextprotocol/server` + `@modelcontextprotocol/node`, split-пакеты) — новее, но split-установка сложнее и v2 ещё стабилизируется. v1.32.2 — стабильный, один пакет, широко используется (включая pi's own MCP clients).

**Почему:** минимум зависимостей, единый импорт, проверенная стабильность. v1-API (`server.tool(name, {description, inputSchema: zod}, handler)` + `server.registerTool` с raw schema) покрывает наши нужды.

### D2: Raw JSON Schema напрямую через низкоуровневый `Server` (не McpServer)

**Выбор:** Используем низкоуровневый `Server` из `@modelcontextprotocol/sdk/server` с `setRequestHandler(ListToolsRequestSchema)` / `CallToolRequestSchema`. Доменные `ToolDef.inputSchema` (уже raw JSON Schema) передаются в `tools/list` напрямую как `inputSchema` без конвертации. Валидация аргументов в `tools/call` — ручная (handler сам валидирует, как уже делает).

**Почему:** `McpServer.registerTool` в v1.32.2 принимает только Zod-схемы (`AnySchema = z3.ZodTypeAny | z4.$ZodType`); `fromJsonSchema` — это v2-фича (недоступна в v1.32.2). Переписывать 7 доменных тулов в Zod = дублирование и риск рассинхрона с существующими спеками. Низкоуровневый `Server` принимает raw JSON Schema для wire-протокола напрямую — идеально для нашего случая.

**Альтернатива (отвергнута):** v2 split-пакеты (`@modelcontextprotocol/server`+`/node`) с `fromJsonSchema` — новее, но менее стабилен и сложнее в установке. Остаёмся на v1.32.2.

### D3: Адаптер `ToolDef` → MCP handlers

**Выбор:** функция `registerDomainTools(server, tools)` устанавливает два request-handler'а на низкоуровневом `Server`:
- `ListToolsRequestSchema`: возвращает `{ tools: tools.map(t => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })) }`, исключая тул `delegate`.
- `CallToolRequestSchema`: по `params.name` находит `ToolDef`, вызывает `handler(params.arguments)`, результат → `toMcpResult`, ошибку → `toMcpError`.

**Фильтр `delegate`:** тул `delegate` (имя `delegate`) исключается из `tools/list` — внутренний контракт оркестратора, не доменный тул для внешних клиентов.

**Почему:** тонкий адаптер без дублирования; reusability — та же функция работает для stdio и HTTP.

### D4: Сериализация результата → MCP `content`

**Выбор:** `toMcpResult(result: unknown)`: если `result` — строка, возвращает `[{ type: 'text', text: result }]`; иначе `JSON.stringify` с pretty-print (2 пробела) в text-блок. Ошибки: `toMcpError(err)` → `{ content: [{ type: 'text', text: msg }], isError: true }` где `msg = err instanceof Error ? err.message : String(err)`.

**Почему:** MCP `content` — массив typed-блоков; text-блок универсален. `isError: true` — стандартный MCP-контракт для ошибок тулa (клиент видит ошибку, сессия живёт). Секреты уже редятся в доменных тулaх (`mail/redact.ts`), на уровне адаптера дополнительно не фильтруем (контракт фаз 1/4).

### D5: `createMcpServer(tools)` — factory над низкоуровневым `Server`

**Выбор:** функция `createMcpServer(serverInfo, tools: ToolDef[]): Server` создаёт `new Server(serverInfo)`, вызывает `registerDomainTools(server, tools)`, возвращает сервер. Не подключает транспорт — транспорт выбирает caller (stdio/HTTP).

**Почему:** тестируемость — в тестах можно создать сервер и подключить `InMemoryTransport` (из SDK) для контрактных тестов без реальных stdio/HTTP. Разделение server/transport соответствует SDK-паттерну.

### D6: Два режима запуска через `--transport` flag

**Выбор:** `src/mcp/index.ts` — entry point:
- `tsx src/mcp/index.ts` (без флага) → **stdio** (по умолчанию, для pi/Claude Desktop).
- `tsx src/mcp/index.ts --http [--port 3000] [--host 127.0.0.1]` → **Streamable HTTP**.
- npm-скрипты: `"mcp": "tsx src/mcp/index.ts"` (stdio), `"mcp:http": "tsx src/mcp/index.ts --http"`.

**Почему:** stdio — дефолт для локальных клиентов (pi config подключает MCP-сервера через stdio-команду). HTTP — опц. для удалённых/веб. Единый entry point с ветвлением по флагу проще двух файлов.

**Уточнение HTTP (stateless per-request):** `StreamableHTTPServerTransport` в stateless-режиме (`sessionIdGenerator: undefined`) обслуживает ровно один запрос — переиспользование бросает ошибку. Поэтому `runHttp` принимает factory `createServer()` и на каждый HTTP-запрос создаёт свежую пару `Server`+`transport`. Тулы переиспользуются (реестр статичен). `enableJsonResponse: true` — JSON-ответ вместо SSE-stream для stateless-совместимости с клиентами.

### D7: Переиспользование `bootstrap()` для сборки агента

**Выбор:** MCP entry point вызывает `bootstrap()` из `src/transport/cli/bootstrap.ts` (тот же, что CLI). Получает `{ orchestrator, cleanup }`. `orchestrator` не используется напрямую (MCP-сервер работает с реестром тулов, не с чат-циклом) — но `bootstrap()` нужен как side-effect: `composeAgents` регистрирует тулы в реестре. `cleanup` используется при выходе.

**Почему:** единый путь инициализации — конфиг/аккаунты/клиенты/регистрация тулов — между CLI и MCP. Если `bootstrap()` меняется, оба транспорта синхронны. `orchestrator` можно не передавать в MCP-сервер вообще (реестр global), но `bootstrap()` возвращает его — просто не используем.

**Альтернатива:** вынести регистрацию тулов в отдельную функцию без оркестратора — но это дублирование логики сборки. `bootstrap()` уже делает нужное.

### D8: Освобождение ресурсов — единый `cleanup` из bootstrap

**Выбор:** при выходе (EOF/stdin, SIGINT/SIGTERM, HTTP-сервер close) вызывается `cleanup()` из `BootstrapResult` (`disposeAll()` mail-сессий + `falkorClient.close()`). Логика идентична CLI-выходу.

### D9: Тесты через `InMemoryTransport` + `Client`

**Выбор:** контрактные тесты создают `createMcpServer(...)` с stub-тулами (или реальным реестром), подключают через пару `InMemoryTransport.create()` (SDK), подключают `Client` с другой стороны, вызывают `client.listTools()` и `client.callTool(...)`. Проверяют: список тулов, результат успешного вызова, `isError` на ошибке handler'а, исключение `delegate` из списка.

**Почему:** `InMemoryTransport` — стандартный SDK-способ тестирования server/client без реальных stdio/HTTP. Быстро, детерминированно, без портов.

## Risks / Trade-offs

- **[Имена тулов с точками в MCP]** MCP-спека разрешает точки в именах тулов, но некоторые клиенты могут ожидать `[a-zA-Z0-9_-]+`. → Mitigation: имена оставляем как есть (`mail.connect`); если конкретный клиент сломается — добавим алиасы (как `toOpenAiToolName` для OpenAI) в будущем change. Сейчас это non-goal.
- **[Stateless MCP-сервер vs stateful агент]** MCP-сервер не ведёт историю диалога (в отличие от CLI-REPL с `Orchestrator.messages`). Каждый `tools/call` — независимый. → Это корректно: MCP-клиент (внешний LLM) сам ведёт свой диалог и вызывает тулы по мере нужды. Агент как чат-партнёр — отдельный транспорт (CLI/Web), не MCP.
- **[HTTP-транспорт без аутентификации]** HTTP-режим без auth + localhost-only. → Mitigation: дефолт `127.0.0.1`; если нужен удалённый доступ — добавим Bearer-auth в будущем change (non-goal здесь).
- **[Регистрация тулов — side-effect `composeAgents`]** `bootstrap()` вызывает `composeAgents` который регистрирует тулы в global-реестре (`registerTool` throws на дубликат). Если MCP-сервер запустить дважды в одном процессе — упадёт. → Mitigation: один процесс — один запуск; в тестах `resetTools()` в beforeEach.
- **[Секреты в ошибках handler'а]** Если доменный тул в исключении содержит секрет (например, URL с embedded паролем) — адаптер передаст его в `isError` text. → Mitigation: контракт фаз 1/4 — тулы редят секреты в сообщениях; `ConnectError` и др. уже не содержат паролей. Доп. фильтрация на уровне адаптера — non-goal (дублирование).

## Migration Plan

- Новая фаза, миграции нет. Добавляется `src/mcp/`, npm-скрипты `mcp`/`mcp:http`, deps `@modelcontextprotocol/sdk`. CLI entry point `src/index.ts` не меняется — обратно совместимо.

## Open Questions

(нет — все решения зафиксированы; детали SDK-API уточнятся при реализации через Context7)
