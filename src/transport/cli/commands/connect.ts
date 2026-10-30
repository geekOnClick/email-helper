/**
 * Общий helper для guided-команд: гарантирует активную IMAP-сессию.
 *
 * Guided-команды вызывают IMAP-тулы (mail.search, mail.fetch, ...) напрямую,
 * минуя LLM-цикл оркестратора. В оркестраторе LLM сам вызывает mail.connect
 * перед использованием остальных тулов. В guided-режиме этого шага нет —
 * поэтому команды обязаны подключить аккаунт самостоятельно перед операцией.
 *
 * Подключение выполняется через зарегистрированный тул mail.connect, чтобы
 * переиспользовать единую фабрику провайдеров и общий SessionStore.
 */
import type { ConsoleIO } from '../io.js';
import { getTool } from '../../../tools/registry.js';
import { getSharedSessionStore } from '../../../tools/mail/register-tools.js';
import type { MailAccount } from '../../../tools/mail/types.js';

/**
 * Подключает аккаунт к IMAP, если сессия ещё не активна.
 * Выводит прогресс и ошибки в io. При неудаче возвращает false.
 */
export async function ensureMailConnected(
  io: ConsoleIO,
  account: MailAccount,
): Promise<boolean> {
  const store = getSharedSessionStore();
  if (store.has(account.login)) {
    return true; // сессия уже активна
  }

  const connectTool = getTool('mail.connect');
  if (!connectTool) {
    io.write('Тул mail.connect не зарегистрирован.\n');
    return false;
  }

  io.write(`Подключение к ${account.login}...\n`);
  try {
    await connectTool.handler({ login: account.login });
    io.write('Подключено.\n');
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    io.write(`Ошибка подключения к ${account.login}: ${msg}\n`);
    return false;
  }
}
