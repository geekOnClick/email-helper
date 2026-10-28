/**
 * Векторное хранилище FalkorDB: клиент и графовая модель писем.
 * Фаза 3, change vector-store.
 */
export { FalkorClient, FalkorError, createFalkorConnection, EMBEDDING_DIM } from './falkor.js';
export type {
  FalkorClientOptions,
  FalkorConnection,
  IndexEmailInput,
  VectorSearchInput,
  VectorSearchResult,
} from './falkor.js';