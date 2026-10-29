import { describe, it, expect } from 'vitest';
import { BasicAuthStrategy } from '../src/tools/mail/providers/basic-auth.js';
import type { SmtpConnectionOptions } from '../src/tools/mail/mail-provider.js';
import type { MailAccount } from '../src/tools/mail/types.js';

const account: MailAccount = {
  provider: 'yandex',
  login: 'agentemailtest@yandex.com',
  password: 'app-pass',
  authStrategy: 'basic',
};

const smtpConnection: SmtpConnectionOptions = {
  host: 'smtp.yandex.ru',
  port: 465,
  secure: true,
};

describe('BasicAuthStrategy.getSmtpAuth', () => {
  it('возвращает {user, pass} из аккаунта', async () => {
    const s = new BasicAuthStrategy();
    const auth = await s.getSmtpAuth(account, smtpConnection);
    expect(auth).toEqual({ user: 'agentemailtest@yandex.com', pass: 'app-pass' });
  });

  it('kind === basic', () => {
    expect(new BasicAuthStrategy().kind).toBe('basic');
  });
});
