/**
 * Тул vector.search: семантический поиск писем.
 * Фаза 3b, change semantic-search.
 *
 * Строит embedding запроса через EmbeddingsClient и ищет top-k писем
 * в FalkorDB. Контракт — см. спеку `mail/semantic-search`.
 */
import type { ToolDef } from '../registry.js';
import type { EmbeddingsClient } from '../../llm/embeddings.js';
import type { FalkorClient } from './falkor.js';

export interface VectorSearchArgs {
  query: string;
  k?: number;
  filter?: { login?: string; folder?: string };
}

export interface VectorSearchDeps {
  embeddingsClient: EmbeddingsClient;
  falkorClient: FalkorClient;
}

const DEFAULT_K = 5;

/**
 * Тул vector.search: семантический поиск писем по смыслу.
 * Возвращает до k писем с оценкой близости.
 */
export function createVectorSearchTool(deps: VectorSearchDeps): ToolDef<VectorSearchArgs> {
  return {
    name: 'vector.search',
    description:
      'Семантический поиск писем по смыслу: принимает запрос, строит embedding и возвращает top-k ближайших писем с метаданными и оценкой. Опц. фильтр по login/folder.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'текст запроса' },
        k: { type: 'integer', description: 'число результатов (по умолчанию 5)' },
        filter: {
          type: 'object',
          properties: {
            login: { type: 'string' },
            folder: { type: 'string' },
          },
          description: 'опц. фильтр по аккаунту и/или папке',
        },
      },
      required: ['query'],
    },
    handler: async (args) => {
      const { query, filter } = args;
      const k = typeof args.k === 'number' && args.k > 0 ? args.k : DEFAULT_K;
      if (typeof query !== 'string' || query.length === 0) {
        throw new Error('vector.search: требуется непустой параметр query');
      }

      const vectors = await deps.embeddingsClient.embed([query]);
      const queryVec = vectors[0];
      if (!queryVec) {
        throw new Error('vector.search: embeddings-клиент не вернул вектор');
      }

      return deps.falkorClient.searchByEmailVector({
        query: queryVec,
        k,
        filter,
      });
    },
  };
}