/**
 * Команда /analyze-attachments: поиск письма, анализ его вложений с саммари
 * (change cli-smart-commands, design D3).
 *
 * Поток: мастер критериев → поиск писем → выбор UID (1 → сразу, >1 → показ 5 +
 * запрос UID) → скачивание вложений во ВРЕМЕННУЮ папку (os.tmpdir() + уникальный
 * поддиректорий, НЕ системная ~/Загрузки) через `mail.downloadAttachments` →
 * извлечение текста (`extractAttachmentText`) для каждого файла → сборка
 * инструкции → субагент-анализатор → вывод саммари каждого вложения → удаление
 * временной папки в `finally` (ВСЕГДА: при успехе и при ошибке).
 *
 * Тулы `mail.search`/`mail.downloadAttachments` и спеки `mail/*` НЕ меняются.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { ConsoleIO } from '../io.js';
import { promptSearchCriteria, promptAccount, promptUid, toSearchCriteria } from '../prompts.js';
import { ensureMailConnected } from './connect.js';
import { formatMessageList } from '../format.js';
import { getTool } from '../../../tools/registry.js';
import { extractAttachmentText } from './attachment-text.js';
import type { MailAccount } from '../../../tools/mail/types.js';
import type { Subagent } from '../../../agents/subagent.js';
import type { SearchResult, DownloadResult } from '../../../types/email.js';

/** Зависимости команды /analyze-attachments. */
export interface AnalyzeAttachmentsCommandDeps {
  /** Ввод/вывод. */
  io: ConsoleIO;
  /** Настроенные аккаунты. */
  accounts: MailAccount[];
  /** Субагент-анализатор (LLM). */
  analyzer: Subagent;
  /** Базовая папка для временных файлов (по умолчанию — os.tmpdir()). */
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

  // Временная папка: os.tmpdir() + уникальный поддиректорий.
  const baseTmp = deps.tmpDir ?? os.tmpdir();
  const tmpDir = path.join(baseTmp, `email-helper-attachments-${Date.now()}-${process.pid}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  let result: DownloadResult;
  try {
    result = (await downloadTool.handler({
      login: account.login,
      uid: selectedUid,
      targetDir: tmpDir,
    })) as DownloadResult;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    io.write(`Ошибка скачивания: ${msg}\n`);
    await cleanupDir(tmpDir);
    return;
  }

  if (!result.paths || result.paths.length === 0) {
    io.write('Письмо не содержит вложений.\n');
    await cleanupDir(tmpDir);
    return;
  }

  // Извлечение текста + сборка инструкции в finally-безопасном блоке.
  try {
    io.write(`Скачано вложений: ${result.paths.length}. Анализирую...\n`);

    const extracted = [];
    for (const filePath of result.paths) {
      const r = await extractAttachmentText(filePath);
      extracted.push(r);
    }

    const supported = extracted.filter((e) => !e.skipped);
    const skipped = extracted.filter((e) => e.skipped);

    if (supported.length === 0) {
      io.write('Все вложения — неподдерживаемые форматы (анализ невозможен).\n');
      for (const s of skipped) {
        io.write(`  ${s.filename}: ${s.reason ?? 'пропуск'}\n`);
      }
      return;
    }

    // Сборка инструкции для анализатора.
    const parts: string[] = [
      'Проанализируй следующие вложения письма. Для каждого дай краткое саммари содержимого.',
      '',
    ];
    supported.forEach((e, i) => {
      parts.push(`--- Вложение ${i + 1}: ${e.filename} ---`);
      parts.push(e.text ?? '(текст недоступен)');
      parts.push('');
    });

    try {
      const summary = await analyzer.run(parts.join('\n'));
      io.write(summary + '\n');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      io.write(`Ошибка анализа: ${msg}\n`);
    }

    // Отметка пропущенных вложений.
    if (skipped.length > 0) {
      io.write('\nНе проанализировано (неподдерживаемый формат):\n');
      for (const s of skipped) {
        io.write(`  ${s.filename}: ${s.reason ?? 'пропуск'}\n`);
      }
    }
  } finally {
    // Удаление временных файлов — ВСЕГДА (при успехе и при ошибке).
    await cleanupDir(tmpDir);
  }
}

/** Рекурсивно удаляет каталог (содержимое + сам каталог). */
async function cleanupDir(dir: string): Promise<void> {
  try {
    await fs.promises.rm(dir, { recursive: true, force: true });
  } catch {
    // Ошибка удаления tmp — не роняем команду; ОС почистит при перезагрузке.
  }
}
