import type { ToolDef, JSONObjectSchema } from '../tools/registry.js';
import type { OpenAiTool } from './types.js';

/**
 * Преобразование доменных тулов (реестр агента) в формат OpenAI tools.
 *
 * Имена доменных тулов содержат точки (mail.search), но OpenAI требует
 * `^[a-zA-Z0-9_-]{1,64}$`. Точки транслируются в подчёркивания и обратно —
 * единая пара функций обеспечивает round-trip.
 */

/** Доменное имя тулa → имя функции OpenAI (точки → подчёркивания). */
export function toOpenAiToolName(name: string): string {
  return name.replace(/\./g, '_');
}

/** Имя функции OpenAI → доменное имя тулa (подчёркивания → точки). */
export function fromOpenAiToolName(name: string): string {
  return name.replace(/_/g, '.');
}

/**
 * Преобразует массив доменных тулов в массив OpenAI tools.
 * `parameters` берётся из `inputSchema` как есть (он уже в формате JSON-схемы).
 */
export function mapToolsToOpenAi(tools: ToolDef[]): OpenAiTool[] {
  return tools.map((tool) => ({
    type: 'function',
    function: {
      name: toOpenAiToolName(tool.name),
      description: tool.description,
      parameters: tool.inputSchema as JSONObjectSchema,
    },
  }));
}
