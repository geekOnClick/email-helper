/**
 * Подключает аккаунт к IMAP, если сессия ещё не активна или её соединение разорвано.
 *
 * Guided-команды вызывают IMAP-тулы (mail.search, mail.fetch, ...) напрямую,
 * минуя LLM-цикл оркестратора. В оркестраторе LLM сам вызывает mail.connect
 * перед использованием остальных тулов. В guided-режиме этого шага нет —
 * поэтому команды обязаны подключить аккаунт самостоятельно перед операцией.
 *
 * Проверка живости и прозрачное переподключение (change
 * mail-connection-self-healing): если сессия числится в хранилище, но реальное
 * соединение разорвано (IDLE-таймаут сервера, сетевой обрыв) — прозрачно
 * переподключает через `provider.reconnect()` перед операцией, без запроса к
 * пользователю. Если сессии нет — подключение через тул `mail.connect`.
 */
import type { ConsoleIO } from '../io.js';
import { getTool } from '../../../tools/registry.js';
import { getSharedSessionStore } from '../../../tools/mail/register-tools.js';
import type { MailAccount } from '../../../tools/mail/types.js';

/**
 * Подключает аккаунт к IMAP, если сессия ещё не активна или её соединение
 * разорвано. Выводит прогресс и ошибки в io. При неудаче возвращает false.
 */
export async function ensureMailConnected(
  io: ConsoleIO,
  account: MailAccount,
): Promise<boolean> {
  const store = getSharedSessionStore();

  // Сессия есть в хранилище — проверяем живость соединения.
  if (store.has(account.login)) {
    const provider = store.get(account.login);
    if (provider && provider.isConnectionUsable()) {
      return true; // соединение пригодно — операция без переподключения
    }
    // Соединение разорвано (IDLE-таймаут/сетевой обрыв) — прозрачное переподключение.
    if (provider) {
      io.write(`Переподключение к ${account.login}...
`);
      try {
        await provider.reconnect();
        io.write('Подключено.\n');
        return true;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        io.write(`Ошибка переподключения к ${account.login}: ${msg}\n`);
        return false;
      }
    }
  }

  // Сессии нет — подключение через тул mail.connect (как ранее).
  const connectTool = getTool('mail.connect');
  if (!connectTool) {
    io.write('Тул mail.connect не зарегистрирован.\n');
    return false;
  }

  io.write(`Подключение к ${account.login}...
`);
  try {
    await connectTool.handler({ login: account.login, provider: account.provider });
    io.write('Подключено.\n');
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    io.write(`Ошибка подключения к ${account.login}: ${msg}\n`);
    return false;
  }
}
