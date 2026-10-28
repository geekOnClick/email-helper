/**
 * Векторное хранилище FalkorDB: клиент, тулы индексации и поиска.
 * Фаза 3 (vector-store) + Фаза 3b (semantic-search).
 */
export { FalkorClient, FalkorError, createFalkorConnection, EMBEDDING_DIM } from './falkor.js';
export type {
  FalkorClientOptions,
  FalkorConnection,
  IndexEmailInput,
  VectorSearchInput,
  VectorSearchResult,
} from './falkor.js';
export { createEmbeddingsIndexTool, buildIndexText, buildSnippet } from './embeddings-index.tool.js';
export type { EmbeddingsIndexArgs, EmbeddingsIndexDeps } from './embeddings-index.tool.js';
export { createVectorSearchTool } from './vector-search.tool.js';
export type { VectorSearchArgs, VectorSearchDeps } from './vector-search.tool.js';
export { registerVectorTools } from './register-tools.js';
export type { RegisterVectorToolsDeps } from './register-tools.js';