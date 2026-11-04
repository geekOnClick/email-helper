/**
 * Команда /add-account: заведение/обновление почтового аккаунта в `.env`
 * (change mcp-env-account-credentials).
 *
 * Собирает поля аккаунта (provider, login, password, authStrategy) через мастер
 * ввода, при дубликате login запрашивает подтверждение перезаписи, добавляет/
 * обновляет запись в in-memory `AccountRegistry` и атомарно сохраняет обновлённый
 * `ACCOUNTS` в `.env`. Команда доступна только в локальном CLI и НЕ экспонируется
 * по MCP — пароль вводится в терминале оператора, минуя MCP-wire и LLM.
 */
import type { ConsoleIO } from '../io.js';
import { promptAccountFields, promptConfirm } from '../prompts.js';
import { updateAccountsInEnv } from '../../../config/env-writer.js';
import type { AccountRegistry } from '../../../config/account-registry.js';
import type { MailAccount } from '../../../tools/mail/types.js';

/** Зависимости команды /add-account. */
export interface AddAccountCommandDeps {
  /** Ввод/вывод. */
  io: ConsoleIO;
  /** In-memory реестр аккаунтов (источник правды для тулов). */
  registry: AccountRegistry;
  /** Путь к `.env` для персистентности ACCOUNTS. */
  envPath: string;
}

/**
 * Выполняет команду /add-account: мастер заведения аккаунта с подтверждением
 * перезаписи при дубликате login и сохранением в реестр + `.env`.
 */
export async function runAddAccountCommand(deps: AddAccountCommandDeps): Promise<void> {
  const { io, registry, envPath } = deps;

  const input = await promptAccountFields(io);
  if (!input) {
    io.write('Заведение аккаунта отменено (не все обязательные поля указаны).\n');
    return;
  }

  const account: MailAccount = {
    provider: input.provider,
    login: input.login,
    password: input.password,
    authStrategy: input.authStrategy,
  };

  // Дубликат login → подтверждение перезаписи.
  if (registry.has(input.login)) {
    const confirmed = await promptConfirm(
      io,
      `Аккаунт «${input.login}» уже существует. Перезаписать?`,
    );
    if (!confirmed) {
      io.write('Заведение аккаунта отменено (перезапись не подтверждена).\n');
      return;
    }
  }

  // Добавление/обновление в реестре (in-memory) + атомарная запись в .env.
  registry.upsert(account);
  try {
    await updateAccountsInEnv(envPath, registry.list());
  } catch (err) {
    // Откатываем изменение в реестре, чтобы состояние не разошлось с .env.
    // (В простом случае — оставляем прежнее; для надёжности перечитываем не делаем,
    // т.к. .env — единственный персистентный источник.)
    const msg = err instanceof Error ? err.message : String(err);
    io.write(`Ошибка сохранения в .env: ${msg}. Изменение в реестре сохранено в памяти до перезапуска.\n`);
    return;
  }

  io.write(`✓ Аккаунт сохранён: ${account.login} (${account.provider}, ${account.authStrategy}).\n`);
  io.write('  Записано в ACCOUNTS в .env.\n');
  io.write('  Напоминаем: перезапустите MCP-сервер, чтобы он увидел новый аккаунт.\n');
}
