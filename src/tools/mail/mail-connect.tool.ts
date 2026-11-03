import type { ToolDef } from '../registry.js';
import type { MailAccount, MailProviderKind, AuthStrategyKind } from './types.js';
import { createMailProvider, type CreateMailProviderOptions } from './providers/factory.js';
import { MailSessionStore } from './session-store.js';
import { ConnectError } from './providers/abstract-imap-provider.js';
import { redact } from './redact.js';
import type { FetchLike } from './oauth/device-flow.js';

/** Динамические учётные данные, переданные вызывающим агентом (MCP-клиентом). */
export interface MailConnectCredentials {
  provider: MailProviderKind;
  password: string;
  authStrategy?: AuthStrategyKind;
}

export interface MailConnectArgs {
  login: string;
  /** Опц. блок кред: если передан — создаётся временный аккаунт вместо поиска в .env. */
  credentials?: MailConnectCredentials;
}

export interface MailConnectDeps {
  accounts: MailAccount[];
  oauth2?: CreateMailProviderOptions['oauth2'];
  tokenStorePath?: string;
  /** Инжектируется в тестах; по умолчанию общий singleton создаётся при инициализации. */
  sessionStore?: MailSessionStore;
}

/**
 * Тул mail.connect: подключение к ящику.
 * Вход: login. Выбирает провайдер+стратегию через factory, открывает IMAP-сессию.
 */
export function createMailConnectTool(deps: MailConnectDeps): ToolDef<MailConnectArgs> {
  return {
    name: 'mail.connect',
    description: 'Подключение к почтовому ящику по IMAP (Яндекс, Outlook).',
    inputSchema: {
      type: 'object',
      properties: {
        login: { type: 'string', description: 'логин аккаунта' },
        credentials: {
          type: 'object',
          description:
            'опц. динамические учётные данные (вместо .env): provider, password, authStrategy',
          properties: {
            provider: { type: 'string', enum: ['yandex', 'outlook'] },
            password: { type: 'string' },
            authStrategy: { type: 'string', enum: ['basic', 'oauth2'] },
          },
        },
      },
      required: ['login'],
    },
    handler: async (args) => {
      const login = args.login;
      if (typeof login !== 'string') {
        throw new ConnectError('mail.connect: требуется параметр login');
      }

      // Определение аккаунта: динамические креды (приоритет) или fallback на .env.
      const account = resolveAccount(args.credentials, login);

      const provider = createMailProvider(account, {
        oauth2: deps.oauth2,
        tokenStorePath: deps.tokenStorePath,
        fetchFn: globalThis.fetch as unknown as FetchLike,
      });

      try {
        const result = await provider.connect();
        deps.sessionStore?.set(account, provider);
        return result;
      } catch (err) {
        await provider.dispose().catch(() => undefined);
        // Маскируем пароль и логин в сообщении об ошибке (как mail.send).
        const msg = err instanceof Error ? err.message : String(err);
        throw new ConnectError(redact(msg, account.password, account.login));
      }
    },
  };

  /**
   * Определяет аккаунт для подключения.
   * Если переданы credentials — строит временный MailAccount из них (динамический).
   * Иначе ищет аккаунт в .env (deps.accounts) по login.
   */
  function resolveAccount(
    credentials: MailConnectCredentials | undefined,
    login: string,
  ): MailAccount {
    if (credentials) {
      return buildDynamicAccount(credentials, login);
    }
    return findEnvAccount(login);
  }

  /** Строит временный MailAccount из динамических кред с валидацией полей. */
  function buildDynamicAccount(
    credentials: MailConnectCredentials,
    login: string,
  ): MailAccount {
    const { provider, password, authStrategy } = credentials;
    if (provider !== 'yandex' && provider !== 'outlook') {
      throw new ConnectError(
        `mail.connect: невалидный credentials.provider: ${String(provider)} (ожидается yandex|outlook)`,
      );
    }
    if (typeof password !== 'string' || password.length === 0) {
      throw new ConnectError('mail.connect: credentials.password обязателен и не пуст');
    }
    const strategy: AuthStrategyKind = authStrategy ?? 'basic';
    if (strategy !== 'basic' && strategy !== 'oauth2') {
      throw new ConnectError(
        `mail.connect: невалидный credentials.authStrategy: ${String(strategy)} (ожидается basic|oauth2)`,
      );
    }
    return { provider, login, password, authStrategy: strategy };
  }

  /** Поиск аккаунта в .env (deps.accounts) по login. */
  function findEnvAccount(login: string): MailAccount {
    const account = deps.accounts.find((a) => a.login === login);
    if (!account) {
      throw new ConnectError(`mail.connect: аккаунт не найден: ${login}`);
    }
    return account;
  }
}