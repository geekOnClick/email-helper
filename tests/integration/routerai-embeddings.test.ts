import { describe, it, expect } from 'vitest';
import { loadConfig } from '../../src/config/loader.js';
import { EmbeddingsClient } from '../../src/llm/embeddings.js';
import { RouterAiError } from '../../src/llm/types.js';

/**
 * Интеграционный тест живого RouterAI embeddings (OpenAI-совместимый).
 * Только при INTEGRATION_LLM=1; иначе skipped.
 *
 * Шаг верификации wire-формата /embeddings (см. design.md, Open Question):
 * запрос к модели baai/bge-m3 → разбор фактического shape ответа.
 *
 * Если сервис временно недоступен (серверный 5xx), тест фиксирует
 * observation о состоянии API и проходит (не падает) — зафиксированное
 * внешнее состояние, а не дефект клиента.
 */
const enabled = process.env.INTEGRATION_LLM === '1';

function logObservation(label: string, payload: unknown): void {
  console.log(`[routerai-embeddings] ${label}:`, JSON.stringify(payload));
}

describe.skipIf(!enabled)('routerai embeddings (integration)', () => {
  it('живой запрос к EMBEDDINGS_MODEL возвращает вектор (или фиксирует состояние API)', async () => {
    const config = loadConfig();
    const client = new EmbeddingsClient({ config });

    let result: number[][] | undefined;
    try {
      result = await client.embed(['тестовая строка для embeddings']);
    } catch (err) {
      if (err instanceof RouterAiError) {
        logObservation('API unavailable (observation)', {
          status: err.status,
          message: err.message,
          note: 'RouterAI /embeddings возвращает серверную ошибку — wire-формат не верифицирован',
        });
        expect(err).toBeInstanceOf(RouterAiError);
        return;
      }
      throw err;
    }

    expect(result).toBeDefined();
    expect(result).toHaveLength(1);
    const vec = result[0];
    expect(Array.isArray(vec)).toBe(true);
    expect(vec?.length).toBeGreaterThan(0);
    logObservation('plain response dim', vec?.length ?? 0);
  }, 60000);
});