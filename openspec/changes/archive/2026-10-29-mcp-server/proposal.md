# Proposal

## Why

Агент уже имеет ядро (оркестратор + тулы через реестр), но доступен только из CLI-REPL.
Внешние LLM-клиенты (pi, Claude Desktop, другие MCP-aware клиенты) не могут вызывать тулы агента.
MCP-сервер над реестром тулов экспонирует их по стандартному протоколу Model Context Protocol —
любой совместимый клиент сможет подключаться и вызывать mail/vector-тулы напрямую.

## What Changes

- Новый транспорт `transport/mcp`: MCP-сервер над существующим реестром тулов (`src/tools/registry.ts`).
- Тулы агента (`mail.connect`, `mail.search`, `mail.fetch`, `mail.downloadAttachments`, `mail.send`, `embeddings.index`, `vector.search`) регистрируются как MCP-тулы с их JSON-схемами параметров (`ToolDef.inputSchema`).
- Исполнение вызова: MCP-сервер делегирует в `ToolDef.handler`, сериализует результат в `content` (text-блоки), ошибки возвращает как `isError: true` (не роняя сессию).
- Два транспорта запуска: **stdio** (для локальных клиентов типа pi/Claude Desktop) и **Streamable HTTP** (для удалённых/веб-клиентов).
- Сборка агента при старте: переиспользует `bootstrap()` (конфиг + аккаунты + `composeAgents`) для регистрации тулов; MCP-сервер запускается поверх готового реестра.
- Отдельная точка входа `src/mcp/index.ts` (не затрагивает CLI entry point `src/index.ts`).
- Изоляция секретов: API-ключи/пароли не попадают в MCP-ответы; тулы уже не возвращают секреты по контрактам фаз 1/4.

## Capabilities

### New Capabilities

- `transport/mcp`: MCP-сервер над реестром тулов агента — регистрация тулов с JSON-схемами, исполнение вызовов через `handler`, возврат результатов/ошибок по контракту MCP, два транспорта (stdio + Streamable HTTP), сборка агента при старте, корректное завершение с освобождением ресурсов.

### Modified Capabilities

(нет — транспорт новый, существующие спеки тулов и оркестратора не меняются; MCP-сервер читает реестр как есть)

## Impact

- **Новый код:** `src/mcp/` (server.ts, adapters, index.ts) — мост между `ToolDef` и MCP `registerTool`.
- **Переиспользование:** `src/transport/cli/bootstrap.ts` (`bootstrap()` — сборка агента), `src/tools/registry.ts` (`listTools`, `getTool`).
- **Зависимости:** `@modelcontextprotocol/sdk` (v1.32.2, stable v1-line) — `McpServer`, `StdioServerTransport`, `StreamableHTTPServerTransport`. Без zod-зависимости для схем: используется `fromJsonSchema` для raw JSON Schema (наши `inputSchema` уже JSON Schema).
- **Точка входа:** новый `src/mcp/index.ts` + npm-скрипт `mcp` (`tsx src/mcp/index.ts`); CLI entry point `src/index.ts` не меняется.
- **Тесты:** контрактные — MCP-клиент в тестах подключается к серверу, вызывает тулы, проверяет `listTools`/`callTool` (результат + `isError`).
- **Безопасность:** MCP-сервер не логирует и не возвращает секреты; тулы уже красят/не возвращают секреты по контрактам фаз 1/4; stdio-транспорт — локальный (без сетевой экспозиции), HTTP-транспорт — по умолчанию localhost.
