/**
 * Регистрация векторных тулов в общем реестре.
 * Фаза 3b, change semantic-search.
 *
 * Паттерн `registerMailConnectTools`: фабрики тулов с deps.
 */
import { registerTool } from '../registry.js';
import { createEmbeddingsIndexTool } from './embeddings-index.tool.js';
import { createVectorSearchTool } from './vector-search.tool.js';
import type { MailSessionStore } from '../mail/session-store.js';
import type { EmbeddingsClient } from '../../llm/embeddings.js';
import type { FalkorClient } from './falkor.js';

export interface RegisterVectorToolsDeps {
  sessionStore: MailSessionStore;
  embeddingsClient: EmbeddingsClient;
  falkorClient: FalkorClient;
}

/**
 * Регистрирует тулы embeddings.index и vector.search в реестре.
 * `registerTool` throws на дубликат — вызывать один раз за процесс.
 */
export function registerVectorTools(deps: RegisterVectorToolsDeps): void {
  registerTool(createEmbeddingsIndexTool(deps));
  registerTool(createVectorSearchTool(deps));
}