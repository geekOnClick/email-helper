/**
 * Команда /find: поиск писем по критериям (change guided-commands).
 *
 * Собирает критерии через мастер, запрашивает выбор аккаунта, вызывает
 * тул mail.search и выводит список найденных писем. Детерминированный поток
 * без LLM на этапе ввода.
 */
import type { ConsoleIO } from '../io.js';
import { promptSearchCriteria, promptAccount } from '../prompts.js';
import { formatMessageList } from '../format.js';
import { getTool } from '../../../tools/registry.js';
import type { MailAccount } from '../../../tools/mail/types.js';
import type { SearchResult } from '../../../types/email.js';

/** Зависимости команды /find. */
export interface FindCommandDeps {
  /** Ввод/вывод. */
  io: ConsoleIO;
  /** Настроенные аккаунты (для выбора). */
  accounts: MailAccount[];
}

/** Выполняет команду /find. */
export async function runFindCommand(deps: FindCommandDeps): Promise<void> {
  const { io, accounts } = deps;

  const criteria = await promptSearchCriteria(io);
  if (!criteria) {
    io.write('Поиск отменён.\n');
    return;
  }

  const account = await promptAccount(io, accounts);
  if (!account) {
    return; // сообщение уже выведено в promptAccount
  }

  const searchTool = getTool('mail.search');
  if (!searchTool) {
    io.write('Тул mail.search не зарегистрирован.\n');
    return;
  }

  let result: SearchResult;
  try {
    const raw = await searchTool.handler({
      login: account.login,
      criteria: buildSearchCriteria(criteria),
    });
    result = raw as SearchResult;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    io.write(`Ошибка поиска: ${msg}\n`);
    return;
  }

  if (!result.messages || result.messages.length === 0) {
    io.write('Ничего не найдено.\n');
    return;
  }

  io.write(formatMessageList(result.messages) + '\n');
}

/** Строит критерии тулa mail.search из ввода мастера. */
function buildSearchCriteria(input: {
  subject?: string;
  date?: string;
  from?: string;
}): {
  subject?: string;
  since?: string;
  from?: string;
} {
  const result: { subject?: string; since?: string; from?: string } = {};
  if (input.subject) result.subject = input.subject;
  if (input.date) result.since = input.date;
  if (input.from) result.from = input.from;
  return result;
}
