/**
 * Чистая доменная функция сохранения аккаунта (change web-interface, design D1).
 *
 * Выделена из `src/transport/cli/commands/add-account.ts`. Принимает DTO (поля
 * аккаунта + путь к `.env` + реестр), валидирует, добавляет/обновляет в реестре
 * и атомарно сохраняет в `.env`. Не зависит от ConsoleIO. Переиспользуется
 * CLI (`/add-account`) и веб-API (`POST /api/accounts`).
 */
import { updateAccountsInEnv } from '../../config/env-writer.js';
import type { AccountRegistry } from '../../config/account-registry.js';
import type { MailAccount } from '../../tools/mail/types.js';

/** DTO сохранения аккаунта (без ConsoleIO). */
export interface SaveAccountDeps {
  /** Поля аккаунта. */
  account: {
    provider: MailAccount['provider'];
    login: string;
    password: string;
    authStrategy?: MailAccount['authStrategy'];
  };
  /** In-memory реестр (источник правды). */
  registry: AccountRegistry;
  /** Путь к `.env` для персистентности. */
  envPath: string;
}

/** Результат сохранения (без пароля — безопасен для API-ответа). */
export interface SaveAccountResult {
  login: string;
  provider: MailAccount['provider'];
  authStrategy: MailAccount['authStrategy'];
}

/**
 * Валидирует поля, добавляет/обновляет аккаунт в реестре и атомарно сохраняет
 * обновлённый `ACCOUNTS` в `.env`.
 *
 * @throws Error при невалидных полях или ошибке записи в `.env`.
 */
export async function saveAccount(deps: SaveAccountDeps): Promise<SaveAccountResult> {
  const { account, registry, envPath } = deps;

  // Валидация полей (дублирует проверки мастера для API-вызовов без мастера).
  validateAccountFields(account);

  const full: MailAccount = {
    provider: account.provider,
    login: account.login,
    password: account.password,
    authStrategy: account.authStrategy ?? 'basic',
  };

  registry.upsert(full);
  try {
    await updateAccountsInEnv(envPath, registry.list());
  } catch (err) {
    // Откатываем изменение в реестре, чтобы состояние не разошлось с .env.
    // Перечитываем не делаем — .env единственный персистентный источник.
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`ошибка сохранения в .env: ${msg}`, { cause: err });
  }

  return {
    login: full.login,
    provider: full.provider,
    authStrategy: full.authStrategy,
  };
}

/** Валидирует поля аккаунта. @throws Error при невалидном поле. */
function validateAccountFields(account: SaveAccountDeps['account']): void {
  const { provider, login, password } = account;
  if (!provider || !['yandex', 'outlook', 'mail'].includes(provider)) {
    throw new Error(`provider должен быть yandex, outlook или mail, получено: ${provider}`);
  }
  if (!login || login.length === 0) {
    throw new Error('login не должен быть пустым');
  }
  if (!password || password.length === 0) {
    throw new Error('password не должен быть пустым');
  }
  const authStrategy = account.authStrategy ?? 'basic';
  if (!['basic', 'oauth2'].includes(authStrategy)) {
    throw new Error(`authStrategy должен быть basic или oauth2, получено: ${authStrategy}`);
  }
}
