/**
 * Тулы работы с почтой: connect, search, fetch, attachments, send.
 * Публичный API модуля (Phase 1: mail.connect, mail.listFolders).
 */
export type { MailProvider, AuthStrategy } from './mail-provider.js';
export type {
  Folder,
  ConnectionResult,
  MailAccount,
  AuthStrategyKind,
  MailProviderKind,
} from './types.js';
export { createMailProvider } from './providers/factory.js';
export { YandexMailProvider, YANDEX_IMAP_HOST, YANDEX_IMAP_PORT } from './providers/yandex.js';
export {
  OutlookMailProvider,
  OUTLOOK_IMAP_HOST,
  OUTLOOK_IMAP_PORT,
} from './providers/outlook.js';
export { probeOutlookBasicAuth } from './providers/outlook-probe.js';
export { redact } from './redact.js';
export { SmtpClient, createDefaultTransport } from './smtp-client.js';
export type { SmtpTransport, SmtpTransportFactory, SmtpSendMailOptions, SmtpSendResult } from './smtp-client.js';
export { smtpConnectionFor, YANDEX_SMTP, OUTLOOK_SMTP } from './providers/smtp-options.js';
export type { SmtpAuth, SmtpConnectionOptions } from './mail-provider.js';