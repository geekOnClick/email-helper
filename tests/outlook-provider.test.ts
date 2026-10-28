import { describe, it, expect, vi } from 'vitest';
import { OutlookMailProvider } from '../src/tools/mail/providers/outlook.js';
import type { ImapClientFactory } from '../src/tools/mail/providers/abstract-imap-provider.js';
import type { AuthStrategy } from '../src/tools/mail/providers/abstract-imap-provider.js';
import type { MailAccount } from '../src/tools/mail/types.js';

const account: MailAccount = {
  provider: 'outlook',
  login: 'alcauselove@outlook.com',
  password: 'super-secret',
  authStrategy: 'basic',
};

class FakeStrategy implements AuthStrategy {
  constructor(
    readonly kind: 'basic' | 'oauth2',
    private opts: { user: string; accessToken?: string; pass?: string },
  ) {}
  getImapAuth(): Promise<import('imapflow').ImapFlowOptions> {
    const auth: { user: string; pass?: string; accessToken?: string } = {
      user: this.opts.user,
    };
    if (this.opts.accessToken) auth.accessToken = this.opts.accessToken;
    if (this.opts.pass) auth.pass = this.opts.pass;
    return Promise.resolve({
      host: 'outlook.office365.com',
      port: 993,
      secure: true,
      auth,
    });
  }
}

function makeFactory(opts: { connect: () => Promise<void> }): ImapClientFactory {
  return () => ({
    connect: opts.connect,
    list: vi.fn().mockResolvedValue([
      {
        path: 'INBOX',
        name: 'Inbox',
        delimiter: '/',
        flags: new Set(['\\Inbox']),
        specialUse: '\\Inbox',
        pathAsListed: 'INBOX',
        parent: '',
        parentPath: '',
        listed: true,
        subscribed: true,
      },
    ]),
    logout: vi.fn().mockResolvedValue(undefined),
  });
}

describe('OutlookMailProvider auto-detection (задача 5.4)', () => {
  it('basic-успех — без фолбэка', async () => {
    const factory = makeFactory({ connect: vi.fn().mockResolvedValue(undefined) });
    const basic = new FakeStrategy('basic', { user: account.login, pass: account.password });
    const p = new OutlookMailProvider({ account, strategy: basic, clientFactory: factory });
    const res = await p.connect();
    expect(res.connected).toBe(true);
    expect(res.provider).toBe('outlook');
    expect(p.getActiveStrategy?.() ?? basic.kind).toBe('basic');
  });

  it('basic-отказ auth → переключение на oauth2 fallback', async () => {
    let calls = 0;
    const factory = makeFactory({
      connect: vi.fn().mockImplementation(() => {
        calls += 1;
        if (calls === 1) {
          return Promise.reject(new Error('AUTHENTICATIONFAILED: invalid credentials'));
        }
        return Promise.resolve(undefined);
      }),
    });
    const basic = new FakeStrategy('basic', { user: account.login, pass: account.password });
    const oauth2 = new FakeStrategy('oauth2', { user: account.login, accessToken: 'AT-x' });
    const p = new OutlookMailProvider({
      account,
      strategy: basic,
      fallbackStrategy: oauth2,
      clientFactory: factory,
    });
    const res = await p.connect();
    expect(res.connected).toBe(true);
    expect(calls).toBe(2); // первый basic отказ, второй oauth2 успех
  });

  it('прямая oauth2 стратегия — без фолбэка и без повторов', async () => {
    const factory = makeFactory({ connect: vi.fn().mockResolvedValue(undefined) });
    const oauth2 = new FakeStrategy('oauth2', { user: account.login, accessToken: 'AT' });
    const p = new OutlookMailProvider({ account, strategy: oauth2, clientFactory: factory });
    const res = await p.connect();
    expect(res.connected).toBe(true);
  });

  it('basic-отказ без fallback — пробрасывает ошибку', async () => {
    const factory = makeFactory({
      connect: vi.fn().mockRejectedValue(new Error('AUTHENTICATIONFAILED: invalid')),
    });
    const basic = new FakeStrategy('basic', { user: account.login, pass: account.password });
    const p = new OutlookMailProvider({ account, strategy: basic, clientFactory: factory });
    await expect(p.connect()).rejects.toThrow(/AUTHENTICATIONFAILED/);
  });
});