/**
 * Чистая доменная функция команды /smart-search (change web-interface, design D1).
 *
 * Выделена из `src/transport/cli/commands/smart-search.ts`, чтобы переиспользовать
 * логику парсинга промпта + поиска в веб-транспорте без дублирования. Не зависит
 * от `ConsoleIO`: принимает структурированный DTO, возвращает результат.
 *
 * Поток: one-shot LLM-парсинг промпта (роль helper) → `FindAllSearchArgs`
 * (сервер — только даты; bounded-окно `fallbackDays` при отсутствии) →
 * `collectAllMessages` (сервер — только даты, тема/отправитель локально) →
 * сортировка по дате убыванием + top-N. Возвращает найденные письма (метаданные);
 * чтение тел — отдельная операция (`fetchEmail`).
 */
import type { ToolDef } from '../../tools/registry.js';
import type { RouterAiClient } from '../../llm/routerai-client.js';
import type { ChatMessage } from '../../llm/types.js';
import type { EmailMessage } from '../../types/email.js';
import type { FindAllSearchArgs } from '../cli/prompts.js';
import { collectAllMessages } from '../cli/commands/search-aggregator.js';

/** Дефолт потолка/дефолта N, если не задан. */
const DEFAULT_MAX_EMAILS = 10;
/** Дефолт bounded-окна (дней), если не задан. */
const DEFAULT_FALLBACK_DAYS = 180;

/** Структурированные критерии, распарсенные моделью из промпта. */
export interface ParsedCriteria {
  subject?: string;
  from?: string;
  dateFrom?: string;
  dateTo?: string;
  count?: number;
}

/** DTO команды /smart-search (без ConsoleIO). */
export interface SmartSearchDeps {
  /** Логин аккаунта для поиска. */
  accountLogin: string;
  /** Произвольный промпт естественным языком. */
  prompt: string;
  /** LLM-клиент для one-shot парсинга промпта (роль helper). */
  llmClient: RouterAiClient;
  /** Тул `mail.search`. */
  searchTool: ToolDef;
  /** Окно bounded-поиска (дней) без явной даты. По умолчанию 180. */
  fallbackDays?: number;
  /** Потолок числа писем. По умолчанию 10. */
  maxEmails?: number;
}

/** Результат smart-search: top-N найденных писем (новые сверху). */
export interface SmartSearchResult {
  /** Найденные письма (сортировка по дате убыванием, top-N). */
  messages: EmailMessage[];
  /** Запрошенное число писем N (после нормализации/ограничения потолком). */
  count: number;
  /** Достигнут ли потолок пагинации при批量-поиске. */
  truncated: boolean;
}

/**
 * Выполняет smart-search: парсит промпт LLM в критерии, ищет письма,
 * возвращает top-N (сортировка по дате убыванием).
 *
 * @throws Error при невалидном JSON-ответе модели или ошибке поиска.
 */
export async function runSmartSearch(deps: SmartSearchDeps): Promise<SmartSearchResult> {
  const maxEmails = deps.maxEmails ?? DEFAULT_MAX_EMAILS;
  const fallbackDays = deps.fallbackDays ?? DEFAULT_FALLBACK_DAYS;

  const parsed = await parsePromptToCriteria(deps.llmClient, deps.prompt, maxEmails);
  const args = buildSearchArgsFromParsed(parsed, fallbackDays);

  const collected = await collectAllMessages(deps.searchTool, deps.accountLogin, args);

  if (collected.messages.length === 0) {
    return { messages: [], count: parsed.count ?? 1, truncated: collected.truncated };
  }

  const n = parsed.count ?? 1;
  const sorted = [...collected.messages].sort((a, b) => b.date.getTime() - a.date.getTime());
  const top = sorted.slice(0, n);

  return { messages: top, count: n, truncated: collected.truncated };
}

/**
 * One-shot LLM-парсинг промпта в структурированные критерии (роль helper).
 *
 * Системный промпт требует JSON-ответ вида `{ тема?, отправитель?, дата_с?,
 * дата_по?, количество? }`. Нормализует `количество`: если промпт не называет
 * число → не задаётся (дефолт N=1 в вызывающем коде); превышение потолка
 * `maxEmails` → ограничение до `maxEmails`.
 *
 * @throws Error при невалидном JSON или невалидных полях.
 */
export async function parsePromptToCriteria(
  client: RouterAiClient,
  prompt: string,
  maxEmails: number,
): Promise<ParsedCriteria> {
  const systemParts: string[] = [
    'Ты — помощник, разбирающий поисковый промпт пользователя в критерии поиска писем.',
    'Верни ТОЛЬКО валидный JSON (без пояснений, без markdown-блоков) вида:',
    '{"тема": "<подстрока или null>", "отправитель": "<email или null>", "дата_с": "<YYYY-MM-DD или null>", "дата_по": "<YYYY-MM-DD или null>", "количество": <целое число или null>}',
    'Поля опциональны: указывай только то, что явно упомянуто в промпте. null — если поле не упомянуто.',
    '«тема» — подстрока темы письма; «отправитель» — email адрес; «дата_с»/«дата_по» — ISO дата YYYY-MM-DD (включительно); «количество» — сколько писем хочет пользователь (для «последнее/одно» → 1).',
  ];

  const messages: ChatMessage[] = [
    { role: 'system', content: systemParts.join('\n') },
    { role: 'user', content: prompt },
  ];

  const result = await client.chat({ messages, role: 'helper' });
  const content = result.content.trim();

  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch {
    throw new Error('модель вернула невалидный JSON');
  }

  if (!raw || typeof raw !== 'object') {
    throw new Error('модель вернула не объект JSON');
  }

  const obj = raw as Record<string, unknown>;
  const parsed: ParsedCriteria = {};

  const subject = obj['тема'];
  if (typeof subject === 'string' && subject.trim() !== '') {
    parsed.subject = subject.trim();
  }

  const from = obj['отправитель'];
  if (typeof from === 'string' && from.trim() !== '') {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(from.trim())) {
      throw new Error(`некорректный email отправителя: ${from}`);
    }
    parsed.from = from.trim();
  }

  const dateFrom = obj['дата_с'];
  if (typeof dateFrom === 'string' && dateFrom.trim() !== '') {
    if (!isValidIsoDate(dateFrom.trim())) {
      throw new Error(`некорректная дата_с: ${dateFrom}`);
    }
    parsed.dateFrom = dateFrom.trim();
  }

  const dateTo = obj['дата_по'];
  if (typeof dateTo === 'string' && dateTo.trim() !== '') {
    if (!isValidIsoDate(dateTo.trim())) {
      throw new Error(`некорректная дата_по: ${dateTo}`);
    }
    parsed.dateTo = dateTo.trim();
  }

  const count = obj['количество'];
  if (count !== null && count !== undefined) {
    const n = Number(count);
    if (!Number.isInteger(n) || n <= 0) {
      throw new Error(`количество должно быть положительным целым: ${count}`);
    }
    parsed.count = Math.min(n, maxEmails);
  }

  return parsed;
}

/**
 * Собирает `FindAllSearchArgs` из распарсенных критериев.
 *
 * `serverCriteria` = ТОЛЬКО даты; `subject`/`from` локально. При отсутствии даты —
 * bounded-окно `now − fallbackDays`. При `дата_по` → `before` = полночь следующего
 * дня (включительно).
 */
export function buildSearchArgsFromParsed(
  parsed: ParsedCriteria,
  fallbackDays: number,
): FindAllSearchArgs {
  const server: { since?: Date; before?: Date } = {};

  if (parsed.dateFrom) {
    server.since = isoToDate(parsed.dateFrom);
  } else {
    const since = new Date();
    since.setDate(since.getDate() - fallbackDays);
    server.since = since;
  }

  if (parsed.dateTo) {
    const before = isoToDate(parsed.dateTo);
    before.setDate(before.getDate() + 1);
    server.before = before;
  }

  return {
    serverCriteria: server,
    subject: parsed.subject,
    from: parsed.from,
  };
}

/** Парсит ISO YYYY-MM-DD в локальную полночь (без сдвига часового пояса). */
function isoToDate(iso: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return new Date(iso);
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** Проверка ISO-даты YYYY-MM-DD (с валидацией реальной даты). */
function isValidIsoDate(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12) return false;
  if (d < 1 || d > 31) return false;
  const dt = new Date(y, mo - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d;
}
