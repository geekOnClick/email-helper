import type { ImapFlowOptions } from 'imapflow';
import type { AuthStrategy } from '../mail-provider.js';
import type { ImapConnectionOptions, MailAccount } from '../types.js';

/**
 * Стратегия basic-аутентификации: логин + пароль приложения.
 * Подходит для Яндекс (пароль приложения) и для Outlook при работающем basic-auth.
 */
export class BasicAuthStrategy implements AuthStrategy {
  readonly kind = 'basic' as const;

  getImapAuth(account: MailAccount, connection: ImapConnectionOptions): Promise<ImapFlowOptions> {
    const opts: ImapFlowOptions = {
      host: connection.host,
      port: connection.port,
      secure: connection.secure,
      disableAutoIdle: connection.disableAutoIdle ?? false,
      logger: connection.logger ?? false,
      auth: { user: account.login, pass: account.password },
    };
    return Promise.resolve(opts);
  }
}