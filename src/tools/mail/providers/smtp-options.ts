import type { SmtpConnectionOptions } from '../mail-provider.js';
import type { MailProviderKind } from '../types.js';

/** SMTP-параметры Яндекс: smtp.yandex.ru:465, неявный TLS. */
export const YANDEX_SMTP: SmtpConnectionOptions = {
  host: 'smtp.yandex.ru',
  port: 465,
  secure: true,
};

/** SMTP-параметры Outlook (личные @outlook.com, tenant consumers): STARTTLS на 587. */
export const OUTLOOK_SMTP: SmtpConnectionOptions = {
  host: 'smtp-mail.outlook.com',
  port: 587,
  secure: false,
};

/** SMTP-параметры Mail.ru Group: smtp.mail.ru:465, неявный TLS. */
export const MAIL_RU_SMTP: SmtpConnectionOptions = {
  host: 'smtp.mail.ru',
  port: 465,
  secure: true,
};

/**
 * Возвращает параметры SMTP-соединения по типу провайдера.
 * Яндекс — smtp.yandex.ru:465 (TLS); Outlook — smtp-mail.outlook.com:587 (STARTTLS);
 * Mail.ru — smtp.mail.ru:465 (TLS).
 */
export function smtpConnectionFor(kind: MailProviderKind): SmtpConnectionOptions {
  switch (kind) {
    case 'yandex':
      return YANDEX_SMTP;
    case 'outlook':
      return OUTLOOK_SMTP;
    case 'mail':
      return MAIL_RU_SMTP;
    default: {
      const _exhaustive: never = kind;
      throw new Error(`неизвестный провайдер: ${String(_exhaustive)}`);
    }
  }
}
