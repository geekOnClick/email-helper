/**
 * Команда /analyze-many:批量-поиск писем и анализ каждого + общий смысл
 * (change cli-smart-commands).
 *
 * Подход (как у бывшей /find-all, design D2): мастер критериев (тема/
 * отправитель/диапазон дат) → серверу передаётся ТОЛЬКО диапазон дат, тема/
 * отправитель фильтруются локально через `collectAllMessages` (из
 * search-aggregator). Затем тела всех найденных писем фетчатся через `mail.fetch`
 * (с потолком `ANALYZE_MANY_MAX_EMAILS`) и одним вызовом субагента-анализатора
 * формируют: краткое саммари каждого письма + общий смысл всех писем (если он
 * есть; иначе — указание, что письма не связаны).
 *
 * Тулы `mail.search`/`mail.fetch` и спеки `mail/*` НЕ меняются.
 */
import type { ConsoleIO } from '../io.js';
import { promptFindAllCriteria, buildSearchArgsFromFindAll } from '../prompts.js';
import { promptAccount } from '../prompts.js';
import { getTool } from '../../../tools/registry.js';
import { ensureMailConnected } from './connect.js';
import { collectAllMessages } from './search-aggregator.js';
import type { MailAccount } from '../../../tools/mail/types.js';
import type { Subagent } from '../../../agents/subagent.js';
import type { EmailFull } from '../../../types/email.js';

/** Дефолт потолка числа писем, если deps.maxEmails не задан. */
const DEFAULT_MAX_EMAILS = 10;

/** Зависимости команды /analyze-many. */
export interface AnalyzeManyCommandDeps {
  /** Ввод/вывод. */
  io: ConsoleIO;
  /** Настроенные аккаунты. */
  accounts: MailAccount[];
  /** Субагент-анализатор (LLM). */
  analyzer: Subagent;
  /** Окно bounded-поиска (дней) без явной даты (MAIL_SEARCH_FALLBACK_DAYS). */
  fallbackDays?: number;
  /** Потолок числа писем для анализа (ANALYZE_MANY_MAX_EMAILS). По умолчанию 10. */
  maxEmails?: number;
}

/** Выполняет команду /analyze-many. */
export async function runAnalyzeManyCommand(deps: AnalyzeManyCommandDeps): Promise<void> {
  const { io, accounts, analyzer } = deps;
  const maxEmails = deps.maxEmails ?? DEFAULT_MAX_EMAILS;

  const criteria = await promptFindAllCriteria(io);
  if (!criteria) {
    io.write('Анализ отменён.\n');
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
  const fetchTool = getTool('mail.fetch');
  if (!searchTool || !fetchTool) {
    io.write('Тулы mail.search/mail.fetch не зарегистрированы.\n');
    return;
  }

  //批量-поиск (сервер — только даты, тема/отправитель локально).
  const args = buildSearchArgsFromFindAll(criteria);
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

  // Потолок числа писем для анализа: усечение с предупреждением.
  const all = collected.messages;
  const truncatedByEmails = all.length > maxEmails;
  const toAnalyze = truncatedByEmails ? all.slice(0, maxEmails) : all;
  if (truncatedByEmails) {
    io.write(
      `⚠ Найдено ${all.length} писем; анализируются первые ${maxEmails} (остальные пропущены).\n`,
    );
  }
  if (collected.truncated) {
    io.write('⚠ Достигнут лимит пагинации: показаны не все найденные письма.\n');
  }

  // Фетч тел писем через mail.fetch (последовательно).
  const emails: EmailFull[] = [];
  for (const m of toAnalyze) {
    try {
      const raw = await fetchTool.handler({ login: account.login, uid: m.uid });
      emails.push(raw as EmailFull);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      io.write(`Ошибка чтения письма UID=${m.uid}: ${msg}\n`);
    }
  }

  if (emails.length === 0) {
    io.write('Не удалось прочитать ни одного письма для анализа.\n');
    return;
  }

  // Сборка инструкции для анализатора: саммари каждого + общий смысл.
  const parts: string[] = ['Проанализируй следующие письма. Для каждого дай краткое саммари.'];
  parts.push('После саммари всех писем напиши общий смысл всех писем (если он есть);');
  parts.push('если письма не связаны и общего смысла нет — так и укажи.');
  parts.push('');
  emails.forEach((email, i) => {
    const from = email.from?.address ?? 'неизвестно';
    const date = email.date.toISOString().slice(0, 10);
    parts.push(`--- Письмо ${i + 1} ---`);
    parts.push(`UID: ${email.uid}`);
    parts.push(`Тема: ${email.subject}`);
    parts.push(`Отправитель: ${from}`);
    parts.push(`Дата: ${date}`);
    parts.push(`Тело:`);
    parts.push(email.body ?? '(тело недоступно)');
    parts.push('');
  });

  io.write('Анализирую письма...\n');
  try {
    const summary = await analyzer.run(parts.join('\n'));
    io.write(summary + '\n');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    io.write(`Ошибка анализа: ${msg}\n`);
  }
}
