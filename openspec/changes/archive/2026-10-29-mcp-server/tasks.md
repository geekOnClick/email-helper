# Tasks

## 1. Зависимости и каркас

- [x] 1.1 Установить `@modelcontextprotocol/sdk@^1.32.2` в `dependencies` (`npm i @modelcontextprotocol/sdk@^1.32.2`). Проверка: `package.json` содержит dep, `node -e "require('@modelcontextprotocol/sdk')"` не падает (или импорт в tsx-файле).
- [x] 1.2 Создать каталог `src/mcp/`. Проверка: каталог существует, пустой.

## 2. Адаптер ToolDef → MCP

- [x] 2.1 Создать `src/mcp/adapters.ts`: функция `registerDomainTools(server: McpServer, tools: ToolDef[])` — для каждого доменного тулa регистрирует MCP-тул (имя `tool.name`, описание `tool.description`, `inputSchema` через `fromJsonSchema(tool.inputSchema)`, handler оборачивает `tool.handler` с `try/catch` → `toMcpResult`/`toMcpError`). Тул `delegate` (имя `delegate`) исключается. Проверка: файл создан, tsc компилирует.
- [x] 2.2 Создать `src/mcp/result.ts`: функции `toMcpResult(result: unknown)` (строка/объект → `[{ type:'text', text }]`) и `toMcpError(err: unknown)` (`{ content:[{type:'text',text:msg}], isError:true }`). Проверка: файл создан, tsc компилирует.
- [x] 2.3 Тест `tests/mcp-adapters.test.ts`: stub-тулы в реестре (`resetTools` + `registerTool`), `createMcpServer` + `InMemoryTransport` + `Client`, проверить `listTools` содержит все тулы кроме `delegate`, `callTool` успешный возвращает text-content, `callTool` с throw возвращает `isError:true`. Проверка: `npx vitest run tests/mcp-adapters.test.ts` зелёный.

## 3. Factory createMcpServer

- [x] 3.1 Создать `src/mcp/server.ts`: функция `createMcpServer(opts: { tools: ToolDef[]; serverInfo?: { name; version } }): McpServer` — создаёт `McpServer`, вызывает `registerDomainTools`, возвращает сервер (без транспорта). Проверка: файл создан, tsc компилирует.
- [x] 3.2 Тест `tests/mcp-server.test.ts`: `createMcpServer` с stub-тулами, `InMemoryTransport` пара, `Client.listTools()` возвращает имена тулов, `Client.callTool()` исполняет handler. Проверка: `npx vitest run tests/mcp-server.test.ts` зелёный.

## 4. stdio-транспорт

- [x] 4.1 Создать `src/mcp/stdio.ts`: функция `runStdio(server: McpServer): Promise<void>` — создаёт `StdioServerTransport`, `await server.connect(transport)`, резолвится при закрытии. Проверка: файл создан, tsc компилирует.
- [x] 4.2 Тест `tests/mcp-stdio.test.ts`: создать пару `InMemoryTransport` (вместо реального stdio), подключить server-side и client-`Client`, проверить end-to-end `listTools`+`callTool` через транспорт. Проверка: `npx vitest run tests/mcp-stdio.test.ts` зелёный.

## 5. HTTP-транспорт

- [x] 5.1 Создать `src/mcp/http.ts`: функция `runHttp(opts: { server: McpServer; port?: number; host?: string }): Promise<{ close: () => Promise<void> }>` — поднимает HTTP-сервер с `StreamableHTTPServerTransport` на эндпоинте `/mcp`, дефолт `host: '127.0.0.1'`, `port: 3000`. Проверка: файл создан, tsc компилирует.
- [x] 5.2 Тест `tests/mcp-http.test.ts`: поднять `runHttp` на случайном порту с stub-тулами, MCP `Client` через `StreamableHTTPClientTransport` подключается, `listTools`+`callTool` работают, `close()` останавливает сервер. Проверка: `npx vitest run tests/mcp-http.test.ts` зелёный.

## 6. Entry point и сборка агента

- [x] 6.1 Создать `src/mcp/index.ts`: разбор `--http`/`--port`/`--host` флагов, вызов `bootstrap()` (переиспользование из `src/transport/cli/bootstrap.ts`), `createMcpServer({ tools: listTools() })`, запуск stdio или HTTP, обработка EOF/SIGINT/SIGTERM → `cleanup()`, ошибки конфига → stderr + exit 1. Проверка: `tsx src/mcp/index.ts --help` (или запуск с пустым env) выводит ошибку конфига, не падает с uncaught.
- [x] 6.2 Добавить npm-скрипты в `package.json`: `"mcp": "tsx src/mcp/index.ts"`, `"mcp:http": "tsx src/mcp/index.ts --http"`. Проверка: `npm run mcp --silent -- --help` (или запуск с timeout) не падает с uncaught.
- [x] 6.3 Интеграционный тест `tests/integration/mcp-bootstrap.test.ts`: stub-`RouterAiClient` + `composeAgents` регистрирует реальные mail-тулы, `bootstrap`-подобная сборка, `createMcpServer` + `InMemoryTransport` + `Client.listTools()` возвращает `mail.connect`/`mail.search` и т.д. (без реального подключения к почте). Проверка: `npx vitest run tests/integration/mcp-bootstrap.test.ts` зелёный.

## 7. Финальные проверки

- [x] 7.1 `npm test` — зелёный (все unit + mcp + integration). Проверка: exit 0.
- [x] 7.2 `npx tsc --noEmit` — без ошибок. Проверка: exit 0.
- [x] 7.3 `npm run lint` — без ошибок. Проверка: exit 0.
- [x] 7.4 `openspec validate mcp-server --strict` — проходит. Проверка: exit 0.

## Workflow follow-up

- Заархивировать change после ревью: `/opsx-archive mcp-server`.
- Проверить архивированный результат (`openspec list --specs` содержит `transport/mcp`).
- Smoke-тест: `npm run mcp` локально (подключение pi как MCP-клиента) — опц., после archive.
