import { describe, it, expect } from 'vitest';
import { loadConfig, parseAccounts } from '../src/config/loader.js';
import { ConfigSchema, AccountSchema } from '../src/config/schema.js';

describe('ConfigSchema', () => {
  it('принимает конфиг с одним обязательным полем ROUTERAI_API_KEY', () => {
    const ok = ConfigSchema.safeParse({ ROUTERAI_API_KEY: 'k' });
    expect(ok.success).toBe(true);
    if (ok.success) {
      expect(ok.data.MODEL_HELPER).toBe('z-ai/glm-5.3-flash');
      expect(ok.data.EMBEDDINGS_MODEL).toBe('baai/bge-m3');
    }
  });

  it('отвергает пустой конфиг', () => {
    const bad = ConfigSchema.safeParse({});
    expect(bad.success).toBe(false);
  });

  it('отвергает невалидный URL в ROUTERAI_BASE_URL', () => {
    const bad = ConfigSchema.safeParse({
      ROUTERAI_API_KEY: 'k',
      ROUTERAI_BASE_URL: 'not-a-url',
    });
    expect(bad.success).toBe(false);
  });
});

describe('loadConfig', () => {
  it('возвращает валидный конфиг из переданного env', () => {
    const cfg = loadConfig({ ROUTERAI_API_KEY: 'test-key' });
    expect(cfg.ROUTERAI_API_KEY).toBe('test-key');
    expect(cfg.MODEL_ORCHESTRATOR).toBe('z-ai/glm-5.2');
  });

  it('бросает при пустом env', () => {
    expect(() => loadConfig({})).toThrow(/невалидна/i);
  });
});

describe('parseAccounts', () => {
  it('парсит валидный массив аккаунтов', () => {
    const accounts = parseAccounts(
      JSON.stringify([
        { provider: 'yandex', login: 'a@yandex.com', password: 'p1' },
        { provider: 'outlook', login: 'b@outlook.com', password: 'p2' },
      ]),
    );
    expect(accounts).toHaveLength(2);
    expect(accounts[0]?.provider).toBe('yandex');
    expect(accounts[1]?.provider).toBe('outlook');
  });

  it('возвращает пустой массив для "[]"', () => {
    expect(parseAccounts('[]')).toEqual([]);
  });

  it('бросает при невалидном JSON', () => {
    expect(() => parseAccounts('not-json')).toThrow(/JSON/);
  });

  it('бросает при невалидной записи (нет provider)', () => {
    expect(() => parseAccounts(JSON.stringify([{ login: 'x', password: 'y' }]))).toThrow(
      /невалидная запись аккаунта/i,
    );
  });
});

describe('auth strategy & microsoft config (mail-connect)', () => {
  it('ConfigSchema даёт дефолты для новых полей', () => {
    const cfg = ConfigSchema.parse({ ROUTERAI_API_KEY: 'k' });
    expect(cfg.MS_CLIENT_ID).toBe('');
    expect(cfg.MS_TENANT).toBe('consumers');
    expect(cfg.OAUTH_TOKEN_STORE_PATH).toBe('./.tokens/oauth.json');
  });

  it('AccountSchema даёт authStrategy=basic по умолчанию', () => {
    const acc = AccountSchema.parse({
      provider: 'yandex',
      login: 'u@yandex.com',
      password: 'p',
    });
    expect(acc.authStrategy).toBe('basic');
  });

  it('AccountSchema принимает authStrategy=oauth2', () => {
    const acc = AccountSchema.parse({
      provider: 'outlook',
login: 'u@outlook.com',
      password: 'p',
      authStrategy: 'oauth2',
    });
    expect(acc.authStrategy).toBe('oauth2');
  });

  it('AccountSchema отвергает неизвестную authStrategy', () => {
    const bad = AccountSchema.safeParse({
      provider: 'outlook',
      login: 'u@outlook.com',
      password: 'p',
      authStrategy: 'magic',
    });
    expect(bad.success).toBe(false);
  });

  it('parseAccounts прокидывает authStrategy', () => {
    const accounts = parseAccounts(
      JSON.stringify([
        { provider: 'outlook', login: 'a@outlook.com', password: 'p', authStrategy: 'oauth2' },
      ]),
    );
    expect(accounts[0]?.authStrategy).toBe('oauth2');
  });
});