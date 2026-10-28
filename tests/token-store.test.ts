import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OAuthTokenStore } from '../src/tools/mail/oauth/token-store.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'oauth-store-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('OAuthTokenStore', () => {
  it('get возвращает null для отсутствующего файла', async () => {
    const store = new OAuthTokenStore(join(dir, 'missing.json'));
    expect(await store.get('u@outlook.com')).toBeNull();
  });

  it('write→read round-trip', async () => {
    const store = new OAuthTokenStore(join(dir, 'oauth.json'));
    await store.set('u@outlook.com', {
      accessToken: 'AT',
      refreshToken: 'RT',
      expiresAt: 1_000_000,
    });
    const tok = await store.get('u@outlook.com');
    expect(tok).toEqual({ accessToken: 'AT', refreshToken: 'RT', expiresAt: 1_000_000 });
  });

  it('clear удаляет запись', async () => {
    const store = new OAuthTokenStore(join(dir, 'oauth.json'));
    await store.set('u@outlook.com', {
      accessToken: 'AT',
      refreshToken: 'RT',
      expiresAt: 1_000_000,
    });
    await store.clear('u@outlook.com');
    expect(await store.get('u@outlook.com')).toBeNull();
  });

  it('амперсант недействителен, когда истёк access token', async () => {
    const now = 5_000_000;
    const store = new OAuthTokenStore(join(dir, 'oauth.json'), () => now);
    // expired
    const t = { accessToken: 'AT', refreshToken: 'RT', expiresAt: now - 1000 };
    expect(store.isAccessTokenValid(t)).toBe(false);
  });

  it('амперсант действителен, когда access token свежий', async () => {
    const now = 5_000_000;
    const store = new OAuthTokenStore(join(dir, 'oauth.json'), () => now);
    const t = { accessToken: 'AT', refreshToken: 'RT', expiresAt: now + 120_000 };
    expect(store.isAccessTokenValid(t)).toBe(true);
  });

  it('не перезаписывает другие аккаунты при set', async () => {
    const store = new OAuthTokenStore(join(dir, 'oauth.json'));
    await store.set('a@outlook.com', { accessToken: 'A', refreshToken: 'R1', expiresAt: 1 });
    await store.set('b@outlook.com', { accessToken: 'B', refreshToken: 'R2', expiresAt: 2 });
    expect((await store.get('a@outlook.com'))?.accessToken).toBe('A');
    expect((await store.get('b@outlook.com'))?.accessToken).toBe('B');
  });
});