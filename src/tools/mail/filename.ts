import { basename, resolve, relative, extname, join } from 'node:path';
import { access } from 'node:fs/promises';

/** Максимальная длина имени файла (байт; FS-лимит обычно 255). */
const MAX_NAME_BYTES = 200;

/**
 * Обеззараживает имя файла: убирает path-компоненты, вырезает `..`,
 * обрезает длину. Возвращает безопасное имя без каталогов.
 */
export function sanitizeFilename(name: string): string {
  // 1. basename — убираем каталоги
  let clean = basename(name);
  // 2. вырезаем `..` (на случай обхода basename)
  clean = clean.replace(/\.\./g, '').replace(/[\\/]/g, '');
  // 3. пустое/только точки — дефолт
  if (!clean || /^\.+$/.test(clean)) {
    clean = 'attachment';
  }
  // 4. обрезаем по байтам, не разрезая расширение
  if (Buffer.byteLength(clean, 'utf8') > MAX_NAME_BYTES) {
    const ext = extname(clean);
    const stem = clean.slice(0, clean.length - ext.length);
    clean = `${stem.slice(0, MAX_NAME_BYTES - ext.length - 4)}${ext}`;
  }
  return clean;
}

/**
 * Проверяет, что `target` находится строго внутри `dir` (path traversal guard).
 */
export function isInsideDir(target: string, dir: string): boolean {
  const rel = relative(resolve(dir), resolve(target));
  return rel !== '' && !rel.startsWith('..') && !rel.includes(`..${sep()}`);
}

/** Возвращает разделитель путей (обёртка для мока в тестах). */
function sep(): string {
  // на Windows `\`, на POSIX `/`
  return process.platform === 'win32' ? '\\' : '/';
}

/**
 * Уникальное имя в каталоге: если существует, добавляет суффикс `-N` перед расширением.
 * Не создаёт файл — только проверяет существование.
 */
export async function uniqueFilename(dir: string, name: string): Promise<string> {
  const safe = sanitizeFilename(name);
  const ext = extname(safe);
  const stem = safe.slice(0, safe.length - ext.length);
  let candidate = safe;
  let n = 1;
  // проверяем существование
  while (await exists(join(dir, candidate))) {
    candidate = `${stem}-${n}${ext}`;
    n += 1;
    if (n > 1000) {
      // защита от бесконечного цикла
      candidate = `${stem}-${Date.now()}${ext}`;
      break;
    }
  }
  return candidate;
}

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}