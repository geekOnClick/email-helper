/**
 * Сериализация результата/ошибки тулa в MCP content-блоки (Фаза 6, change mcp-server).
 *
 * MCP `tools/call` возвращает `CallToolResult`: массив typed-блоков `content`
 * (text/image/...) + опц. `isError`. Доменные тулы возвращают `unknown`
 * (строка/объект); адаптер приводит их к text-блокам. Ошибки — `isError: true`
 * с текстом, не роняя сессию.
 *
 * Секреты не фильтруются здесь: контракт фаз 1/4 — доменные тулы редят
 * секреты в результатах и сообщениях ошибок (`mail/redact.ts`).
 */
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

/** Текстовый блок контента MCP. */
export interface TextContentBlock {
  type: 'text';
  text: string;
}

/** Результат успешного вызова тулa → text-блок(и). */
export function toMcpResult(result: unknown): CallToolResult {
  const text = stringifyResult(result);
  return { content: [{ type: 'text', text }] };
}

/** Ошибка тулa → isError: true с текстом ошибки. */
export function toMcpError(err: unknown): CallToolResult {
  const text = err instanceof Error ? err.message : String(err);
  return { content: [{ type: 'text', text }], isError: true };
}

/** Строка — как есть; объект — pretty-printed JSON. */
function stringifyResult(result: unknown): string {
  if (typeof result === 'string') return result;
  if (result === undefined) return '';
  return JSON.stringify(result, null, 2);
}
