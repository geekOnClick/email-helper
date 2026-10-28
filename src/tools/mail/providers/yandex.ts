import { BasicAuthStrategy } from './basic-auth.js';
import { AbstractImapProvider } from './abstract-imap-provider.js';
import type { ImapConnectionOptions, MailAccount, MailProviderKind } from '../types.js';

export const YANDEX_IMAP_HOST = 'imap.yandex.ru';
export const YANDEX_IMAP_PORT = 993;

/**
 * Провайдер Яндекс Почты: imap.yandex.ru:993, TLS, basic-auth (пароль приложения).
 */
export class YandexMailProvider extends AbstractImapProvider {
  constructor(opts: { account: MailAccount; clientFactory?: AbstractImapProvider['clientFactory'] }) {
    super({
      account: opts.account,
      strategy: new BasicAuthStrategy(),
      clientFactory: opts.clientFactory,
    });
  }

  get providerKind(): MailProviderKind {
    return 'yandex';
  }

  protected get connection(): ImapConnectionOptions {
    return {
      host: YANDEX_IMAP_HOST,
      port: YANDEX_IMAP_PORT,
      secure: true,
      disableAutoIdle: true,
      logger: false,
    };
  }
}