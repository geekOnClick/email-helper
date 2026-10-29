import type { MailProvider, AuthStrategy } from '../mail-provider.js';
import type { ImapClientFactory } from './abstract-imap-provider.js';
import type { MailAccount } from '../types.js';
import { BasicAuthStrategy } from './basic-auth.js';
import { YandexMailProvider } from './yandex.js';
import { OutlookMailProvider, makeOAuth2Strategy } from './outlook.js';
import { OAuth2MsalStrategy, type OAuth2Config } from './oauth2-msal.js';
import { OAuthTokenStore } from '../oauth/token-store.js';
import { MSDeviceFlowClient, type FetchLike } from '../oauth/device-flow.js';

export interface CreateMailProviderOptions {
  /** Конфиг oauth2 (MS_CLIENT_ID, MS_TENANT) — нужно для outlook+oauth2 и fallback. */
  oauth2?: OAuth2Config;
  /** Путь к token store (OAUTH_TOKEN_STORE_PATH). */
  tokenStorePath?: string;
  /** Инжектируемый fetch для device-flow (тесты). По умолчанию глобальный. */
  fetchFn?: FetchLike;
  /** Промпт для device-flow (по умолчанию console.log). */
  prompt?: (msg: string) => void;
  /** Инжектируемая фабрика IMAP-клиента (тесты). */
  clientFactory?: ImapClientFactory;
}

/**
 * Фабрика MailProvider по провайдеру + authStrategy аккаунта.
 * Реализует решения D2/D3/D8 из design.md.
 */
export function createMailProvider(
  account: MailAccount,
  opts: CreateMailProviderOptions = {},
): MailProvider {
  if (account.provider === 'yandex') {
    return new YandexMailProvider({ account, clientFactory: opts.clientFactory });
  }

  if (account.provider === 'outlook') {
    const oauth2Strategy = buildOAuth2Strategy(opts);

    if (account.authStrategy === 'oauth2') {
      return new OutlookMailProvider({
        account,
        strategy: oauth2Strategy,
        clientFactory: opts.clientFactory,
      });
    }

    // basic + fallback на oauth2 при отказе basic-auth
    return new OutlookMailProvider({
      account,
      strategy: new BasicAuthStrategy(),
      fallbackStrategy: oauth2Strategy,
      clientFactory: opts.clientFactory,
    });
  }

  throw new Error(`неизвестный провайдер: ${(account as { provider?: string }).provider ?? '?'}`);
}

function buildOAuth2Strategy(opts: CreateMailProviderOptions): OAuth2MsalStrategy {
  const cfg = opts.oauth2 ?? { clientId: '', tenant: 'consumers' };
  const store = new OAuthTokenStore(opts.tokenStorePath ?? './.tokens/oauth.json');
  const flow = new MSDeviceFlowClient(
    { clientId: cfg.clientId, tenant: cfg.tenant, prompt: opts.prompt },
    opts.fetchFn ?? (globalThis.fetch as unknown as FetchLike),
  );
  return makeOAuth2Strategy(cfg, store, flow);
}

/**
 * Строит AuthStrategy по аккаунту (без провайдера/IMAP-сессии) — для SMTP-клиента.
 * Яндекс → BasicAuthStrategy; Outlook → по account.authStrategy (oauth2 | basic).
 * Auto-detect (fallback basic→oauth2) здесь не применяется: для SMTP берётся
 * основная стратегия аккаунта, та же, что выбрана для IMAP (спека mail/send).
 */
export function createAuthStrategyForAccount(
  account: MailAccount,
  opts: CreateMailProviderOptions = {},
): AuthStrategy {
  if (account.provider === 'yandex') {
    return new BasicAuthStrategy();
  }
  if (account.provider === 'outlook') {
    return account.authStrategy === 'oauth2' ? buildOAuth2Strategy(opts) : new BasicAuthStrategy();
  }
  throw new Error(`неизвестный провайдер: ${(account as { provider?: string }).provider ?? '?'}`);
}

export type { AuthStrategy };