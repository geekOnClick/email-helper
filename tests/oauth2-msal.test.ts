import { describe, it, expect, vi } from 'vitest';
import { OAuth2MsalStrategy } from '../src/tools/mail/providers/oauth2-msal.js';
import { OAuthTokenStore } from '../src/tools/mail/oauth/token-store.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { MailAccount, ImapConnectionOptions } from '../src/tools/mail/types.js';
import type { MSDeviceFlowClient } from '../src/tools/mail/oauth/device-flow.js';
import type { SmtpConnectionOptions } from '../src/tools/mail/mail-provider.js';

const account: MailAccount = {
  provider: 'outlook',
  login: 'alcauselove@outlook.com',
  password: 'irrelevant',
  authStrategy: 'oauth2',
};

const connection: ImapConnectionOptions = {
  host: 'outlook.office365.com',
  port: 993,
  secure: true,
  disableAutoIdle: true,
  logger: false,
};

const cfg = { clientId: 'ms-client-id', tenant: 'consumers' };

let dir: string;
async function withStore<T>(fn: (store: OAuthTokenStore) => Promise<T>): Promise<T> {
  dir = await mkdtemp(join(tmpdir(), 'oauth-strat-'));
  try {
    return await fn(new OAuthTokenStore(join(dir, 'oauth.json')));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function mockDeviceFlow(opts: {
  refresh?: () => Promise<{ accessToken: string; refreshToken: string; expiresInSeconds: number }>;
  requestDeviceCode?: () => Promise<{ deviceCode: string; userCode: string; verificationUri: string; expiresInSeconds: number; intervalSeconds: number }>;
  pollForToken?: () => Promise<{ accessToken: string; refreshToken: string; expiresInSeconds: number }>;
} = {}): MSDeviceFlowClient {
  return {
    refresh: opts.refresh ?? vi.fn().mockRejectedValue(new Error('no refresh')),
    requestDeviceCode:
      opts.requestDeviceCode ??
      vi.fn().mockResolvedValue({
        deviceCode: 'dc',
        userCode: 'UC',
        verificationUri: 'https://microsoft.com/devicelogin',
        expiresInSeconds: 900,
        intervalSeconds: 0,
      }),
    pollForToken:
      opts.pollForToken ??
      vi.fn().mockResolvedValue({ accessToken: 'AT-device', refreshToken: 'RT-device', expiresInSeconds: 3600 }),
  } as unknown as MSDeviceFlowClient;
}

describe('OAuth2MsalStrategy', () => {
  it('валидный access token из store — без flow', async () => {
    await withStore(async (store) => {
      // свежий токен (expiresAt далеко в будущем)
      await store.set(account.login, {
        accessToken: 'AT-stored',
        refreshToken: 'RT-stored',
        expiresAt: Date.now() + 3_600_000,
      });
      const flow = mockDeviceFlow();
      const strat = new OAuth2MsalStrategy(cfg, store, flow);
      const opts = await strat.getImapAuth(account, connection);
      expect(opts.auth).toEqual({ user: account.login, accessToken: 'AT-stored' });
      expect(flow.requestDeviceCode).not.toHaveBeenCalled();
      expect(flow.refresh).not.toHaveBeenCalled();
    });
  });

  it('истёкший access + валидный refresh — refresh flow, без device code', async () => {
    await withStore(async (store) => {
      await store.set(account.login, {
        accessToken: 'AT-old',
        refreshToken: 'RT-stored',
        expiresAt: Date.now() - 1000, // истёк
      });
      const flow = mockDeviceFlow({
        refresh: vi.fn().mockResolvedValue({ accessToken: 'AT-refreshed', refreshToken: 'RT-new', expiresInSeconds: 3600 }),
      });
      const strat = new OAuth2MsalStrategy(cfg, store, flow);
      const opts = await strat.getImapAuth(account, connection);
      expect(opts.auth).toEqual({ user: account.login, accessToken: 'AT-refreshed' });
      expect(flow.refresh).toHaveBeenCalledWith('RT-stored');
      expect(flow.requestDeviceCode).not.toHaveBeenCalled();
      // новый токен сохранён
      const stored = await store.get(account.login);
      expect(stored?.accessToken).toBe('AT-refreshed');
    });
  });

  it('нет токена вообще — device code flow', async () => {
    await withStore(async (store) => {
      const flow = mockDeviceFlow();
      const strat = new OAuth2MsalStrategy(cfg, store, flow);
      const opts = await strat.getImapAuth(account, connection);
      expect(opts.auth).toEqual({ user: account.login, accessToken: 'AT-device' });
      expect(flow.requestDeviceCode).toHaveBeenCalledTimes(1);
      expect(flow.pollForToken).toHaveBeenCalledTimes(1);
      const stored = await store.get(account.login);
      expect(stored?.refreshToken).toBe('RT-device');
    });
  });

  it('refresh отозван — fallback на device code flow', async () => {
    await withStore(async (store) => {
      await store.set(account.login, {
        accessToken: 'AT-old',
        refreshToken: 'RT-revoked',
        expiresAt: Date.now() - 1000,
      });
      const flow = mockDeviceFlow({
        refresh: vi.fn().mockRejectedValue(new Error('invalid_grant')),
      });
      const strat = new OAuth2MsalStrategy(cfg, store, flow);
      const opts = await strat.getImapAuth(account, connection);
      expect(opts.auth).toEqual({ user: account.login, accessToken: 'AT-device' });
      expect(flow.refresh).toHaveBeenCalled();
      expect(flow.requestDeviceCode).toHaveBeenCalledTimes(1);
    });
  });

  it('бросает, если clientId пуст', async () => {
    await withStore(async (store) => {
      const strat = new OAuth2MsalStrategy({ clientId: '', tenant: 'consumers' }, store, mockDeviceFlow());
      await expect(strat.getImapAuth(account, connection)).rejects.toThrow(/MS_CLIENT_ID/);
    });
  });
});

const smtpConnection: SmtpConnectionOptions = {
  host: 'smtp-mail.outlook.com',
  port: 587,
  secure: false,
};

describe('OAuth2MsalStrategy.getSmtpAuth', () => {
  it('валидный access token из store — без flow', async () => {
    await withStore(async (store) => {
      await store.set(account.login, {
        accessToken: 'AT-stored',
        refreshToken: 'RT-stored',
        expiresAt: Date.now() + 3_600_000,
      });
      const flow = mockDeviceFlow();
      const strat = new OAuth2MsalStrategy(cfg, store, flow);
      const auth = await strat.getSmtpAuth(account, smtpConnection);
      expect(auth).toEqual({ user: account.login, accessToken: 'AT-stored' });
      expect(flow.requestDeviceCode).not.toHaveBeenCalled();
      expect(flow.refresh).not.toHaveBeenCalled();
    });
  });

  it('истёкший access + валидный refresh — refresh flow, без device code', async () => {
    await withStore(async (store) => {
      await store.set(account.login, {
        accessToken: 'AT-old',
        refreshToken: 'RT-stored',
        expiresAt: Date.now() - 1000,
      });
      const flow = mockDeviceFlow({
        refresh: vi.fn().mockResolvedValue({ accessToken: 'AT-refreshed', refreshToken: 'RT-new', expiresInSeconds: 3600 }),
      });
      const strat = new OAuth2MsalStrategy(cfg, store, flow);
      const auth = await strat.getSmtpAuth(account, smtpConnection);
      expect(auth).toEqual({ user: account.login, accessToken: 'AT-refreshed' });
      expect(flow.refresh).toHaveBeenCalledWith('RT-stored');
      expect(flow.requestDeviceCode).not.toHaveBeenCalled();
    });
  });

  it('нет токена вообще — device code flow', async () => {
    await withStore(async (store) => {
      const flow = mockDeviceFlow();
      const strat = new OAuth2MsalStrategy(cfg, store, flow);
      const auth = await strat.getSmtpAuth(account, smtpConnection);
      expect(auth).toEqual({ user: account.login, accessToken: 'AT-device' });
      expect(flow.requestDeviceCode).toHaveBeenCalledTimes(1);
      expect(flow.pollForToken).toHaveBeenCalledTimes(1);
    });
  });

  it('бросает, если clientId пуст', async () => {
    await withStore(async (store) => {
      const strat = new OAuth2MsalStrategy({ clientId: '', tenant: 'consumers' }, store, mockDeviceFlow());
      await expect(strat.getSmtpAuth(account, smtpConnection)).rejects.toThrow(/MS_CLIENT_ID/);
    });
  });
});