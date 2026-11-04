/**
 * Команда /find: поиск писем по критериям (change guided-commands).
 *
 * Собирает критерии через мастер, запрашивает выбор аккаунта, вызывает
 * тул mail.search и выводит список найденных писем. Детерминированный поток
 * без LLM на этапе ввода.
 *
 * Подход (как у /find-all): серверный IMAP SEARCH Яндекса по кириллическим
 * `subject`-литералам и `from` ненадёжен — возвращает 0 либо неполный набор.
 * Поэтому на сервер передаётся ТОЛЬКО диапазон дат (`since`/`before`,
 * надёжный критерий), а `subject`/`from` фильтруются ЛОКАЛЬНО после фетча
 * (через `collectAllMessages`). Так находятся все совпадения, независимо от
 * ненадёжности серверного SEARCH по теме/отправителю.
 *
 * - Явная `дата` → `since` = полночь указанного дня, `before` = следующий день
 *   (один день включительно), как в /find-all.
 * - Без даты → bounded `since` = `now − fallbackDays` (по умолчанию 180, из
 *   конфига `MAIL_SEARCH_FALLBACK_DAYS`), чтобы не фетчить весь ящик. Тулы
 *   не меняются — bounded-окно формируется на уровне команды.
 */
import type { ConsoleIO } from '../io.js';
import { promptSearchCriteria, promptAccount, isoToDate, type FindAllSearchArgs } from '../prompts.js';
import { formatMessageList } from '../format.js';
import { getTool } from '../../../tools/registry.js';
import { ensureMailConnected } from './connect.js';
import { collectAllMessages } from './find-all.js';
import type { MailAccount } from '../../../tools/mail/types.js';

/** Дефолт окна bounded-поиска (дней) без явной даты — совпадает с MAIL_SEARCH_FALLBACK_DAYS. */
const DEFAULT_FALLBACK_DAYS = 180;

/** Зависимости команды /find. */
export interface FindCommandDeps {
  /** Ввод/вывод. */
  io: ConsoleIO;
  /** Настроенные аккаунты (для выбора). */
  accounts: MailAccount[];
  /** Окно bounded-поиска (дней) без явной даты. По умолчанию 180. */
  fallbackDays?: number;
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

  if (!(await ensureMailConnected(io, account))) {
    return; // ошибка подключения уже выведена
  }

  const searchTool = getTool('mail.search');
  if (!searchTool) {
    io.write('Тул mail.search не зарегистрирован.\n');
    return;
  }

  const args = buildSearchArgs(criteria, deps.fallbackDays ?? DEFAULT_FALLBACK_DAYS);
  let result: { messages: import('../../../types/email.js').EmailMessage[]; truncated: boolean };
  try {
    result = await collectAllMessages(searchTool, account.login, args);
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
  if (result.truncated) {
    io.write('⚠ Достигнут лимит пагинации: показаны не все найденные письма.\n');
  }
}

/**
 * Строит аргументы поиска (FindAllSearchArgs) из ввода мастера:
 * - `serverCriteria` — ТОЛЬКО даты (`since`/`before`): явная `дата` → один день
 *   включительно; без даты → bounded `now − fallbackDays`.
 * - `subject`/`from` — остаются для локальной фильтрации (не идут на сервер).
 */
function buildSearchArgs(
  input: { subject?: string; date?: string; from?: string },
  fallbackDays: number,
): FindAllSearchArgs {
  const server: { since?: Date; before?: Date } = {};
  if (input.date) {
    // один день включительно: since = полночь указанного дня, before = следующий день
    server.since = isoToDate(input.date);
    const before = isoToDate(input.date);
    before.setDate(before.getDate() + 1);
    server.before = before;
  } else {
    // bounded окно без явной даты — не фетчить весь ящик
    const since = new Date();
    since.setDate(since.getDate() - fallbackDays);
    server.since = since;
  }
  return {
    serverCriteria: server,
    subject: input.subject,
    from: input.from,
  };
}
