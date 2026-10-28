import type { ImapFlowOptions } from 'imapflow';
import type { AuthStrategy } from '../mail-provider.js';
import type { ImapConnectionOptions, MailAccount } from '../types.js';
import type { OAuthTokenStore, StoredToken } from '../oauth/token-store.js';
import type { MSDeviceFlowClient } from '../oauth/device-flow.js';

/** Конфигурация OAuth2 для Microsoft identity (из ConfigSchema). */
export interface OAuth2Config {
  clientId: string;
  tenant: string;
}

/**
 * Стратегия OAuth2 (Microsoft identity platform v2.0, device code flow).
 * Возвращает auth { user, accessToken } для XOAUTH2 поверх imapflow.
 *
 * Логика получения access token:
 *  1. из token store, если валиден -> без flow
 *  2. иначе refresh token -> новый access token
 *  3. иначе device code flow (интерактивный, вывод user_code/verification_uri)
 */
export class OAuth2MsalStrategy implements AuthStrategy {
  readonly kind = 'oauth2' as const;

  constructor(
    private readonly cfg: OAuth2Config,
    private readonly tokenStore: OAuthTokenStore,
    private readonly deviceFlow: MSDeviceFlowClient,
  ) {}

  async getImapAuth(
    account: MailAccount,
    connection: ImapConnectionOptions,
  ): Promise<ImapFlowOptions> {
    if (!this.cfg.clientId) {
      throw new Error('OAuth2: MS_CLIENT_ID не задан (задача 5.6)');
    }

    const accessToken = await this.obtainAccessToken(account);
    return {
      host: connection.host,
      port: connection.port,
      secure: connection.secure,
      disableAutoIdle: connection.disableAutoIdle ?? false,
      logger: connection.logger ?? false,
      auth: { user: account.login, accessToken },
    };
  }

  private async obtainAccessToken(account: MailAccount): Promise<string> {
    const stored = await this.tokenStore.get(account.login);

    // 1. валидный access token из store
    if (stored && this.tokenStore.isAccessTokenValid(stored)) {
      return stored.accessToken;
    }

    // 2. refresh token
    if (stored?.refreshToken) {
      try {
        const tok = await this.deviceFlow.refresh(stored.refreshToken);
        await this.persist(account.login, tok.accessToken, tok.refreshToken, tok.expiresInSeconds);
        return tok.accessToken;
      } catch {
        // refresh не прошёл (отозван) -> device flow
      }
    }

    // 3. device code flow
    const dc = await this.deviceFlow.requestDeviceCode();
    const tok = await this.deviceFlow.pollForToken(dc.deviceCode, dc.intervalSeconds);
    await this.persist(account.login, tok.accessToken, tok.refreshToken, tok.expiresInSeconds);
    return tok.accessToken;
  }

  private async persist(
    login: string,
    accessToken: string,
    refreshToken: string,
    expiresInSeconds: number,
  ): Promise<void> {
    const stored: StoredToken = {
      accessToken,
      refreshToken,
      expiresAt: Date.now() + expiresInSeconds * 1000,
    };
    await this.tokenStore.set(login, stored);
  }
}