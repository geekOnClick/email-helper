import { describe, it, expect } from 'vitest';
import { MailRuMailProvider, MAIL_RU_IMAP_HOST, MAIL_RU_IMAP_PORT } from '../src/tools/mail/providers/mail-ru.js';
import type { MailAccount } from '../src/tools/mail/types.js';

const account: MailAccount = {
  provider: 'mail',
  login: 'alexandr1508@mail.ru',
  password: 'super-secret',
  authStrategy: 'basic',
};

describe('MailRuMailProvider', () => {
  it('providerKind возвращает "mail"', () => {
    const p = new MailRuMailProvider({ account });
    expect(p.providerKind).toBe('mail');
  });

  it('IMAP-параметры: host=imap.mail.ru, port=993, secure=true', () => {
    const p = new MailRuMailProvider({ account });
    // connection — protected getter; доступ через приведение типа в тесте.
    const conn = (p as unknown as { connection: { host: string; port: number; secure: boolean; disableAutoIdle?: boolean; logger?: false } }).connection;
    expect(conn.host).toBe(MAIL_RU_IMAP_HOST);
    expect(conn.host).toBe('imap.mail.ru');
    expect(conn.port).toBe(MAIL_RU_IMAP_PORT);
    expect(conn.port).toBe(993);
    expect(conn.secure).toBe(true);
    expect(conn.disableAutoIdle).toBe(true);
    expect(conn.logger).toBe(false);
  });

  it('использует BasicAuthStrategy (как Яндекс — без OAuth2)', () => {
    // Стратегия инжектируется в конструкторе; проверяем через доступ к приватному полю.
    const p = new MailRuMailProvider({ account });
    const strategy = (p as unknown as { strategy: { constructor: { name: string } } }).strategy;
    expect(strategy.constructor.name).toBe('BasicAuthStrategy');
  });

  it('константы IMAP-хоста/порта корректны', () => {
    expect(MAIL_RU_IMAP_HOST).toBe('imap.mail.ru');
    expect(MAIL_RU_IMAP_PORT).toBe(993);
  });
});
