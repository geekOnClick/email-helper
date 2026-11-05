/**
 * Команда /smart-search: поиск писем по произвольному промпту естественным
 * языком (change cli-smart-search, design D1–D4).
 *
 * Поток: промпт одной строкой (`promptSmartSearchPrompt`) → выбор аккаунта
 * (`promptAccount`) → подключение → one-shot вызов LLM-клиента (роль `helper`)
 * парсит промпт в структурированные критерии `{ тема?, отправитель?, дата_с?,
 * дата_по?, количество? }` → сборка `FindAllSearchArgs` (`serverCriteria` =
 * только даты; bounded-окно `fallbackDays` при отсутствии даты) →
 * `collectAllMessages` (сервер — только даты, тема/отправитель локально) →
 * сортировка по дате убыванием + top-N.
 *
 * - N=1 (или дефолт): показать самое свежее письмо целиком (с телом) БЕЗ анализа.
 * - N>1: таблица top-N (`formatMessageList`) → `promptUid` → показать выбранное
 *   письмо целиком (с телом) БЕЗ анализа.
 *
 * Потолок `ANALYZE_MANY_MAX_EMAILS` (дефолт 10) — хард-кап N. Тулы `mail.*` и
 * спеки `mail/*` НЕ меняются.
 */
import type { ConsoleIO } from '../io.js';
import { promptSmartSearchPrompt, promptAccount, promptUid, isoToDate } from '../prompts.js';
import { ensureMailConnected } from './connect.js';
import { formatMessageList, formatEmailFull } from '../format.js';
import { getTool } from '../../../tools/registry.js';
import { collectAllMessages } from './search-aggregator.js';
import type { MailAccount } from '../../../tools/mail/types.js';
import type { RouterAiClient } from '../../../llm/routerai-client.js';
import type { ChatMessage } from '../../../llm/types.js';
import type { FindAllSearchArgs } from '../prompts.js';
import type { EmailFull } from '../../../types/email.js';

/** Дефолт потолка/дефолта N, если deps.maxEmails не задан. */
const DEFAULT_MAX_EMAILS = 10;
/** Дефолт bounded-окна (дней), если deps.fallbackDays не задан. */
const DEFAULT_FALLBACK_DAYS = 180;

/** Зависимости команды /smart-search. */
export interface SmartSearchCommandDeps {
  /** Ввод/вывод. */
  io: ConsoleIO;
  /** Настроенные аккаунты. */
  accounts: MailAccount[];
  /** LLM-клиент для one-shot парсинга промпта (роль helper). */
  llmClient: RouterAiClient;
  /** Окно bounded-поиска (дней) без явной даты (MAIL_SEARCH_FALLBACK_DAYS). */
  fallbackDays?: number;
  /** Потолок числа писем (ANALYZE_MANY_MAX_EMAILS). По умолчанию 10. */
  maxEmails?: number;
}

/** Структурированные критерии, распарсенные моделью из промпта. */
interface ParsedCriteria {
  subject?: string;
  from?: string;
  dateFrom?: string;
  dateTo?: string;
  count?: number;
}

/** Выполняет команду /smart-search. */
export async function runSmartSearchCommand(deps: SmartSearchCommandDeps): Promise<void> {
  const { io, accounts, llmClient } = deps;
  const maxEmails = deps.maxEmails ?? DEFAULT_MAX_EMAILS;
  const fallbackDays = deps.fallbackDays ?? DEFAULT_FALLBACK_DAYS;

  const input = await promptSmartSearchPrompt(io);
  if (!input) {
    io.write('Поиск отменён.\n');
    return;
  }

  const account = await promptAccount(io, accounts);
  if (!account) return; // сообщение уже выведено в promptAccount

  if (!(await ensureMailConnected(io, account))) return;

  const searchTool = getTool('mail.search');
  const fetchTool = getTool('mail.fetch');
  if (!searchTool || !fetchTool) {
    io.write('Тулы mail.search/mail.fetch не зарегистрированы.\n');
    return;
  }

  // One-shot LLM-парсинг промпта в структурированные критерии.
  let parsed: ParsedCriteria;
  try {
    parsed = await parsePromptToCriteria(llmClient, input.prompt, maxEmails);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    io.write(`Ошибка разбора промпта: ${msg}\n`);
    return;
  }

  // Сборка FindAllSearchArgs: сервер — только даты (bounded-окно при отсутствии).
  const args = buildSearchArgsFromParsed(parsed, fallbackDays);

  //批量-поиск (сервер — только даты, тема/отправитель локально).
  let collected;
  try {
    collected = await collectAllMessages(searchTool, account.login, args);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    io.write(`Ошибка поиска: ${msg}\n`);
    return;
  }

  if (collected.messages.length === 0) {
    io.write('Ничего не найдено.\n');
    return;
  }
  if (collected.truncated) {
    io.write('⚠ Достигнут лимит пагинации: показаны не все найденные письма.\n');
  }

  // Сортировка по дате убыванием (новые сверху) + top-N.
  const n = parsed.count ?? 1;
  const sorted = [...collected.messages].sort((a, b) => b.date.getTime() - a.date.getTime());
  const top = sorted.slice(0, n);

  if (top.length === 1) {
    // N=1 — показать письмо целиком (с телом) без анализа.
    const target = top[0];
    if (!target) return;
    await showEmailFull(io, fetchTool, account.login, target.uid);
    return;
  }

  // N>1 — таблица + выбор UID.
  io.write(formatMessageList(top) + '\n');
  const uid = await promptUid(io, top);
  if (uid === null) {
    io.write('Поиск отменён.\n');
    return;
  }
  await showEmailFull(io, fetchTool, account.login, uid);
}

/**
 * One-shot LLM-парсинг промпта в структурированные критерии (роль helper).
 *
 * Системный промпт требует JSON-ответ вида `{ тема?, отправитель?, дата_с?,
 * дата_по?, количество? }`. Парсит и валидирует поля (даты ISO, email при
 * наличии, количество — положительное целое). Нормализует `количество`: если
 * промпт не называет число → не задаётся (дефолт N=1 в вызывающем коде);
 * превышение потолка `maxEmails` → ограничение до `maxEmails`.
 *
 * @throws Error при невалидном JSON или невалидных полях.
 */
async function parsePromptToCriteria(
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
 * `serverCriteria` = ТОЛЬКО даты (`since`/`before`); `subject`/`from` остаются
 * для локальной фильтрации. При отсутствии даты — bounded-окно
 * `now − fallbackDays` (а не весь ящик, как `buildSearchArgsFromFindAll`):
 * быстро и достаточно для типичных «последних» писем (design D2). При наличии
 * `дата_по` → `before` = полночь следующего дня (включительно).
 */
function buildSearchArgsFromParsed(parsed: ParsedCriteria, fallbackDays: number): FindAllSearchArgs {
  const server: { since?: Date; before?: Date } = {};

  if (parsed.dateFrom) {
    server.since = isoToDate(parsed.dateFrom);
  } else {
    // Bounded-окно: since = now − fallbackDays (миллисекунды).
    const since = new Date();
    since.setDate(since.getDate() - fallbackDays);
    server.since = since;
  }

  if (parsed.dateTo) {
    // «дата по» включительно → before = следующий день.
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

/** Фетчит тело письма и выводит его целиком (без LLM-анализа). */
async function showEmailFull(
  io: ConsoleIO,
  fetchTool: { handler: (args: { login: string; uid: number }) => Promise<unknown> },
  login: string,
  uid: number,
): Promise<void> {
  let email: EmailFull;
  try {
    email = (await fetchTool.handler({ login, uid })) as EmailFull;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    io.write(`Ошибка чтения письма: ${msg}\n`);
    return;
  }

  io.write(formatEmailFull(
    {
      uid: email.uid,
      subject: email.subject,
      from: email.from,
      date: email.date,
      body: email.body ?? '(тело недоступно)',
    },
    io.isTTY(),
  ) + '\n');
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
