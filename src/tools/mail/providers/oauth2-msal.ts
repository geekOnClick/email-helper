import type { ImapFlowOptions } from 'imapflow';
import type { AuthStrategy, SmtpAuth, SmtpConnectionOptions } from '../mail-provider.js';
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

  async getSmtpAuth(
    account: MailAccount,
    _connection: SmtpConnectionOptions,
  ): Promise<SmtpAuth> {
    if (!this.cfg.clientId) {
      throw new Error('OAuth2: MS_CLIENT_ID не задан (задача 5.6)');
    }
    const accessToken = await this.obtainAccessToken(account);
    return { user: account.login, accessToken };
  }

  /**
   * Access token для Microsoft Graph API (https://graph.microsoft.com/Mail.Send).
   * Запрашивает ОТДЕЛЬНЫЙ токен со scope Graph — IMAP/SMTP-токен не подходит
   * (другой audience), а смешивать scope Graph с outlook.office.com в одном
   * запросе нельзя (400 invalid scope). Поэтому:
   *   1. refresh с чистым Graph scope (`offline_access Mail.Send`);
   *   2. при неудаче (нет consent / отозван refresh) — отдельный device code
   *      flow с Graph scope для получения consent и нового refresh-токена.
   * Возвращает access token для Graph или undefined при невозможности.
   */
  async getGraphAccessToken(account: MailAccount): Promise<string | undefined> {
    if (!this.cfg.clientId) return undefined;
    const GRAPH_SCOPE = 'offline_access https://graph.microsoft.com/Mail.Send';
    const stored = await this.tokenStore.get(account.login);

    // 1. refresh с Graph scope (если есть сохранённый refresh token)
    if (stored?.refreshToken) {
      try {
        const tok = await this.deviceFlow.refreshWithScope(
          stored.refreshToken,
          GRAPH_SCOPE,
        );
        await this.persistRefreshed(account.login, tok.refreshToken);
        return tok.accessToken;
      } catch {
        // refresh не прошёл (нет consent на Mail.Send / отозван) → device flow ниже
      }
    }

    // 2. device code flow с Graph scope для получения consent на Mail.Send
    try {
      const dc = await this.deviceFlow.requestDeviceCodeWithScope(GRAPH_SCOPE);
      const tok = await this.deviceFlow.pollForToken(dc.deviceCode, dc.intervalSeconds);
      // сохраняем refresh token (consent на Graph получен, IMAP-токен не трогаем)
      await this.persistRefreshed(account.login, tok.refreshToken);
      return tok.accessToken;
    } catch {
      return undefined;
    }
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

  /** Обновляет только refreshToken в store (для Graph-токенов, чей access не кэшируем). */
  private async persistRefreshed(login: string, refreshToken: string): Promise<void> {
    const stored = await this.tokenStore.get(login);
    if (stored) {
      await this.tokenStore.set(login, { ...stored, refreshToken });
    }
  }
}