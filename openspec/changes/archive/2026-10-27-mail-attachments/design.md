# Design

## Context

Изменения `mail-connect` (подключение + папки) и `mail-search` (поиск метаданных) заархивированы. `AbstractImapProvider` держит активную `ImapClient`-сессию с методами `mailboxOpen/list/search/fetchAll`. imapflow поддерживает `fetchAll(range, {source, bodyStructure, envelope})` (исходник rfc822 + дерево частей), `download(range, part, {uid})` (Stream), `downloadMany(range, parts[], {uid})` ({[part]: {content: Buffer, meta}}). `MessageStructureObject` рекурсивен: `disposition: 'attachment'`, `parameters: {filename}`, `type`, `size`. Мотивация — см. `proposal.md`. Конфиг имеет `DOWNLOAD_DIR`. Спеки `mail/connection`, `mail/search` не меняются — это отдельная capability `mail/attachments`.

## Goals / Non-Goals

**Goals:**

- Тул `mail.fetch` — тело (text/plain, иначе text/html, UTF-8) + метаданные вложений, без записи на диск.
- Тул `mail.downloadAttachments` — скачивание выбранных/всех вложений в локальный каталог с безопасными именами.
- `sanitizeFilename` (path traversal, длина, коллизии), `ensureDir`.
- Переиспользование `resolveFolder` (папка/направление), `redact` (секреты).

**Non-Goals:**

- Парсинг HTML в plain text, извлечение inline-картинок — позже (Фаза 2 анализ).
- Чтение тела вложений-документов (Word/PDF) — после Фазы 3.
- Кэширование скачанных тел/вложений — Фаза 8.

## Decisions

### D1. fetch через fetchAll с source+bodyStructure
Для одного UID: `mailboxOpen(folder, readOnly)` → `fetchAll(uid, {uid, source:true, bodyStructure:true, envelope:true, internalDate:true, flags:true}, {uid:true})`. `source` (Buffer rfc822) парсим для текста через лёгкий извлекатель (mailparser не тянем — см. D2). `bodyStructure` даёт дерево вложений → метаданные без тела.

### D2. Извлечение текста из rfc822 — mailparser
Нужен парсинг MIME для корректного извлечения text/plain/html и декодирования transfer-encoding (quoted-printable/base64). `mailparser` — стандарт, ESM-совместимый, активный. Добавить зависимость.
**Альтернатива:** ручной парсинг source Buffer — хрупко (boundary, CTE). Rejected.
**Альтернатива:** `download` каждой текстовой части по part из bodyStructure — больше запросов, сложнее. Rejected для текста (подойдёт для вложений).

### D3. Метаданные вложений из bodyStructure
Обход `MessageStructureObject.childNodes` рекурсивно; узлы с `disposition === 'attachment'` (или `dispositionParameters.filename`) → `AttachmentMeta {part, filename, contentType, size}`. Имя из `parameters.name` или `dispositionParameters.filename`.

### D4. downloadAttachments через downloadMany
`mailboxOpen(folder)` (read-write, т.к. download может требовать RW? — readOnly достаточно для чтения частей) → `downloadMany(uid, parts, {uid:true})` → `{[part]: {content: Buffer, meta}}`. Запись каждого в `targetDir/sanitizedFilename`. downloadMany возвращает Buffers (не Stream) — подходит для небольших вложений; для больших — позже `download` со Stream.

### D5. sanitizeFilename
1. basename (убрать каталоги): `path.basename`, плюс вырезать `..`.
2. обрезать до ~255 байт (FS-лимит).
3. коллизия: если существует, добавить `-N` перед расширением (`report-1.pdf`).
4. проверка резолвится внутри targetDir (против path traversal через symlink — используем `path.relative` и `path.resolve`).

### D6. ensureDir
`fs.mkdir(targetDir, {recursive:true})` + права по умолчанию. Переиспользуем существующий каркас — в Фазе 0 был `filesystem.ensureDir` в плане, но не реализован; добавим локально в `src/tools/mail/fs.ts`.

### D7. Расширение ImapClient-мока
Добавить `download(range, part?, opts?)` и `downloadMany(range, parts[], opts?)` в интерфейс `ImapClient`. Реальный ImapFlow уже имеет их; мок реализует.

### D8. Типы в src/types/email.ts
Дополнить: `AttachmentMeta {part, filename, contentType, size?}`, `EmailFull` (extends EmailMessage + `{body: string, hasBody: boolean, attachments: AttachmentMeta[]}`, `headers?: Record<string,string>}`), `DownloadResult {paths: string[], folder, uid}`.

### D9. redact в ошибках
Ошибки fetch/download оборачиваются через `redact` (как в search) — пароль и логин не фигурируют.

## Risks / Trade-offs

- **[Риск: mailparser — новая зависимость] → Mitigation: пин-версия, ESM-совместимость проверена; стандарт экосистемы.**
- **[Риск: большие вложения в downloadMany → память] Buffers в RAM. → Mitigation: для >~10MB добавить Stream-вариант через download() в будущей фазе; для тестовых писем достаточно.**
- **[Риск: имена вложений могут отсутствовать] (inline-части без filename). → Mitigation: дефолтное имя `attachment-<part>`.**
- **[Трейд-офф: readOnly mailboxOpen для download] imapflow download работает и в readOnly. Если сервер требует RW — fallback к RW.**

## Migration Plan

Greenfield-код поверх `mail-connect`/`mail-search`. Развёртывание:
1. Установить `mailparser`.
2. `src/types/email.ts` (дополнить), `src/tools/mail/fs.ts`, `src/tools/mail/filename.ts`, `src/tools/mail/attachments.ts` (extract from bodyStructure).
3. Расширение `MailProvider`/`AbstractImapProvider`/`ImapClient`.
4. Тулы `mail-fetch.tool.ts`, `mail-download-attachments.tool.ts`, регистрация, `skills/helper.md`.
5. Юнит-тесты + gated-интеграция.
6. `npm test`, `tsc`, `lint`, `openspec validate`.

Откат: удалить тулы и расширения; mailparser удалить.

## Open Questions

- Нет деферрабельных: imapflow/mailparser API известны, требования из спеки ясны.