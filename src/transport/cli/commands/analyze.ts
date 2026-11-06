/**
 * Команда /analyze: найти и проанализировать письмо (change guided-commands).
 *
 * Тонкий CLI-адаптер (change web-interface, design D1): собирает критерии,
 * ищет письма, выбирает UID, вызывает чистую функцию `runAnalyze` (из transport/
 * commands) и рендерит отчёт. Доменная логика (фетч + анализ) переиспользуется
 * вебом без дублирования.
 */
import type { ConsoleIO } from '../io.js';
import { promptSearchCriteria, promptAccount, promptUid, toSearchCriteria } from '../prompts.js';
import { ensureMailConnected } from './connect.js';
import { formatMessageList } from '../format.js';
import { getTool } from '../../../tools/registry.js';
import { runAnalyze } from '../../commands/analyze.js';
import type { MailAccount } from '../../../tools/mail/types.js';
import type { Subagent } from '../../../agents/subagent.js';
import type { SearchResult } from '../../../types/email.js';

/** Зависимости команды /analyze. */
export interface AnalyzeCommandDeps {
  /** Ввод/вывод. */
  io: ConsoleIO;
  /** Настроенные аккаунты. */
  accounts: MailAccount[];
  /** Субагент-анализатор (LLM). */
  analyzer: Subagent;
}

/** Выполняет команду /analyze. */
export async function runAnalyzeCommand(deps: AnalyzeCommandDeps): Promise<void> {
  const { io, accounts, analyzer } = deps;

  const criteria = await promptSearchCriteria(io);
  if (!criteria) {
    io.write('Анализ отменён.\n');
    return;
  }
  const searchCriteria = toSearchCriteria(criteria);

  const account = await promptAccount(io, accounts);
  if (!account) return;

  if (!(await ensureMailConnected(io, account))) return;

  const searchTool = getTool('mail.search');
  const fetchTool = getTool('mail.fetch');
  if (!searchTool || !fetchTool) {
    io.write('Тулы mail.search/mail.fetch не зарегистрированы.\n');
    return;
  }

  let searchResult: SearchResult;
  try {
    searchResult = (await searchTool.handler({
      login: account.login,
      criteria: searchCriteria,
    })) as SearchResult;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    io.write(`Ошибка поиска: ${msg}\n`);
    return;
  }

  if (!searchResult.messages || searchResult.messages.length === 0) {
    io.write('Ничего не найдено.\n');
    return;
  }

  // Выбор письма: 1 → сразу, >1 → показ 5 + запрос UID.
  let selectedUid: number;
  if (searchResult.messages.length === 1) {
    const msg = searchResult.messages[0];
    if (!msg) return;
    selectedUid = msg.uid;
  } else {
    io.write(formatMessageList(searchResult.messages.slice(0, 5)) + '\n');
    const uid = await promptUid(io, searchResult.messages);
    if (uid === null) {
      io.write('Анализ отменён.\n');
      return;
    }
    selectedUid = uid;
  }

  // Чтение письма + анализ через чистую функцию (переиспользуется вебом).
  io.write('Анализирую письмо...\n');
  try {
    const result = await runAnalyze({
      accountLogin: account.login,
      uid: selectedUid,
      fetchTool,
      analyzer,
    });
    io.write(result.analysis + '\n');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    io.write(`Ошибка анализа: ${msg}\n`);
  }
}
