import { AbstractImapProvider } from './abstract-imap-provider.js';
import { OAuth2MsalStrategy, type OAuth2Config } from './oauth2-msal.js';
import type { AuthStrategy } from '../mail-provider.js';
import type { ConnectionResult, ImapConnectionOptions, MailAccount, MailProviderKind } from '../types.js';
import type { ImapClientFactory } from './abstract-imap-provider.js';
import type { OAuthTokenStore } from '../oauth/token-store.js';
import type { MSDeviceFlowClient } from '../oauth/device-flow.js';

export const OUTLOOK_IMAP_HOST = 'outlook.office365.com';
export const OUTLOOK_IMAP_PORT = 993;

/**
 * Провайдер Outlook.com: outlook.office365.com:993, TLS.
 * Стратегия определяется по account.authStrategy (basic | oauth2).
 * Автоопределение: при basic и отказе аутентификации — фоллбэк к oauth2 (задача 5.4).
 */
export class OutlookMailProvider extends AbstractImapProvider {
  private readonly fallbackStrategy: AuthStrategy | null;

  constructor(opts: {
    account: MailAccount;
    strategy: AuthStrategy;
    fallbackStrategy?: AuthStrategy;
    clientFactory?: ImapClientFactory;
  }) {
    super({
      account: opts.account,
      strategy: opts.strategy,
      clientFactory: opts.clientFactory,
    });
    this.fallbackStrategy = opts.fallbackStrategy ?? null;
  }

  get providerKind(): MailProviderKind {
    return 'outlook';
  }

  protected get connection(): ImapConnectionOptions {
    return {
      host: OUTLOOK_IMAP_HOST,
      port: OUTLOOK_IMAP_PORT,
      secure: true,
      disableAutoIdle: true,
      logger: false,
    };
  }

  /** Стратегия для фолбэка при отказе basic (auto-detection). null если фоллбэка нет. */
  getFallbackStrategy(): AuthStrategy | null {
    return this.fallbackStrategy;
  }

  /**
   * Автоопределение стратегии (спека «Автоопределение стратегии для Outlook»):
   * если основная стратегия basic и сервер отклонил auth — повтор через fallback (oauth2).
   */
  override async connect(): Promise<ConnectionResult> {
    if (this.client) {
      return { connected: true, accountId: this.accountId(), provider: this.providerKind };
    }
    try {
      return await super.connect();
    } catch (err) {
      if (
        this.fallbackStrategy &&
        this.strategy.kind === 'basic' &&
        this.isAuthFailure(err)
      ) {
        this.strategy = this.fallbackStrategy;
        return await this.tryConnect(this.fallbackStrategy);
      }
      throw err;
    }
  }
}

/** Хелпер: строит OAuth2-стратегию из зависимостей. */
export function makeOAuth2Strategy(
  cfg: OAuth2Config,
  tokenStore: OAuthTokenStore,
  deviceFlow: MSDeviceFlowClient,
): OAuth2MsalStrategy {
  return new OAuth2MsalStrategy(cfg, tokenStore, deviceFlow);
}