/**
 * Команда /download: найти и скачать вложения письма (change guided-commands).
 *
 * Собирает критерии, ищет письма, при нескольких совпадениях показывает
 * первые 5 и просит выбрать UID, скачивает вложения через mail.downloadAttachments
 * в системную папку загрузок пользователя (~/Загрузки с fallback на ~/Downloads).
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { ConsoleIO } from '../io.js';
import { promptSearchCriteria, promptAccount, promptUid } from '../prompts.js';
import { ensureMailConnected } from './connect.js';
import { formatMessageList } from '../format.js';
import { getTool } from '../../../tools/registry.js';
import type { MailAccount } from '../../../tools/mail/types.js';
import type { SearchResult, DownloadResult } from '../../../types/email.js';

/** Зависимости команды /download. */
export interface DownloadCommandDeps {
  /** Ввод/вывод. */
  io: ConsoleIO;
  /** Настроенные аккаунты. */
  accounts: MailAccount[];
  /** Папка загрузки (по умолчанию — системная). */
  downloadDir?: string;
}

/** Выполняет команду /download. */
export async function runDownloadCommand(deps: DownloadCommandDeps): Promise<void> {
  const { io, accounts } = deps;

  const criteria = await promptSearchCriteria(io);
  if (!criteria) {
    io.write('Скачивание отменено.\n');
    return;
  }

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

  // Выбор письма.
  let selectedUid: number;
  if (searchResult.messages.length === 1) {
    const msg = searchResult.messages[0];
    if (!msg) return;
    selectedUid = msg.uid;
  } else {
    io.write(formatMessageList(searchResult.messages.slice(0, 5)) + '\n');
    const uid = await promptUid(io, searchResult.messages);
    if (uid === null) {
      io.write('Скачивание отменено.\n');
      return;
    }
    selectedUid = uid;
  }

  // Папка загрузок: deps.downloadDir или системная.
  const targetDir = deps.downloadDir ?? getDefaultDownloadDir();
  ensureDir(targetDir);

  let result: DownloadResult;
  try {
    result = (await downloadTool.handler({
      login: account.login,
      uid: selectedUid,
      targetDir,
    })) as DownloadResult;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    io.write(`Ошибка скачивания: ${msg}\n`);
    return;
  }

  if (!result.paths || result.paths.length === 0) {
    io.write('Письмо не содержит вложений.\n');
    return;
  }

  io.write(`Скачано файлов: ${result.paths.length}\n`);
  result.paths.forEach((p) => io.write(`  ${p}\n`));
}

/** Системная папка загрузок: ~/Загрузки (русская локаль), fallback ~/Downloads. */
export function getDefaultDownloadDir(): string {
  const home = os.homedir();
  const ru = path.join(home, 'Загрузки');
  const en = path.join(home, 'Downloads');
  return fs.existsSync(ru) ? ru : en;
}

/** Создаёт каталог, если не существует. */
function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}
