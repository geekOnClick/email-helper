import { describe, it, expect } from 'vitest';
import { smtpConnectionFor, YANDEX_SMTP, OUTLOOK_SMTP } from '../src/tools/mail/providers/smtp-options.js';

describe('smtpConnectionFor', () => {
  it('яндекс → smtp.yandex.ru:465, secure (TLS)', () => {
    expect(smtpConnectionFor('yandex')).toEqual({
      host: 'smtp.yandex.ru',
      port: 465,
      secure: true,
    });
    expect(YANDEX_SMTP).toEqual(smtpConnectionFor('yandex'));
  });

  it('outlook → smtp-mail.outlook.com:587, не secure (STARTTLS)', () => {
    expect(smtpConnectionFor('outlook')).toEqual({
      host: 'smtp-mail.outlook.com',
      port: 587,
      secure: false,
    });
    expect(OUTLOOK_SMTP).toEqual(smtpConnectionFor('outlook'));
  });

  it('бросает на неизвестном провайдере', () => {
    expect(() => smtpConnectionFor('unknown' as never)).toThrow(/неизвестный провайдер/);
  });
});
