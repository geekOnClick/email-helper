# Tasks: mail-attachment-extension-fix

## 1. Карта MIME → расширение

- [x] 1.1. Создать модуль `src/tools/mail/mime-extensions.ts`: экспортировать `extFromContentType(contentType?: string): string | undefined` и карту известных MIME-типов (минимум: `application/vnd.ms-excel`→`xls`, `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`→`xlsx`, `application/msword`→`doc`, `application/vnd.openxmlformats-officedocument.wordprocessingml.document`→`docx`, `application/vnd.ms-powerpoint`→`ppt`, `application/vnd.openxmlformats-officedocument.presentationml.presentation`→`pptx`, `application/pdf`→`pdf`). Нормализовать вход (lowercase, trim, обрезать по `;` для параметров вроде `; charset=...`).
- [x] 1.2. Unit-тесты для `extFromContentType` (`tests/mime-extensions.test.ts`): известные типы → корректное расширение; тип с параметром charset → расширение; неизвестный тип → `undefined`; пустой/`undefined` → `undefined`; регистронезависимость.

## 2. Хелпер восстановления расширения

- [x] 2.1. В `src/tools/mail/filename.ts` добавить `ensureExtension(name: string, contentType?: string): string`: (a) если имя уже оканчивается на `.ext` (точка + 1–5 букв) — вернуть как есть; (b) иначе проверить окончание на известное расширение без точки (список из модуля mime-extensions + те же офисные) — вставить точку перед ним; (c) иначе, если `extFromContentType(contentType)` определён — добавить `.ext` в конец; (d) иначе — вернуть имя как есть.
- [x] 2.2. Unit-тесты для `ensureExtension` (`tests/filename-ensure-extension.test.ts` или расширить существующий `filename`-тест): `...гxls` → `...г.xls`; `report.pdf` → без изменений; `документ` + `application/pdf` → `документ.pdf`; `данные` + `application/octet-stream` → `данные`; `документ` + `undefined` → `документ`; `Счетxls` + `application/vnd.ms-excel` → `Счет.xls` (D2.2 приоритет над D2.3 — точка вставляется, а не добавляется второй `.xls`).
- [x] 2.3. Проверить, что `ensureExtension` не нарушает path-traversal: вход `../etc/passwd` → `ensureExtension` возвращает как есть (не распознаёт расширение), последующий `sanitizeFilename` убирает `..`.

## 3. Интеграция в скачивание

- [x] 3.1. В `src/tools/mail/providers/abstract-imap-provider.ts`, в `downloadAttachmentsAttempt`, заменить `const safeName = await uniqueFilename(absDir, att.filename)` на: `const rawName = dl.meta?.filename || att.filename;` → `const withExt = ensureExtension(rawName, dl.meta?.contentType);` → `const safeName = await uniqueFilename(absDir, withExt);`. Импортировать `ensureExtension`.
- [x] 3.2. Обновить типы: `dl.meta` уже типизирован как `DownloadMeta` (часть `DownloadManyPart`) — убедиться, что обращение `dl.meta?.filename`/`dl.meta?.contentType` типобезопасно (добавить опциональную навигацию, если `meta` может быть undefined по типу imapflow — в `DownloadManyPart.meta` поле обязательно, но защититься опционально).

## 4. Тесты скачивания

- [x] 4.1. Добавить тест в `tests/yandex-download.test.ts` (или `tests/mail-attachments-tools.test.ts`): мок `downloadMany` возвращает `{ meta: { filename: 'СчетНаПредоплату1-1292-2-30-2610 период-Ноябрь 2026 гxls', contentType: 'application/vnd.ms-excel' }, content: Buffer }`, `bodyStructure` → `att.filename = '...гxls'`; проверить, что итоговый файл сохранён как `...г.xls`.
- [x] 4.2. Добавить тест: `meta.filename = 'report.pdf'`, `meta.contentType = 'application/pdf'` → файл `report.pdf` (без изменений, регрессия для pdf).
- [x] 4.3. Добавить тест: `meta.filename` пуст/отсутствует, `att.filename = 'документ'`, `meta.contentType = 'application/pdf'` → файл `документ.pdf` (fallback имени + расширение из content-type).
- [x] 4.4. Добавить тест коллизии с восстановленным расширением: существует `Счет.xls`, новое вложение `Счетxls` (`application/vnd.ms-excel`) → `Счет-1.xls` (суффикс коллизии после восстановления расширения).

## 5. Валидация (первая итерация — ensureExtension/meta.filename)

- [x] 5.1. `npx tsc --noEmit` — без ошибок.
- [x] 5.2. `npx eslint src/tools/mail/filename.ts src/tools/mail/mime-extensions.ts src/tools/mail/providers/abstract-imap-provider.ts` — без замечаний.
- [x] 5.3. `npx vitest run` — все тесты (новые + существующие) зелёные; ни один существующий `filename`/`yandex-download`/`mail-attachments`-тест не сломан.
- [x] 5.4. `openspec validate mail-attachment-extension-fix --strict` — валиден.

## 6. Исправление `sanitizeFilename` (главный фикс бага)

Воспроизведено на реальном ящике: отправитель (Автозаводская ТЭЦ) присылает имя `Акт-...период-Август 2026 г..xls` (двойная точка перед `xls`), `meta.contentType = "application/octet-stream"`. `sanitizeFilename` через `replace(/\.\./g, '')` вырезает обе точки → файл сохраняется как `...гxls` (без расширения). Жадное вырезание `..` калечит легитимные двойные точки внутри имени.

- [x] 6.1. В `src/tools/mail/filename.ts` исправить `sanitizeFilename`: заменить жадный `clean = clean.replace(/\.\./g, '').replace(/[\\/]/g, '')` на path-component-aware вырезание `..` — вырезать `..` только как path-сегмент (между разделителями `/`/`\` или в начале/конце имени), а NOT удалять легитимные двойные точки внутри имени. Сохранить `basename()` (шаг 1) и вырезание разделителей `/`/`\`. Реализация: разбить имя на сегменты по `/`/`\`, отфильтровать сегменты `=== '..'`/`'.'`, пересобрать; либо эквивалент, прошедший тесты.
- [x] 6.2. Unit-тесты для `sanitizeFilename` (в `tests/filename-fs.test.ts`): главный регресс-тест `Акт-1292-2-30-2608 период-Август 2026 г..xls` → `Акт-1292-2-30-2608 период-Август 2026 г..xls` (двойная точка сохранена); `../../etc/passwd` → `passwd` (path-traversal обеззаражен); `..\..\windows\system32` → `windowssystem32` (обратные слеши); `...` → `attachment` (только точки → дефолт); `report.pdf` → `report.pdf` (без изменений).
- [x] 6.3. Добавить интеграционный тест `downloadAttachments` с реальным именем с двойной точкой: мок `downloadMany` возвращает `meta.filename = 'Акт-...период-Август 2026 г..xls'`, `meta.contentType = 'application/octet-stream'` → файл сохранён как `...г..xls` (двойная точка сохранена, расширение не потеряно).

## 7. Финальная валидация

- [x] 7.1. `npx tsc --noEmit` — без ошибок.
- [x] 7.2. `npx eslint src/tools/mail/filename.ts` — без замечаний.
- [x] 7.3. `npx vitest run` — все тесты зелёные; главный регресс-тест (6.2) и интеграционный (6.3) проходят; ни один существующий тест не сломан.
- [x] 7.4. `openspec validate mail-attachment-extension-fix --strict` — валиден.
