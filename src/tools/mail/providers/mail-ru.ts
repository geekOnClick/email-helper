import { BasicAuthStrategy } from './basic-auth.js';
import { AbstractImapProvider } from './abstract-imap-provider.js';
import type { ImapConnectionOptions, MailAccount, MailProviderKind } from '../types.js';

export const MAIL_RU_IMAP_HOST = 'imap.mail.ru';
export const MAIL_RU_IMAP_PORT = 993;

/**
 * Провайдер Mail.ru Group (@mail.ru/@inbox.ru/@list.ru/@bk.ru):
 * imap.mail.ru:993, TLS, basic-auth (пароль приложения).
 */
export class MailRuMailProvider extends AbstractImapProvider {
  constructor(opts: { account: MailAccount; clientFactory?: AbstractImapProvider['clientFactory'] }) {
    super({
      account: opts.account,
      strategy: new BasicAuthStrategy(),
      clientFactory: opts.clientFactory,
    });
  }

  get providerKind(): MailProviderKind {
    return 'mail';
  }

  protected get connection(): ImapConnectionOptions {
    return {
      host: MAIL_RU_IMAP_HOST,
      port: MAIL_RU_IMAP_PORT,
      secure: true,
      disableAutoIdle: true,
      logger: false,
    };
  }
}
