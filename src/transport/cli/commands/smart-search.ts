/**
 * Команда /smart-search: поиск писем по произвольному промпту естественным
 * языком (change cli-smart-search, design D1–D4).
 *
 * Тонкий CLI-адаптер (change web-interface, design D1): собирает ввод через
 * ConsoleIO, вызывает чистую доменную функцию `runSmartSearch` (из transport/
 * commands) и рендерит результат. Доменная логика (парсинг промпта + поиск)
 * переиспользуется веб-транспортом без дублирования.
 *
 * Поток: промпт одной строкой (`promptSmartSearchPrompt`) → выбор аккаунта
 * (`promptAccount`) → подключение → `runSmartSearch` → top-N.
 *
 * - N=1 (или дефолт): показать самое свежее письмо целиком (с телом) БЕЗ анализа.
 * - N>1: таблица top-N (`formatMessageList`) → `promptUid` → показать выбранное
 *   письмо целиком (с телом) БЕЗ анализа.
 */
import type { ConsoleIO } from '../io.js';
import { promptSmartSearchPrompt, promptAccount, promptUid } from '../prompts.js';
import { ensureMailConnected } from './connect.js';
import { formatMessageList, formatEmailFull } from '../format.js';
import { getTool } from '../../../tools/registry.js';
import { runSmartSearch } from '../../commands/smart-search.js';
import type { MailAccount } from '../../../tools/mail/types.js';
import type { RouterAiClient } from '../../../llm/routerai-client.js';
import type { EmailFull } from '../../../types/email.js';

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


/** Выполняет команду /smart-search. */
export async function runSmartSearchCommand(deps: SmartSearchCommandDeps): Promise<void> {
  const { io, accounts, llmClient } = deps;

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

  // Чистая доменная функция: парсинг промпта + поиск (переиспользуется вебом).
  let result;
  try {
    result = await runSmartSearch({
      accountLogin: account.login,
      prompt: input.prompt,
      llmClient,
      searchTool,
      fallbackDays: deps.fallbackDays,
      maxEmails: deps.maxEmails,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    io.write(`Ошибка поиска: ${msg}\n`);
    return;
  }

  if (result.messages.length === 0) {
    io.write('Ничего не найдено.\n');
    return;
  }
  if (result.truncated) {
    io.write('⚠ Достигнут лимит пагинации: показаны не все найденные письма.\n');
  }

  const top = result.messages;

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
