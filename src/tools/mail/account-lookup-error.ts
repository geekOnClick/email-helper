/**
 * Ошибка поиска аккаунта в реестре (change mcp-env-account-credentials).
 *
 * Выбрасывается тулом `mail.connect`, когда по переданной паре `(provider, login)`
 * аккаунт не найден в `ACCOUNTS` (`.env`). Два кода:
 * - `account_not_found` — логин отсутствует в реестре вообще;
 * - `provider_mismatch` — логин есть, но с другим провайдером.
 *
 * MCP-адаптер (`toMcpError`) детектит `AccountLookupError` и сериализует его в
 * `content[].text` как JSON через `toMcpJson()` — машиночитаемая причина для
 * вызывающего агента. Пароль в ошибке не фигурирует.
 */
import type { MailProviderKind } from './types.js';

/** Код ошибки поиска аккаунта. */
export type AccountLookupErrorCode = 'account_not_found' | 'provider_mismatch';

/** JSON-объект, возвращаемый в MCP text-блоке. */
export interface AccountLookupMcpJson {
  /** Код ошибки. */
  error: AccountLookupErrorCode;
  /** Человекочитаемое описание причины. */
  message: string;
  /** Переданный логин. */
  login: string;
  /** Переданный провайдер. */
  provider: MailProviderKind;
  /** Подсказка по устранению (заведение через CLI /add-account). */
  hint: string;
}

/** Подсказка для ошибки отсутствия аккаунта. */
const HINT_NOT_FOUND =
  'Заведите аккаунт через CLI: /add-account (provider, login, password, authStrategy), затем вызовите mail.connect с provider+login';

/** Подсказка для ошибки несовпадения провайдера. */
const HINT_MISMATCH =
  'Переданный provider не совпадает с заведённым для этого login. Проверьте provider или заведите аккаунт через CLI: /add-account';

/**
 * Доменная ошибка поиска аккаунта. Расширяет Error, чтобы проходить через
 * существующий канал ошибок тулов (handler throw → toMcpError).
 */
export class AccountLookupError extends Error {
  readonly code: AccountLookupErrorCode;
  readonly login: string;
  readonly provider: MailProviderKind;

  constructor(code: AccountLookupErrorCode, login: string, provider: MailProviderKind) {
    const message =
      code === 'account_not_found'
        ? `Аккаунт не найден в .env: provider=${provider}, login=${login}`
        : `Провайдер не соответствует заведённому аккаунту: запрошен provider=${provider} для login=${login}`;
    super(message);
    this.name = 'AccountLookupError';
    this.code = code;
    this.login = login;
    this.provider = provider;
  }

  /**
   * JSON-представление для MCP text-блока. Содержит `error`, `message`, `login`,
   * `provider`, `hint` и НЕ содержит пароля.
   */
  toMcpJson(): AccountLookupMcpJson {
    return {
      error: this.code,
      message: this.message,
      login: this.login,
      provider: this.provider,
      hint: this.code === 'account_not_found' ? HINT_NOT_FOUND : HINT_MISMATCH,
    };
  }
}
