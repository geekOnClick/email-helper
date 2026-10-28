import { describe, it, expect } from 'vitest';
import { loadConfig } from '../../src/config/loader.js';
import { FalkorClient, EMBEDDING_DIM } from '../../src/tools/vector/falkor.js';

/**
 * Интеграционный тест живого FalkorDB (Docker, контейнер email-helper-falkordb).
 * Только при INTEGRATION_FALKOR=1; иначе skipped.
 *
 * Round-trip: connect → ensureSchema → clear → indexEmail → searchByEmailVector
 * возвращает индексированное письмо → clear.
 */
const enabled = process.env.INTEGRATION_FALKOR === '1';

/** Вектор с уникальным паттерном, чтобы найти своё же письмо. */
function makeVector(seed: number): number[] {
  return Array.from({ length: EMBEDDING_DIM }, (_, i) => (i + seed) / EMBEDDING_DIM);
}

describe.skipIf(!enabled)('falkor-client (integration)', () => {
  it('round-trip indexEmail → searchByEmailVector возвращает письмо', async () => {
    const config = loadConfig();
    const client = new FalkorClient({ config });

    await client.connect();
    await client.clear();

    const embedding = makeVector(1);
    await client.indexEmail({
      emailId: 'integration@test.com:INBOX:1',
      login: 'integration@test.com',
      folder: 'INBOX',
      uid: 1,
      subject: 'Интеграционный тест',
      from: 'sender@test.com',
      date: '2026-01-01T00:00:00.000Z',
      snippet: 'Тело письма для round-trip',
      embedding,
    });

    const results = await client.searchByEmailVector({ query: embedding, k: 5 });
    expect(results.length).toBeGreaterThan(0);
    const found = results.find((r) => r.emailId === 'integration@test.com:INBOX:1');
    expect(found).toBeDefined();
    expect(found?.login).toBe('integration@test.com');
    expect(found?.subject).toBe('Интеграционный тест');

    await client.clear();
    await client.close();
  }, 30000);
});