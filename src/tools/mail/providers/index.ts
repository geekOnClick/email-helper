/**
 * Реализации почтовых провайдеров: Yandex, Outlook.
 */
export type { MailProvider, AuthStrategy, SmtpAuth, SmtpConnectionOptions } from '../mail-provider.js';
export { createMailProvider } from './factory.js';
export { YandexMailProvider } from './yandex.js';
export { OutlookMailProvider } from './outlook.js';
export { smtpConnectionFor, YANDEX_SMTP, OUTLOOK_SMTP } from './smtp-options.js';