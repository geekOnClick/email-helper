/**
 * Команда /analyze: найти и проанализировать письмо (change guided-commands).
 *
 * Собирает критерии, ищет письма, при нескольких совпадениях показывает
 * первые 5 и просит выбрать UID, читает письмо через mail.fetch и анализирует
 * его содержимое через субагента-анализатора (LLM).
 */
import type { ConsoleIO } from '../io.js';
import { promptSearchCriteria, promptAccount, promptUid } from '../prompts.js';
import { formatMessageList } from '../format.js';
import { getTool } from '../../../tools/registry.js';
import type { MailAccount } from '../../../tools/mail/types.js';
import type { Subagent } from '../../../agents/subagent.js';
import type { SearchResult, EmailFull } from '../../../types/email.js';

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

  const account = await promptAccount(io, accounts);
  if (!account) return;

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
      criteria,
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

  // Чтение письма.
  let email: EmailFull;
  try {
    email = (await fetchTool.handler({
      login: account.login,
      uid: selectedUid,
    })) as EmailFull;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    io.write(`Ошибка чтения письма: ${msg}\n`);
    return;
  }

  // Анализ через субагента-анализатора.
  const from = email.from?.address ?? 'неизвестно';
  const date = email.date.toISOString().slice(0, 10);
  const instruction = [
    `Проанализируй письмо.`,
    `Тема: ${email.subject}`,
    `Отправитель: ${from}`,
    `Дата: ${date}`,
    `Тело письма:`,
    email.body,
  ].join('\n');

  io.write('Анализирую письмо...\n');
  try {
    const summary = await analyzer.run(instruction);
    io.write(summary + '\n');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    io.write(`Ошибка анализа: ${msg}\n`);
  }
}
