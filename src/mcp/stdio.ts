/**
 * stdio-транспорт MCP-сервера (Фаза 6, change mcp-server).
 *
 * Локальный запуск для клиентов типа pi/Claude Desktop: обмен сообщениями
 * через стандартные потоки ввода/вывода. `server.connect(transport)` блокирует
 * до закрытия транспорта (EOF на stdin / ошибка потока).
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { Readable, Writable } from 'node:stream';

/**
 * Запускает MCP-сервер на stdio-транспорте. Резолвится при закрытии транспорта.
 * @param server MCP-сервер с зарегистрированными тулами.
 * @param stdin Переопределение stdin (для тестов).
 * @param stdout Переопределение stdout (для тестов).
 */
export async function runStdio(
  server: Server,
  stdin?: Readable,
  stdout?: Writable,
): Promise<void> {
  const transport = new StdioServerTransport(stdin, stdout);
  await server.connect(transport);
}
