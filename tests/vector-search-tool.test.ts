import { describe, it, expect, vi } from 'vitest';
import { createVectorSearchTool } from '../src/tools/vector/vector-search.tool.js';
import type { EmbeddingsClient } from '../src/llm/embeddings.js';
import type { FalkorClient, VectorSearchResult } from '../src/tools/vector/falkor.js';

const QVEC = [0.5, 0.5, 0.5, 0.5];

function mockEmb(vec: number[] = QVEC): EmbeddingsClient {
  return { embed: vi.fn(async () => [vec]) } as unknown as EmbeddingsClient;
}

function mockFalk(results: VectorSearchResult[]): FalkorClient {
  return {
    searchByEmailVector: vi.fn(async () => results),
  } as unknown as FalkorClient;
}

const HIT: VectorSearchResult = {
  emailId: 'a@y.com:INBOX:1',
  login: 'a@y.com',
  folder: 'INBOX',
  uid: 1,
  subject: 'subj',
  from: 's@x.com',
  date: '2026-01-01T00:00:00.000Z',
  snippet: 'snip',
  score: 0.9,
};

describe('createVectorSearchTool', () => {
  it('embeds query and searches', async () => {
    const emb = mockEmb();
    const falk = mockFalk([HIT]);
    const tool = createVectorSearchTool({ embeddingsClient: emb, falkorClient: falk });

    const out = await tool.handler({ query: 'найти письма' });

    expect(emb.embed).toHaveBeenCalledTimes(1);
    const call = (emb.embed as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(call).toEqual(['найти письма']);
    expect(falk.searchByEmailVector).toHaveBeenCalledTimes(1);
    const arg = (falk.searchByEmailVector as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(arg.query).toEqual(QVEC);
    expect(arg.k).toBe(5);
    expect(out).toEqual([HIT]);
  });

  it('passes filter and custom k', async () => {
    const emb = mockEmb();
    const falk = mockFalk([]);
    const tool = createVectorSearchTool({ embeddingsClient: emb, falkorClient: falk });

    await tool.handler({ query: 'q', k: 3, filter: { login: 'a@y.com', folder: 'INBOX' } });

    const arg = (falk.searchByEmailVector as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(arg.k).toBe(3);
    expect(arg.filter).toEqual({ login: 'a@y.com', folder: 'INBOX' });
  });

  it('default k is 5', async () => {
    const emb = mockEmb();
    const falk = mockFalk([]);
    const tool = createVectorSearchTool({ embeddingsClient: emb, falkorClient: falk });

    await tool.handler({ query: 'q' });

    const arg = (falk.searchByEmailVector as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(arg.k).toBe(5);
  });
});