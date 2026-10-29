/**
 * Клиент Microsoft device code flow (Microsoft identity platform v2.0).
 * Полная реализация (HTTP через передаваемый fetch) — задача 5.1.
 *
 * Endpoints:
 *  - devicecode: POST https://login.microsoftonline.com/{tenant}/oauth2/v2.0/devicecode
 *  - token:      POST https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token
 *
 * Scope для IMAP: offline_access https://outlook.office.com/IMAP.AccessAsUser.All
 */

export interface DeviceCodeResponse {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresInSeconds: number;
  intervalSeconds: number;
}

export interface DeviceTokenResponse {
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
}

/** Тип fetch-функции (инжектируется для мока в тестах). */
export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ status: number; json(): Promise<unknown>; text(): Promise<string> }>;

export interface MSDeviceFlowConfig {
  clientId: string;
  tenant: string;
  /** Scope. По умолчанию offline_access + IMAP. */
  scope?: string;
  /** Интерфейс вывода user_code/verification_uri пользователю (по умолчанию console.log). */
  prompt?: (msg: string) => void;
}

const DEFAULT_SCOPE =
  'offline_access https://outlook.office.com/IMAP.AccessAsUser.All https://outlook.office.com/SMTP.Send';

/** Ошибки device code flow. */
export class DeviceFlowError extends Error {
  constructor(
    message: string,
    readonly kind: 'expired' | 'denied' | 'pending' | 'http' | 'other',
  ) {
    super(message);
  }
}

function baseUrl(cfg: MSDeviceFlowConfig): string {
  const tenant = cfg.tenant || 'consumers';
  return `https://login.microsoftonline.com/${tenant}/oauth2/v2.0`;
}

function formEncode(params: Record<string, string>): string {
  return new URLSearchParams(params).toString();
}

function defaultPrompt(msg: string): void {
  console.log(msg);
}

export class MSDeviceFlowClient {
  private readonly scope: string;
  private readonly prompt: (msg: string) => void;

  constructor(
    private readonly cfg: MSDeviceFlowConfig,
    private readonly fetchFn: FetchLike,
  ) {
    this.scope = cfg.scope ?? DEFAULT_SCOPE;
    this.prompt = cfg.prompt ?? defaultPrompt;
  }

  /** Обновление access token через refresh token (grant_type=refresh_token). */
  async refresh(refreshToken: string): Promise<DeviceTokenResponse> {
 const res = await this.fetchFn(`${baseUrl(this.cfg)}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formEncode({
        grant_type: 'refresh_token',
        client_id: this.cfg.clientId,
        refresh_token: refreshToken,
        scope: this.scope,
      }),
    });
    const data = (await safeJson(res)) as Record<string, unknown>;
    if (res.status >= 400 || data.error) {
      throw new DeviceFlowError(
        `refresh HTTP ${res.status}: ${str(data.error) || 'unknown'}`,
        'http',
      );
    }
    return {
      accessToken: str(data.access_token),
      refreshToken: str(data.refresh_token) || refreshToken,
      expiresInSeconds: num(data.expires_in),
    };
  }

  /** Запрашивает device code и сообщает пользователю URL + user code. */
  async requestDeviceCode(): Promise<DeviceCodeResponse> {
    const res = await this.fetchFn(`${baseUrl(this.cfg)}/devicecode`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formEncode({
        client_id: this.cfg.clientId,
        scope: this.scope,
      }),
    });

    const data = (await safeJson(res)) as Record<string, unknown>;
    if (res.status >= 400) {
      throw new DeviceFlowError(
        `devicecode HTTP ${res.status}: ${data.error ?? data.error_description ?? 'unknown'}`,
        'http',
      );
    }

    const verification = str(data.verification_uri ?? data.verification_url);
    const userCode = str(data.user_code);
    if (!verification || !userCode) {
      throw new DeviceFlowError('некорректный ответ devicecode', 'other');
    }

    this.prompt(
      `OAuth2 device code flow: откройте ${verification} и введите код: ${userCode}`,
    );

    return {
      deviceCode: str(data.device_code),
      userCode,
      verificationUri: verification,
      expiresInSeconds: num(data.expires_in),
      intervalSeconds: num(data.interval) || 5,
    };
  }

  /**
   * Опрашивает /token, пока не получен токен или истёк/отменён device code.
   * Бросает DeviceFlowError при expired/denied/http.
   */
  async pollForToken(deviceCode: string, intervalSeconds = 5): Promise<DeviceTokenResponse> {
    const interval = Math.max(intervalSeconds, 2);
    // верхний предел поллинга — 15 минут (device code обычно живёт ~15 мин)
    const deadline = Date.now() + 15 * 60 * 1000;

    for (;;) {
      if (Date.now() > deadline) {
        throw new DeviceFlowError('истёк срок ожидания завершения авторизации', 'expired');
      }

      const res = await this.fetchFn(`${baseUrl(this.cfg)}/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: formEncode({
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
          client_id: this.cfg.clientId,
          device_code: deviceCode,
        }),
      });

      const data = (await safeJson(res)) as Record<string, unknown>;
      const error = str(data.error);

      if (error === 'authorization_pending') {
        await delay(interval * 1000);
        continue;
      }
      if (error === 'slow_down') {
        await delay((interval + 5) * 1000);
        continue;
      }
      if (error === 'expired_token') {
        throw new DeviceFlowError('истёк срок действия device code', 'expired');
      }
      if (error === 'authorization_declined') {
        throw new DeviceFlowError('пользователь отменил авторизацию', 'denied');
      }
      if (res.status >= 400 || error) {
        throw new DeviceFlowError(
          `token HTTP ${res.status}: ${error || 'unknown'}`,
          'http',
        );
      }

      return {
        accessToken: str(data.access_token),
        refreshToken: str(data.refresh_token),
        expiresInSeconds: num(data.expires_in),
      };
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function safeJson(res: { json(): Promise<unknown>; text(): Promise<string> }): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return {};
  }
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}