import { describe, it, expect, vi } from 'vitest';
import { createEmbeddingsIndexTool, buildIndexText, buildSnippet } from '../src/tools/vector/embeddings-index.tool.js';
import type { EmailFull } from '../src/types/email.js';
import type { MailSessionStore } from '../src/tools/mail/session-store.js';
import type { EmbeddingsClient } from '../src/llm/embeddings.js';
import type { FalkorClient } from '../src/tools/vector/falkor.js';

const VEC = [0.1, 0.2, 0.3, 0.4];

function makeEmail(o = {}) {
  return {
    uid: 42, subject: 'subj-A', from: { name: 'Boss', address: 'boss@x.com' },
    to: [{ address: 'me@y.com' }], date: new Date('2026-01-01T00:00:00.000Z'),
    flags: [], size: 100, folder: 'INBOX', body: 'body-A', hasBody: true, attachments: [],
    ...o,
  } as EmailFull;
}

function mockStore(email) {
  return { get: vi.fn(() => ({ fetch: vi.fn(async () => email) })) } as unknown as MailSessionStore;
}
function mockEmb(vec = VEC) {
  return { embed: vi.fn(async () => [vec]) } as unknown as EmbeddingsClient;
}
function mockFalk() {
  return { indexEmail: vi.fn(async () => undefined) } as unknown as FalkorClient;
}

describe('buildIndexText', () => {
  it('joins subject and body', () => {
    expect(buildIndexText('subj-A', 'body-A', true)).toBe('subj-A\nbody-A');
  });
  it('uses only subject when no body', () => {
    expect(buildIndexText('subj-A', '', false)).toBe('subj-A');
  });
});

describe('buildSnippet', () => {
  it('truncates long body', () => {
    expect(buildSnippet('a'.repeat(600), true)).toHaveLength(500);
  });
  it('empty for missing body', () => {
    expect(buildSnippet('', false)).toBe('');
  });
});

describe('createEmbeddingsIndexTool', () => {
  it('indexes a new email', async () => {
    const em = makeEmail(); const store = mockStore(em); const emb = mockEmb(); const falk = mockFalk();
    const tool = createEmbeddingsIndexTool({ sessionStore: store, embeddingsClient: emb, falkorClient: falk });
    const result = await tool.handler({ login: 'a@y.com', uid: 42 });
    expect(store.get).toHaveBeenCalledWith('a@y.com');
    const embCall = (emb.embed).mock.calls[0]?.[0];
    expect(embCall).toEqual(['subj-A\nbody-A']);
    expect(falk.indexEmail).toHaveBeenCalledTimes(1);
    const input = (falk.indexEmail).mock.calls[0]?.[0];
    expect(input.emailId).toBe('a@y.com:INBOX:42');
    expect(input.embedding).toEqual(VEC);
    expect(input.subject).toBe('subj-A');
    expect(input.from).toBe('boss@x.com');
    expect(result).toEqual({ indexed: true, emailId: 'a@y.com:INBOX:42', login: 'a@y.com', folder: 'INBOX', uid: 42 });
  });
  it('throws when no connection', async () => {
    const store = { get: vi.fn(() => undefined) } as unknown as MailSessionStore;
    const tool = createEmbeddingsIndexTool({ sessionStore: store, embeddingsClient: mockEmb(), falkorClient: mockFalk() });
    await expect(tool.handler({ login: 'nobody@y.com', uid: 1 })).rejects.toThrow();
  });
  it('embeds from subject when body empty', async () => {
    const em = makeEmail({ body: '', hasBody: false }); const store = mockStore(em); const emb = mockEmb(); const falk = mockFalk();
    const tool = createEmbeddingsIndexTool({ sessionStore: store, embeddingsClient: emb, falkorClient: falk });
    await tool.handler({ login: 'a@y.com', uid: 7 });
    const call = (emb.embed).mock.calls[0]?.[0];
    expect(call).toEqual(['subj-A']);
  });
});
