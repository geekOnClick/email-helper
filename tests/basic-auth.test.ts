import { describe, it, expect } from 'vitest';
import { BasicAuthStrategy } from '../src/tools/mail/providers/basic-auth.js';
import type { MailAccount, ImapConnectionOptions } from '../src/tools/mail/types.js';

const account: MailAccount = {
  provider: 'yandex',
  login: 'agentemailtest@yandex.com',
  password: 'app-pass',
  authStrategy: 'basic',
};

const connection: ImapConnectionOptions = {
  host: 'imap.yandex.ru',
  port: 993,
  secure: true,
  disableAutoIdle: true,
  logger: false,
};

describe('BasicAuthStrategy', () => {
  it('формирует {user, pass} из аккаунта', async () => {
    const s = new BasicAuthStrategy();
    const opts = await s.getImapAuth(account, connection);
    expect(opts.auth).toEqual({ user: 'agentemailtest@yandex.com', pass: 'app-pass' });
    expect(opts.host).toBe('imap.yandex.ru');
    expect(opts.port).toBe(993);
    expect(opts.secure).toBe(true);
  });

  it('kind === basic', () => {
    expect(new BasicAuthStrategy().kind).toBe('basic');
  });
});