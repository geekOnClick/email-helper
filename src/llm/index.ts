/**
 * LLM-клиент RouterAI (OpenAI-совместимый).
 * Фаза 2, change llm-client.
 */
export { RouterAiClient, redactKey, parseToolCallArguments, isRetryableStatus } from './routerai-client.js';
export type { RouterAiClientOptions, FetchLike } from './routerai-client.js';
export { resolveModel } from './models.js';
export type { ResolveModelOptions } from './models.js';
export { mapToolsToOpenAi, toOpenAiToolName, fromOpenAiToolName } from './tool-mapping.js';
export { parseChatResponse, chatCompletionResponseSchema } from './schema.js';
export type { ChatCompletionResponse, ParsedChatResponse } from './schema.js';
export { RouterAiError } from './types.js';
export { EmbeddingsClient, embeddingsResponseSchema } from './embeddings.js';
export type { EmbeddingsClientOptions, EmbeddingsResponse } from './embeddings.js';
export type {
  AgentRole,
  ChatMessage,
  ChatRequest,
  ChatResult,
  ToolCall,
  ToolChoice,
  OpenAiTool,
  OpenAiFunctionDef,
  SystemMessage,
  UserMessage,
  AssistantMessage,
  ToolResultMessage,
  Usage,
} from './types.js';
