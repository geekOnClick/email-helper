/**
 * Команда /find-all: поиск всех писем по теме/отправителю и диапазону дат,
 * вывод таблицей (change cli-find-all-command).
 *
 * Подход (design D1): серверный IMAP SEARCH Яндекса по кириллическим темам
 * ненадёжен — возвращает неполный результат, после чего bounded fallback тулa
 * не срабатывает (он запускается только при 0). Поэтому команда НЕ передаёт
 * `subject`/`from` в серверный поиск: ищет только по диапазону дат (надёжно),
 * получает ВСЕ письма диапазона через пагинацию и фильтрует по теме/отправителю
 * ЛОКАЛЬНО (case-insensitive, нормализация пробелов). Так находятся все совпадения.
 *
 * Переиспользует тул `mail.search` (с его `since`/`before`/`limit`/`offset`) — без
 * изменений тула и спеки `mail/search`. Поле `total` тула считает UIDs *до*
 * локальной дофильтровки, поэтому на него не опираемся — агрегируем фактически
 * отфильтрованные `messages` по страницам.
 */
import type { ConsoleIO } from '../io.js';
import { promptFindAllCriteria, buildSearchArgsFromFindAll, type FindAllSearchArgs } from '../prompts.js';
import { promptAccount } from '../prompts.js';
import { formatFindAllTable } from '../format.js';
import { getTool } from '../../../tools/registry.js';
import { ensureMailConnected } from './connect.js';
import type { ToolDef } from '../../../tools/registry.js';
import type { SearchCriteria, SearchResult, EmailMessage } from '../../../types/email.js';
import type { MailAccount } from '../../../tools/mail/types.js';

/** Зависимости команды /find-all (те же, что у /find). */
export interface FindAllCommandDeps {
  /** Ввод/вывод. */
  io: ConsoleIO;
  /** Настроенные аккаунты (для выбора). */
  accounts: MailAccount[];
}

/** Параметры пагинации агрегатора сообщений. */
export interface CollectAllMessagesOptions {
  /** Размер страницы (limit) для mail.search. По умолчанию 50. */
  pageSize?: number;
  /** Максимум страниц (потолок пагинации). По умолчанию 200 (≤10 000 писем). */
  maxPages?: number;
}

/** Результат агрегации сообщений. */
export interface CollectAllMessagesResult {
  /** Все найденные письма (с датой, темой, отправителем), прошедшие локальный фильтр. */
  messages: EmailMessage[];
  /** Достигнут ли потолок пагинации (возможны ещё письма). */
  truncated: boolean;
}

/** Нормализует строку для локальной фильтрации: lower case + схлопывание пробелов. */
function normalizeForMatch(s: string | undefined): string {
  if (!s) return '';
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Локальный фильтр письма по теме/отправителю (case-insensitive, пробелы нормализованы).
 * Тема: подстрока `subject` в теме. Отправитель: подстрока `from` в имени или адресе.
 */
function matchesLocalFilters(m: EmailMessage, subject: string | undefined, from: string | undefined): boolean {
  if (subject) {
    const subj = normalizeForMatch(m.subject);
    if (!subj.includes(normalizeForMatch(subject))) return false;
  }
  if (from) {
    const f = normalizeForMatch(from);
    const addr = normalizeForMatch(m.from?.address);
    const name = normalizeForMatch(m.from?.name);
    if (!addr.includes(f) && !name.includes(f)) return false;
  }
  return true;
}

/**
 * Проходит пагинацию `mail.search` и агрегирует все найденные письма.
 *
 * Серверному поиску передаётся ТОЛЬКО диапазон дат (`args.serverCriteria`) — без
 * темы/отправителя (см. design D1). Запрашивает страницы (`limit`/`offset`), пока
 * `hasMore` не станет `false`, аккумулируя `messages`. Останавливается также при
 * пустой странице или достижении `maxPages` (тогда `truncated: true`). После сбора
 * применяет локальный фильтр по `subject`/`from` (case-insensitive, нормализация
 * пробелов). Не опирается на `total` — он считает UIDs до локальной дофильтровки.
 *
 * `searchTool.handler` вызывается с `{ login, criteria: { ...serverCriteria, limit, offset } }`.
 */
export async function collectAllMessages(
  searchTool: ToolDef,
  login: string,
  args: FindAllSearchArgs,
  options: CollectAllMessagesOptions = {},
): Promise<CollectAllMessagesResult> {
  const pageSize = options.pageSize ?? 50;
  const maxPages = options.maxPages ?? 200;

  const all: EmailMessage[] = [];
  let offset = 0;
  let truncated = false;

  for (let page = 0; page < maxPages; page++) {
    const criteria: SearchCriteria = {
      ...args.serverCriteria,
      limit: pageSize,
      offset,
    };
    const raw = await searchTool.handler({ login, criteria });
    const result = raw as SearchResult;
    const pageMessages: EmailMessage[] = result?.messages ?? [];
    for (const m of pageMessages) {
      all.push(m);
    }
    if (pageMessages.length === 0) {
      break; // пустая страница — дальше ничего нет
    }
    if (!result.hasMore) {
      break; // последняя страница
    }
    // Дошли до последней разрешённой страницы, а hasMore ещё true — усечено.
    if (page === maxPages - 1) {
      truncated = true;
      break;
    }
    offset += pageSize;
  }

  // Локальная фильтрация по теме/отправителю (сервер не ищет их — см. design D1).
  const messages = args.subject || args.from
    ? all.filter((m) => matchesLocalFilters(m, args.subject, args.from))
    : all;

  return { messages, truncated };
}

/**
 * Выполняет команду /find-all: мастер критериев → выбор аккаунта →
 * подключение → агрегация всех писем через `mail.search` → вывод таблицей.
 *
 * Шаги:
 * 1. Собрать критерии (`promptFindAllCriteria`); пусто → отмена.
 * 2. Выбрать аккаунт (`promptAccount`); null → выход.
 * 3. `ensureMailConnected`; неудача → выход (сообщение уже выведено).
 * 4. Получить тул `mail.search`; если не зарегистрирован — сообщение.
 * 5. `collectAllMessages` (нормализация критериев через `buildSearchArgsFromFindAll`).
 * 6. 0 писем → «Ничего не найдено.»; иначе `formatFindAllTable`.
 * 7. `truncated` → предупреждение о лимите пагинации.
 */
export async function runFindAllCommand(deps: FindAllCommandDeps): Promise<void> {
  const { io, accounts } = deps;

  const criteria = await promptFindAllCriteria(io);
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

  const args = buildSearchArgsFromFindAll(criteria);
  let result: CollectAllMessagesResult;
  try {
    result = await collectAllMessages(searchTool, account.login, args);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    io.write(`Ошибка поиска: ${msg}\n`);
    return;
  }

  if (result.messages.length === 0) {
    io.write('Ничего не найдено.\n');
    return;
  }

  io.write(formatFindAllTable(result.messages, io.isTTY()) + '\n');
  if (result.truncated) {
    io.write('⚠ Достигнут лимит пагинации: показаны не все найденные письма.\n');
  }
}
