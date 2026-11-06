/**
 * Команда /add-account: заведение/обновление почтового аккаунта в `.env`
 * (change mcp-env-account-credentials).
 *
 * Тонкий CLI-адаптер (change web-interface, design D1): собирает поля через
 * мастер ввода, при дубликате login запрашивает подтверждение, вызывает чистую
 * функцию `saveAccount` (из transport/commands). Доменная логика (валидация +
 * запись в реестр + `.env`) переиспользуется вебом без дублирования.
 *
 * Команда доступна только в локальном CLI (и вебе) и НЕ экспонируется по MCP —
 * пароль вводится на бэкенде, минуя MCP-wire и LLM.
 */
import type { ConsoleIO } from '../io.js';
import { promptAccountFields, promptConfirm } from '../prompts.js';
import { saveAccount } from '../../commands/add-account.js';
import type { AccountRegistry } from '../../../config/account-registry.js';

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

  // Чистая функция: валидация + реестр + атомарная запись в .env (переиспользуется вебом).
  try {
    const result = await saveAccount({
      account: {
        provider: input.provider,
        login: input.login,
        password: input.password,
        authStrategy: input.authStrategy,
      },
      registry,
      envPath,
    });
    io.write(`✓ Аккаунт сохранён: ${result.login} (${result.provider}, ${result.authStrategy}).\n`);
    io.write('  Записано в ACCOUNTS в .env.\n');
    io.write('  Напоминаем: перезапустите MCP-сервер, чтобы он увидел новый аккаунт.\n');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    io.write(`Ошибка сохранения: ${msg}\n`);
  }
}
