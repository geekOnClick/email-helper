import type { ToolDef } from '../registry.js';
import type { MailAccount, MailProviderKind } from './types.js';
import { createMailProvider, type CreateMailProviderOptions } from './providers/factory.js';
import { MailSessionStore } from './session-store.js';
import { ConnectError } from './providers/abstract-imap-provider.js';
import { AccountLookupError } from './account-lookup-error.js';
import { redact } from './redact.js';
import type { FetchLike } from './oauth/device-flow.js';
import type { AccountRegistry } from '../../config/account-registry.js';

export interface MailConnectArgs {
  login: string;
  /** Провайдер ящика (обязателен): пароль ищется сервером в .env по паре (provider, login). */
  provider: MailProviderKind;
}

export interface MailConnectDeps {
  /** In-memory реестр аккаунтов (источник правды вместо статичного массива из .env). */
  accountRegistry: AccountRegistry;
  oauth2?: CreateMailProviderOptions['oauth2'];
  tokenStorePath?: string;
  /** Инжектируется в тестах; по умолчанию общий singleton создаётся при инициализации. */
  sessionStore?: MailSessionStore;
}

/**
 * Тул mail.connect: подключение к ящику.
 *
 * По MCP передаются только `login` и `provider`; пароль извлекается сервером из
 * `AccountRegistry` (инициализированного из `ACCOUNTS` в `.env`) по паре
 * `(provider, login)`. Передача пароля по MCP исключена (change mcp-env-account-credentials).
 *
 * Ошибки поиска аккаунта (`account_not_found`/`provider_mismatch`) выбрасываются как
 * `AccountLookupError` → MCP-адаптер сериализует их в структурированный JSON.
 */
export function createMailConnectTool(deps: MailConnectDeps): ToolDef<MailConnectArgs> {
  return {
    name: 'mail.connect',
    description: 'Подключение к почтовому ящику по IMAP (Яндекс, Outlook). Пароль берётся из .env сервера по паре provider+login.',
    inputSchema: {
      type: 'object',
      properties: {
        login: { type: 'string', description: 'логин аккаунта' },
        provider: { type: 'string', enum: ['yandex', 'outlook'], description: 'провайдер ящика' },
      },
      required: ['login', 'provider'],
    },
    handler: async (args) => {
      const login = args.login;
      if (typeof login !== 'string' || login.length === 0) {
        throw new ConnectError('mail.connect: требуется параметр login');
      }
      const provider = args.provider;
      if (provider !== 'yandex' && provider !== 'outlook') {
        throw new ConnectError(
          `mail.connect: невалидный provider: ${String(provider)} (ожидается yandex|outlook)`,
        );
      }

      // Поиск аккаунта в реестре по паре (provider, login). Пароль не передаётся по MCP.
      const account = resolveAccount(provider, login);

      const mailProvider = createMailProvider(account, {
        oauth2: deps.oauth2,
        tokenStorePath: deps.tokenStorePath,
        fetchFn: globalThis.fetch as unknown as FetchLike,
      });

      try {
        const result = await mailProvider.connect();
        deps.sessionStore?.set(account, mailProvider);
        return result;
      } catch (err) {
        await mailProvider.dispose().catch(() => undefined);
        // Маскируем пароль и логин в сообщении об ошибке (как mail.send).
        const msg = err instanceof Error ? err.message : String(err);
        throw new ConnectError(redact(msg, account.password, account.login));
      }
    },
  };

  /**
   * Разрешает аккаунт по паре (provider, login) через реестр.
   * - точное совпадение → аккаунт;
   * - login есть с другим provider → AccountLookupError(provider_mismatch);
   * - login отсутствует → AccountLookupError(account_not_found).
   */
  function resolveAccount(provider: MailProviderKind, login: string): MailAccount {
    const exact = deps.accountRegistry.findByProviderLogin(provider, login);
    if (exact) return exact;

    const byLogin = deps.accountRegistry.findByLogin(login);
    if (byLogin) {
      // login существует, но с другим провайдером.
      throw new AccountLookupError('provider_mismatch', login, provider);
    }
    throw new AccountLookupError('account_not_found', login, provider);
  }
}
