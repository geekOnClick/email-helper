/**
 * Shared-утилита пакетного поиска писем (change cli-smart-commands).
 *
 * Извлечена из бывшей команды /find-all, чтобы переиспользовать проверенную
 * машину пакетного поиска (локальная фильтрация темы/отправителя + пагинация) в
 * новой команде /analyze-many без дублирования логики.
 *
 * Подход (как у /find-all, design D1): серверный IMAP SEARCH Яндекса по
 * кириллическим темам/отправителю ненадёжен — возвращает неполный результат.
 * Поэтому на сервер передаётся ТОЛЬКО диапазон дат (`since`/`before`), а
 * `subject`/`from` фильтруются ЛОКАЛЬНО после фетча (case-insensitive,
 * нормализация пробелов). Так находятся все совпадения.
 *
 * Тулы `mail.search`/спека `mail/search` НЕ меняются.
 */
import type { ToolDef } from '../../../tools/registry.js';
import type { SearchCriteria, SearchResult, EmailMessage } from '../../../types/email.js';
import type { FindAllSearchArgs } from '../prompts.js';

/** Параметры пагинации агрегатора сообщений. */
export interface CollectAllMessagesOptions {
  /** Размер страницы (limit) для mail.search. По умолчанию 500. */
  pageSize?: number;
  /** Максимум страниц (потолок пагинации). По умолчанию 200 (≤100 000 писем). */
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
function matchesLocalFilters(
  m: EmailMessage,
  subject: string | undefined,
  from: string | undefined,
): boolean {
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
  const pageSize = options.pageSize ?? 500;
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
