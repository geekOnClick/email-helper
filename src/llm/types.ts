/**
 * Доменные типы LLM-клиента RouterAI (OpenAI-совместимый контракт).
 * Phase 2, llm-client: один шаг запрос→ответ. Цикл tool-calling — отдельные change'ы.
 */

/** Роль агента — определяет модель из конфига. */
export type AgentRole = 'orchestrator' | 'analyzer' | 'helper';

/** Идентификатор вызова функции (из ответа модели). */
export interface ToolCall {
  /** Идентификатор вызова (для сопоставления с role:"tool" ответом). */
  id: string;
  /** Имя функции (в доменном виде, с точками: mail.search). */
  name: string;
  /** Сырые аргументы (строка JSON из ответа). */
  arguments: string;
  /** Распарсенные аргументы (объект) или null, если JSON невалиден. */
  args: unknown | null;
  /** Ошибка парсинга arguments, если есть (не роняет запрос). */
  parseError?: string;
}

/** Сообщение системного промпта. */
export interface SystemMessage {
  role: 'system';
  content: string;
}

/** Сообщение пользователя. */
export interface UserMessage {
  role: 'user';
  content: string;
}

/** Сообщение ассистента (ответ модели или предыстория). */
export interface AssistantMessage {
  role: 'assistant';
  content: string | null;
  /** Вызовы функций, если модель решила вызвать тулы. */
  toolCalls?: ToolCall[];
}

/** Сообщение с результатом вызова тулa. */
export interface ToolResultMessage {
  role: 'tool';
  /** Идентификатор вызова, к которому относится результат. */
  toolCallId: string;
  /** Результат выполнения тулa (сериализованная строка). */
  content: string;
}

/** Сообщение чата (объединение). */
export type ChatMessage = SystemMessage | UserMessage | AssistantMessage | ToolResultMessage;

/** Определение функции в формате OpenAI tools. */
export interface OpenAiFunctionDef {
  name: string;
  description: string;
  /** JSON-схема параметров (доменная JSONObjectSchema из реестра тулов). */
  parameters: Record<string, unknown>;
}

/** Один элемент tools-массива (OpenAI формат). */
export interface OpenAiTool {
  type: 'function';
  function: OpenAiFunctionDef;
}

/** Способ выбора функции моделью. */
export type ToolChoice = 'auto' | 'none' | { type: 'function'; function: { name: string } };

/** Запрос чат-комплишена к LLM. */
export interface ChatRequest {
  /** Сообщения диалога (включая системный промпт). */
  messages: ChatMessage[];
  /** Роль агента — определяет модель по умолчанию. */
  role?: AgentRole;
  /** Явный идентификатор модели (приоритет над role). */
  model?: string;
  /** Определения доступных функций (tools). */
  tools?: OpenAiTool[];
  /** Стратегия выбора функции. */
  toolChoice?: ToolChoice;
  /** Параметры генерации. */
  temperature?: number;
  maxTokens?: number;
  topP?: number;
}

/** Использование токенов (из ответа API, опц.). */
export interface Usage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

/** Результат чат-запроса. */
export interface ChatResult {
  /** Текстовый ответ ассистента (может быть пустым при tool_calls). */
  content: string;
  /** Вызовы функций (если модель вызвала тулы). */
  toolCalls: ToolCall[];
  /** Использование токенов, если вернулось. */
  usage?: Usage;
  /** Модель, фактически ответившая. */
  model?: string;
}

/** Ошибка LLM-клиента (не содержит API-ключа). */
export class RouterAiError extends Error {
  /** HTTP-статус, если применимо. */
  readonly status?: number;
  /** Идентификатор модели, к которой шёл запрос. */
  readonly model?: string;
  /** Задержка повтора из Retry-After (мс), если сервер её вернул. */
  readonly retryAfterMs?: number;

  constructor(
    message: string,
    opts?: { status?: number; model?: string; retryAfterMs?: number; cause?: unknown },
  ) {
    super(message);
    this.name = 'RouterAiError';
    if (opts?.status !== undefined) this.status = opts.status;
    if (opts?.model !== undefined) this.model = opts.model;
    if (opts?.retryAfterMs !== undefined) this.retryAfterMs = opts.retryAfterMs;
    if (opts?.cause !== undefined) this.cause = opts.cause;
  }
}
