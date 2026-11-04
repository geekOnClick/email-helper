/**
 * Карта известных MIME-типов → расширения файлов.
 * Используется для восстановления расширения сохраняемого вложения,
 * когда имя не содержит корректного расширения (слипшееся имя вида `...гxls`).
 */

/** MIME-тип (lowercase, без параметров) → расширение без точки. */
const MIME_TO_EXT: Record<string, string> = {
  // Excel
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  // Word
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  // PowerPoint
  'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  // Прочие офисные/текстовые
  'application/pdf': 'pdf',
  'text/csv': 'csv',
  'application/csv': 'csv',
  'application/rtf': 'rtf',
  'application/ms-excel.sheet.macroEnabled.12': 'xlsm',
  'application/vnd.ms-word.document.macroEnabled.12': 'docm',
  'application/vnd.ms-powerpoint.presentation.macroEnabled.12': 'pptm',
  'application/zip': 'zip',
  'application/x-zip-compressed': 'zip',
  'text/plain': 'txt',
  'text/html': 'html',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/bmp': 'bmp',
  'image/tiff': 'tiff',
};

/**
 * Возвращает расширение (без точки) для известного MIME-типа или `undefined`.
 * Нормализует вход: lowercase, trim, обрезает по `;` (отбрасывая параметры вроде `; charset=...`).
 */
export function extFromContentType(contentType?: string): string | undefined {
  if (!contentType) return undefined;
  // берём часть до `;` (тип без параметров), нормализуем
  const base = contentType.split(';')[0]?.trim().toLowerCase();
  if (!base) return undefined;
  return MIME_TO_EXT[base];
}

/**
 * Список известных расширений (без точек, lowercase), распознаваемых в конце имени файла.
 * Используется хелпером `ensureExtension` для восстановления точки перед слипшимся расширением.
 */
export const KNOWN_EXTENSIONS: readonly string[] = Object.values(MIME_TO_EXT)
  // убираем дубликаты (несколько MIME могут давать одно расширение, напр. zip)
  .filter((v, i, arr) => arr.indexOf(v) === i)
  // сортируем по убыванию длины, чтобы `xlsx` проверялся раньше `xls`, `docx` раньше `doc`
  .sort((a, b) => b.length - a.length);
