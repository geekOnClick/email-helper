/** Параметры вызова тулa (JSON-объект). */
export type ToolArgs = Record<string, unknown>;

/** Минимальный тип JSON-схемы (не тянем @types/json-schema как прямую зависимость). */
export type JSONObjectSchema = {
  type?: 'object' | 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'null';
  properties?: Record<string, unknown>;
  required?: string[];
  [key: string]: unknown;
};

/** Результат выполнения тулa. */
export type ToolResult = unknown;

/** Определение тулa (для registry/MCP). */
export interface ToolDef<TArgs = ToolArgs> {
  /** Уникальное имя, напр. 'mail.connect'. */
  name: string;
  /** Человекочитаемое описание (на русском). */
  description: string;
  /** JSON-схема параметров (для валидации и MCP). Локальный тип, чтобы не тянуть @types/json-schema как прямую зависимость. */
  inputSchema: JSONObjectSchema;
  /** Обработчик. */
  handler: (args: TArgs) => Promise<ToolResult>;
}

/**
 * Реестр тулов агента. Регистрация, получение, список.
 * Каркас (task 6.1); позже используется MCP-сервером и агентами.
 */
const tools = new Map<string, ToolDef>();

export function registerTool<TArgs = ToolArgs>(def: ToolDef<TArgs>): void {
  if (tools.has(def.name)) {
    throw new Error(`тул уже зарегистрирован: ${def.name}`);
  }
  tools.set(def.name, def as unknown as ToolDef);
}

export function getTool(name: string): ToolDef | undefined {
  return tools.get(name);
}

export function listTools(): ToolDef[] {
  return Array.from(tools.values());
}

/** Сброс реестра (для тестов). */
export function resetTools(): void {
  tools.clear();
}