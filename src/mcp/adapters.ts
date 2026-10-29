/**
 * Адаптер доменных тулов (ToolDef) → MCP request-handlers (Фаза 6, change mcp-server).
 *
 * Регистрирует на низкоуровневом `Server` два handler'а: `tools/list` и
 * `tools/call`. Доменные `inputSchema` (raw JSON Schema) передаются на wire
 * напрямую без конвертации (см. design D2). Тул `delegate` (внутренний контракт
 * оркестратора) исключается из списка.
 *
 * Ошибки handler'а не роняют сессию — возвращаются как `isError: true`.
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { ToolDef } from '../tools/registry.js';
import { toMcpResult, toMcpError } from './result.js';

/** Имя внутреннего тулa делегирования оркестратора — не экспонируется наружу. */
const DELEGATE_TOOL_NAME = 'delegate';

/** Описание тулa в формате MCP wire (имя, описание, JSON-схема параметров). */
interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: unknown;
}

/** Серверная информация MCP (имя + версия сервера). */
export interface McpServerInfo {
  name: string;
  version: string;
}

/**
 * Регистрирует на `server` handler'ы `tools/list` и `tools/call` для доменных
 * тулов. Тул `delegate` исключается.
 */
export function registerDomainTools(server: Server, tools: ToolDef[]): void {
  // Отфильтрованный список (без delegate) — пересчёт на каждый list cheap.
  const exposed = (): McpToolDefinition[] =>
    tools
      .filter((t) => t.name !== DELEGATE_TOOL_NAME)
      .map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      }));

  // Карта имя→ToolDef для быстрого lookup в tools/call (включая delegate для
  // единообразия ошибки «тул не найден», но delegate сюда не попадёт через list).
  const byName = new Map<string, ToolDef>(
    tools.filter((t) => t.name !== DELEGATE_TOOL_NAME).map((t) => [t.name, t]),
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: exposed(),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const name = request.params.name;
    const args = request.params.arguments ?? {};
    const def = byName.get(name);
    if (!def) {
      return toMcpError(new Error(`тул не найден: ${name}`));
    }
    try {
      const result = await def.handler(args);
      return toMcpResult(result);
    } catch (err) {
      return toMcpError(err);
    }
  });
}

/**
 * Создаёт низкоуровневый `Server` с зарегистрированными доменными тулами.
 * Не подключает транспорт — транспорт выбирает caller (stdio/HTTP).
 */
export function createMcpServer(info: McpServerInfo, tools: ToolDef[]): Server {
  const server = new Server(info, { capabilities: { tools: {} } });
  registerDomainTools(server, tools);
  return server;
}
