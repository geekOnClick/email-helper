import { basename, resolve, relative, extname, join } from 'node:path';
import { access } from 'node:fs/promises';
import { extFromContentType, KNOWN_EXTENSIONS } from './mime-extensions.js';

/** Максимальная длина имени файла (байт; FS-лимит обычно 255). */
const MAX_NAME_BYTES = 200;

/**
 * Восстанавливает корректное расширение имени файла, если оно отсутствует или слиплось.
 * Порядок (см. design.md D2):
 *  (a) имя уже оканчивается на `.ext` (точка + 1–5 букв) → как есть;
 *  (b) имя оканчивается известным расширением без точки (`...гxls`) → вставить точку;
 *  (c) иначе, если `contentType` известен → добавить `.ext` в конец;
 *  (d) иначе → как есть (не выдумывать).
 *
 * Выполняется ДО `sanitizeFilename`/`uniqueFilename`, чтобы суффикс коллизии
 * добавлялся к имени с уже восстановленным расширением.
 */
export function ensureExtension(name: string, contentType?: string): string {
  if (!name) return name;

  // (a) уже есть корректное расширение: точка + 1–5 букв в конце
  if (/\.[A-Za-z0-9]{1,5}$/.test(name)) {
    return name;
  }

  const lower = name.toLowerCase();

  // (b) слипшееся расширение: имя заканчивается известным расширением без точки.
  // Сортировка KNOWN_EXTENSIONS по убыванию длины гарантирует, что `xlsx` проверится раньше `xls`.
  for (const ext of KNOWN_EXTENSIONS) {
    if (lower.endsWith(ext)) {
      const before = name.slice(0, name.length - ext.length);
      // точка уже стоит? тогда это случай (a), но регекс (a) требует буквенно-цифровую точку,
      // а здесь могла быть не-буква — вставляем точку только если перед расширением не точка.
      if (before.endsWith('.')) {
        return name;
      }
      return `${before}.${ext}`;
    }
  }

  // (c) нет расширения в имени, но известен content-type → добавляем расширение
  const ext = extFromContentType(contentType);
  if (ext) {
    return `${name}.${ext}`;
  }

  // (d) ничего не распознано — не выдумываем
  return name;
}

/**
 * Обеззараживает имя файла: убирает path-компоненты (`..`, `.`, разделители `/`/`\`),
 * обрезает длину. Возвращает безопасное имя без каталогов.
 *
 * ВАЖНО: вырезаем `..` только как path-сегмент (между разделителями или в начале/конце),
 * а NOT любые две подряд точки. Жадное `replace(/\.\./g, '')` калечит легитимные имена
 * с двойными точками внутри (напр. `...г..xls` → `...гxls`, потеря расширения).
 */
export function sanitizeFilename(name: string): string {
  // 1. basename — убираем каталоги (платформенный разделитель `/`)
  let clean = basename(name);
  // 2. вырезаем path-сегменты `..` и `.`, а также оставшиеся разделители `/` и `\`.
  //    Двойные точки ВНУТРИ сегмента (напр. `...г..xls`) сохраняются — это легитимное имя.
  clean = clean.split(/[\\/]/).filter((seg) => seg !== '..' && seg !== '.').join('');
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