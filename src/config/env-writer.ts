/**
 * Атомарная запись массива `ACCOUNTS` в файл `.env` (change mcp-env-account-credentials).
 *
 * Построчный разбор `.env`: строка `ACCOUNTS=...` заменяется на
 * `ACCOUNTS="<json>"` (значение в двойных кавычках, чтобы `#`/пробелы внутри
 * JSON-значения не трактовались dotenv как комментарий/обрезка). Комментарии (`#...`)
 * и прочие переменные сохраняются без изменений построчно. Если строки `ACCOUNTS` нет —
 * она добавляется в конец файла. Если файла нет — создаётся.
 *
 * Запись атомарна: temp-файл → `chmod 0o600` → `rename` (как `OAuthTokenStore`), чтобы
 * сбой диска не оставил частично записанный `.env`.
 */
import { mkdir, readFile, writeFile, rename, chmod, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { MailAccount } from '../tools/mail/types.js';

/** Имя переменной окружения с массивом аккаунтов. */
const ACCOUNTS_KEY = 'ACCOUNTS';

/**
 * Записывает массив аккаунтов в `ACCOUNTS` файла `.env` по пути `envPath`.
 * Атомарно: temp + chmod 0o600 + rename.
 *
 * @param envPath Путь к `.env`.
 * @param accounts Аккаунты для сериализации (JSON.stringify компактно).
 */
export async function updateAccountsInEnv(
  envPath: string,
  accounts: MailAccount[],
): Promise<void> {
  const json = JSON.stringify(accounts);
  const quotedValue = `"${json}"`;

  const content = await readEnvOrEmpty(envPath);
  const updated = replaceOrAppendAccountsLine(content, quotedValue);

  await atomicWrite(envPath, updated);
}

/**
 * Заменяет строку `ACCOUNTS=...` (если есть) на `ACCOUNTS=<value>` или дописывает её в
 * конец. Возвращает обновлённое содержимое. Прочие строки сохраняются как есть.
 *
 * `value` уже содержит кавычки (напр. `"[...]"`).
 */
export function replaceOrAppendAccountsLine(envContent: string, value: string): string {
  const lines = envContent.split(/\r?\n/);
  let found = false;
  const out = lines.map((line) => {
    if (isAccountsLine(line)) {
      found = true;
      return `${ACCOUNTS_KEY}=${value}`;
    }
    return line;
  });
  if (!found) {
    // Если последняя строка непустая и без перевода — добавим пустую перед новой переменной.
    const lastIdx = out.length - 1;
    const lastLine = out[lastIdx];
    if (lastLine && lastLine.trim() !== '') {
      out.push('');
    }
    out.push(`${ACCOUNTS_KEY}=${value}`);
  }
  return out.join('\n');
}

/**
 * Определяет, является ли строка определением `ACCOUNTS` (ключ без учёта пробелов
 * вокруг `=`, не комментарий). Строка вида `  ACCOUNTS  = ... ` считается.
 */
export function isAccountsLine(line: string): boolean {
  // Пропускаем комментарии и пустые строки.
  const trimmed = line.trim();
  if (trimmed === '' || trimmed.startsWith('#')) return false;
  const eqIdx = line.indexOf('=');
  if (eqIdx === -1) return false;
  const key = line.slice(0, eqIdx).trim();
  return key === ACCOUNTS_KEY;
}

/** Читает `.env` как текст; при отсутствии файла возвращает пустую строку. */
async function readEnvOrEmpty(envPath: string): Promise<string> {
  try {
    return await readFile(envPath, 'utf8');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return '';
    throw err;
  }
}

/** Атомарная запись: temp → chmod 0o600 → rename. */
async function atomicWrite(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmp, content, 'utf8');
  try {
    await chmod(tmp, 0o600);
  } catch {
    // chmod может не сработать на некоторых FS; не блокируем запись
  }
  try {
    await rename(tmp, path);
  } catch {
    try {
      await unlink(tmp);
    } catch {
      // ignore
    }
    throw new Error(`не удалось записать ACCOUNTS в ${path}`);
  }
}
