import { describe, it, expect, vi } from 'vitest';
import { MSDeviceFlowClient, DeviceFlowError } from '../src/tools/mail/oauth/device-flow.js';
import type { FetchLike } from '../src/tools/mail/oauth/device-flow.js';

const cfg = { clientId: 'ms-client-id', tenant: 'consumers' };

function jsonRes(status: number, body: unknown): ReturnType<FetchLike> {
  return Promise.resolve({
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  });
}

/** Хелпер: делает fetch, который на /devicecode возвращает device_code, на /token — последовательность ответов. */
function makeFetch(tokenResponses: Array<unknown>): FetchLike {
  const tokenCall = vi.fn();
  let tokenIdx = 0;
  return vi.fn((url: string) => {
    if (url.endsWith('/devicecode')) {
      return jsonRes(200, {
        device_code: 'dev-code-123',
        user_code: 'ABCD-EFGH',
        verification_uri: 'https://microsoft.com/devicelogin',
        expires_in: 900,
        interval: 1,
      });
    }
    // /token
    const body = tokenResponses[tokenIdx] ?? {};
    tokenIdx += 1;
    const status = (body as { error?: string }).error || (body as { access_token?: string }).access_token ? 200 : 400;
    void tokenCall;
    return jsonRes(status, body);
  }) as unknown as FetchLike;
}

describe('MSDeviceFlowClient.requestDeviceCode', () => {
  it('возвращает device_code/user_code/verification_uri и промптит пользователя', async () => {
    const prompt = vi.fn();
    const fetchFn = makeFetch([]);
    const client = new MSDeviceFlowClient({ ...cfg, prompt }, fetchFn);
    const res = await client.requestDeviceCode();
    expect(res.deviceCode).toBe('dev-code-123');
    expect(res.userCode).toBe('ABCD-EFGH');
    expect(res.verificationUri).toBe('https://microsoft.com/devicelogin');
    expect(prompt).toHaveBeenCalledWith(expect.stringContaining('ABCD-EFGH'));
  });

  it('бросает DeviceFlowError(http) при ошибке devicecode', async () => {
    const fetchFn: FetchLike = vi.fn(() =>
      jsonRes(400, { error: 'invalid_client', error_description: 'bad client id' }),
    ) as unknown as FetchLike;
    const client = new MSDeviceFlowClient(cfg, fetchFn);
    await expect(client.requestDeviceCode()).rejects.toThrow(/invalid_client/);
    await expect(client.requestDeviceCode()).rejects.toBeInstanceOf(DeviceFlowError);
  });
});

describe('MSDeviceFlowClient.pollForToken', () => {
  it('успех: access+refresh token', async () => {
    const fetchFn = makeFetch([
      { access_token: 'AT-1', refresh_token: 'RT-1', expires_in: 3600 },
    ]);
    const client = new MSDeviceFlowClient(cfg, fetchFn);
    const tok = await client.pollForToken('dev-code-123', 0);
    expect(tok.accessToken).toBe('AT-1');
    expect(tok.refreshToken).toBe('RT-1');
    expect(tok.expiresInSeconds).toBe(3600);
  });

  it('отказ: DeviceFlowError(denied)', async () => {
    const fetchFn = makeFetch([{ error: 'authorization_declined' }]);
    const client = new MSDeviceFlowClient(cfg, fetchFn);
    await expect(client.pollForToken('dev-code-123', 0)).rejects.toMatchObject({
      kind: 'denied',
    });
  });

  it('истёкший code: DeviceFlowError(expired)', async () => {
    const fetchFn = makeFetch([{ error: 'expired_token' }]);
    const client = new MSDeviceFlowClient(cfg, fetchFn);
    await expect(client.pollForToken('dev-code-123', 0)).rejects.toMatchObject({
      kind: 'expired',
    });
  });

  it('pending -> slow_down -> успех (поллинг)', async () => {
    const fetchFn = makeFetch([
      { error: 'authorization_pending' },
      { error: 'authorization_pending' },
      { access_token: 'AT-x', refresh_token: 'RT-x', expires_in: 3600 },
    ]);
    const client = new MSDeviceFlowClient(cfg, fetchFn);
    const tok = await client.pollForToken('dev-code-123', 0);
    expect(tok.accessToken).toBe('AT-x');
  });
});