import { describe, it, expect } from 'vitest';
import { loadConfig } from '../../src/config/loader.js';
import { FalkorClient, EMBEDDING_DIM } from '../../src/tools/vector/falkor.js';
import { createEmbeddingsIndexTool } from '../../src/tools/vector/embeddings-index.tool.js';
import { createVectorSearchTool } from '../../src/tools/vector/vector-search.tool.js';
import type { EmbeddingsClient } from '../../src/llm/embeddings.js';
import type { EmailFull } from '../../src/types/email.js';
import type { MailSessionStore } from '../../src/tools/mail/session-store.js';

/**
 * Интеграционный тест тулов embeddings.index + vector.search против живого FalkorDB.
 * Только при INTEGRATION_FALKOR=1; иначе skipped.
 *
 * Embeddings-клиент мок (RouterAI пока 500): возвращает детерминированный вектор,
 * построенный из текста (чтобы index и search векторы совпадали → письмо находилось).
 * sessionStore мок: возвращает stub-провайдер с фиксированным EmailFull.
 */
const enabled = process.env.INTEGRATION_FALKOR === '1';

/** Детерминированный «embedding» из текста: хэш в вектор EMBEDDING_DIM. */
function textToVec(text: string): number[] {
  const v = new Array<number>(EMBEDDING_DIM).fill(0);
  for (let i = 0; i < text.length; i++) {
    v[i % EMBEDDING_DIM] += text.charCodeAt(i) / 1000;
  }
  return v;
}

describe.skipIf(!enabled)('semantic-search tools (integration)', () => {
  it('embeddings.index → vector.search round-trip находит письмо', async () => {
    const config = loadConfig();
    const falkorClient = new FalkorClient({ config });
    await falkorClient.connect();
    await falkorClient.clear();

    const email: EmailFull = {
      uid: 1,
      subject: 'интеграционный поиск',
      from: { name: 'S', address: 's@x.com' },
      to: [{ address: 'me@y.com' }],
      date: new Date('2026-01-01T00:00:00.000Z'),
      flags: [],
      size: 10,
      folder: 'INBOX',
      body: 'тело письма для семантического поиска',
      hasBody: true,
      attachments: [],
    };

    const sessionStore = {
      get: () => ({ fetch: async () => email }),
    } as unknown as MailSessionStore;

    const embText = `${email.subject}\n${email.body}`;
    const embeddingsClient = {
      embed: async (texts: string[]) => texts.map(textToVec),
    } as unknown as EmbeddingsClient;

    const indexTool = createEmbeddingsIndexTool({ sessionStore, embeddingsClient, falkorClient });
    const searchTool = createVectorSearchTool({ embeddingsClient, falkorClient });

    await indexTool.handler({ login: 'it@y.com', uid: 1 });

    const results = await searchTool.handler({ query: embText, k: 5 });

    expect(results.length).toBeGreaterThan(0);
    const found = (results as Array<{ emailId: string }>).find(
      (r) => r.emailId === 'it@y.com:INBOX:1',
    );
    expect(found).toBeDefined();

    await falkorClient.clear();
    await falkorClient.close();
  }, 30000);
});