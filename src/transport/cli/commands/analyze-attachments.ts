/**
 * Команда /analyze-attachments: поиск письма, анализ его вложений с саммари
 * (change cli-smart-commands, design D3).
 *
 * Тонкий CLI-адаптер (change web-interface, design D1): собирает критерии,
 * ищет письма, выбирает UID, вызывает чистую функцию `runAnalyzeAttachments`
 * (из transport/commands) и рендерит саммари. Доменная логика (скачивание +
 * извлечение текста + анализ + очистка tmp) переиспользуется вебом.
 */
import type { ConsoleIO } from '../io.js';
import { promptSearchCriteria, promptAccount, promptUid, toSearchCriteria } from '../prompts.js';
import { ensureMailConnected } from './connect.js';
import { formatMessageList } from '../format.js';
import { getTool } from '../../../tools/registry.js';
import { runAnalyzeAttachments } from '../../commands/analyze-attachments.js';
import type { MailAccount } from '../../../tools/mail/types.js';
import type { Subagent } from '../../../agents/subagent.js';
import type { SearchResult } from '../../../types/email.js';

/** Зависимости команды /analyze-attachments. */
export interface AnalyzeAttachmentsCommandDeps {
  /** Ввод/вывод. */
  io: ConsoleIO;
  /** Настроенные аккаунты. */
  accounts: MailAccount[];
  /** Субагент-анализатор (LLM). */
  analyzer: Subagent;
  /** Базовая папка для временных файлов (пробрасывается в чистую функцию). */
  tmpDir?: string;
}

/** Выполняет команду /analyze-attachments. */
export async function runAnalyzeAttachmentsCommand(
  deps: AnalyzeAttachmentsCommandDeps,
): Promise<void> {
  const { io, accounts, analyzer } = deps;

  const criteria = await promptSearchCriteria(io);
  if (!criteria) {
    io.write('Анализ вложений отменён.\n');
    return;
  }
  const searchCriteria = toSearchCriteria(criteria);

  const account = await promptAccount(io, accounts);
  if (!account) return;

  if (!(await ensureMailConnected(io, account))) return;

  const searchTool = getTool('mail.search');
  const downloadTool = getTool('mail.downloadAttachments');
  if (!searchTool || !downloadTool) {
    io.write('Тулы mail.search/mail.downloadAttachments не зарегистрированы.\n');
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
      io.write('Анализ вложений отменён.\n');
      return;
    }
    selectedUid = uid;
  }

  // Чистая функция: скачивание + извлечение текста + анализ + очистка tmp.
  try {
    const result = await runAnalyzeAttachments({
      accountLogin: account.login,
      uid: selectedUid,
      downloadTool,
      analyzer,
      tmpDir: deps.tmpDir,
    });

    if (result.attachmentCount === 0) {
      io.write('Письмо не содержит вложений.\n');
      return;
    }
    // Все неподдерживаемые — анализ невозможен.
    if (result.analysis === '' && result.analysisError === undefined && result.skipped.length > 0) {
      io.write('Все вложения — неподдерживаемые форматы (анализ невозможен).\n');
      for (const s of result.skipped) {
        io.write(`  ${s.filename}: ${s.reason ?? 'пропуск'}\n`);
      }
      return;
    }
    io.write(`Скачано вложений: ${result.attachmentCount}. Анализирую...\n`);
    if (result.analysisError !== undefined) {
      io.write(`Ошибка анализа: ${result.analysisError}\n`);
    } else {
      io.write(result.analysis + '\n');
    }

    if (result.skipped.length > 0) {
      io.write('\nНе проанализировано (неподдерживаемый формат):\n');
      for (const s of result.skipped) {
        io.write(`  ${s.filename}: ${s.reason ?? 'пропуск'}\n`);
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    io.write(`Ошибка анализа вложений: ${msg}\n`);
  }
}
