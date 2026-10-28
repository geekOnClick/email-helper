import { describe, it, expect } from 'vitest';
import { resolveModel } from '../src/llm/models.js';
import type { Config } from '../src/config/schema.js';

/** Минимальный конфиг для тестов (только поля моделей + ключ). */
function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    ROUTERAI_API_KEY: 'key',
    ROUTERAI_BASE_URL: 'https://routerai.ru/api/v1',
    MODEL_ORCHESTRATOR: 'z-ai/glm-5.2',
    MODEL_ANALYZER: 'z-ai/glm-5.2',
    MODEL_HELPER: 'z-ai/glm-5.3-flash',
    EMBEDDINGS_MODEL: 'baai/bge-m3',
    LLM_REQUEST_TIMEOUT_MS: 60000,
    LLM_RETRIES: 3,
    LLM_RETRY_BASE_MS: 1000,
    FALKORDB_HOST: 'localhost',
    FALKORDB_PORT: 6380,
    FALKORDB_PASSWORD: '',
    ACCOUNTS: '[]',
    DOWNLOAD_DIR: './downloads',
    MS_CLIENT_ID: '',
    MS_TENANT: 'consumers',
    OAUTH_TOKEN_STORE_PATH: './.tokens/oauth.json',
    ...overrides,
  };
}

describe('resolveModel', () => {
  it('role helper → MODEL_HELPER', () => {
    expect(resolveModel(makeConfig(), { role: 'helper' })).toBe('z-ai/glm-5.3-flash');
  });

  it('role orchestrator → MODEL_ORCHESTRATOR', () => {
    expect(resolveModel(makeConfig(), { role: 'orchestrator' })).toBe('z-ai/glm-5.2');
  });

  it('role analyzer → MODEL_ANALYZER', () => {
    expect(resolveModel(makeConfig(), { role: 'analyzer' })).toBe('z-ai/glm-5.2');
  });

  it('явный model переопределяет роль', () => {
    expect(resolveModel(makeConfig(), { role: 'helper', model: 'custom/model-x' })).toBe(
      'custom/model-x',
    );
  });

  it('без роли и модели → дефолт MODEL_HELPER', () => {
    expect(resolveModel(makeConfig(), {})).toBe('z-ai/glm-5.3-flash');
  });

  it('пустой явный model игнорируется, берётся роль', () => {
    expect(resolveModel(makeConfig(), { role: 'orchestrator', model: '   ' })).toBe('z-ai/glm-5.2');
  });
});
