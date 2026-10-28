# Tasks

## 1. Зависимость и типы

- [x] 1.1 Установить `mailparser` (runtime): `npm i mailparser`. Проверка: `npm install` без ошибок, `package.json` содержит зависимость, `node -e "require('mailparser')"` резолвится.
- [x] 1.2 Дополнить `src/types/email.ts`: `AttachmentMeta` (`{part, filename, contentType, size?}`), `EmailFull` (расширяет `EmailMessage` + `{body: string, hasBody: boolean, attachments: AttachmentMeta[], headers?: Record<string,string>}`), `DownloadResult` (`{paths: string[], folder, uid}`). Проверка: `npx tsc --noEmit` без ошибок; типы реэкспортированы из `src/types/index.ts`.

## 2. Утилиты: имена файлов и каталоги

- [x] 2.1 Реализовать `src/tools/mail/filename.ts`: `sanitizeFilename(name)` — basename, вырезание `..`, обрезка длины; `uniqueFilename(dir, name)` — проверка существования, суффикс `-N` при коллизии; `isInsideDir(target, dir)` — проверка path traversal через `path.resolve`+`relative`. Проверка: unit-тесты — `../etc/passwd`→`passwd`, коллизия → суффикс, path traversal заблокирован.
- [x] 2.2 Реализовать `src/tools/mail/fs.ts`: `ensureDir(dir)` через `fs.mkdir({recursive:true})`. Проверка: unit-тест — создаёт вложенный каталог, идемпотентен.

## 3. Извлечение метаданных вложений

- [x] 3.1 Реализовать `src/tools/mail/attachments.ts`: `extractAttachments(bodyStructure)` — рекурсивный обход `childNodes`, узлы с `disposition:'attachment'` или filename → `AttachmentMeta[]` (part, filename из parameters/dispositionParameters, contentType, size). Дефолтное имя `attachment-<part>`. Проверка: unit-тест — дерево с вложением → метаданные; без вложений → пустой массив.

## 4. Расширение MailProvider и ImapClient

- [x] 4.1 Расширить `ImapClient` в `src/tools/mail/types.ts`: добавить `download(range, part?, opts?)` и `downloadMany(range, parts[], opts?)`. Проверка: `npx tsc --noEmit`.
- [x] 4.2 Добавить методы `fetch(uid, folder?)` (`Promise<EmailFull>`) и `downloadAttachments(uid, folder?, targetDir, names?)` (`Promise<DownloadResult>`) в интерфейс `MailProvider`. Проверка: `npx tsc --noEmit`.
- [x] 4.3 Реализовать `fetch` в `AbstractImapProvider`: mailboxOpen(folder), fetchAll(uid, {uid, source, bodyStructure, envelope, internalDate, flags}), parse source через mailparser → text/plain/html, extractAttachments из bodyStructure, возврат `EmailFull`. redact в ошибках. Проверка: `npx tsc --noEmit`.
- [x] 4.4 Реализовать `downloadAttachments` в `AbstractImapProvider`: mailboxOpen, fetchAll bodyStructure → attachments, фильтр по names, downloadMany(uid, parts, {uid}), запись каждого через `sanitizeFilename`+`ensureDir`+`fs.writeFile`, проверка `isInsideDir`. Возврат `DownloadResult`. redact в ошибках. Проверка: `npx tsc --noEmit`.

## 5. Тулы mail.fetch и mail.downloadAttachments

- [x] 5.1 Реализовать `src/tools/mail/mail-fetch.tool.ts`: вход `login, uid, folder?`, требует сессию, вызывает `provider.fetch`, возвращает `EmailFull`. Проверка: `npx tsc --noEmit`.
- [x] 5.2 Реализовать `src/tools/mail/mail-download-attachments.tool.ts`: вход `login, uid, folder?, targetDir?, names?`, требует сессию, default targetDir=`DOWNLOAD_DIR`, вызывает `provider.downloadAttachments`, возвращает `DownloadResult`. Проверка: `npx tsc --noEmit`.
- [x] 5.3 Зарегистрировать тулы в `register-tools.ts`; обновить `skills/helper.md` — добавить `mail.fetch`, `mail.downloadAttachments`. Проверка: `skills/helper.md` содержит оба; `npx tsc --noEmit`.

## 6. Юнит-тесты (мок)

- [x] 6.1 Unit-тест `AbstractImapProvider.fetch`: письмо с text/plain, только text/html, без текста, метаданные вложений, redact ошибки, без сессии. Проверка: тесты зелёные.
- [x] 6.2 Unit-тест `AbstractImapProvider.downloadAttachments`: скачать одно, скачать все, sanitizeFilename (path traversal заблокирован), коллизия имён, ensureDir несуществующего каталога, redact. Проверка: тесты зелёные.
- [x] 6.3 Unit-тест тулов `mail.fetch`/`mail.downloadAttachments`: со сессией → результат; без сессии → ошибка. Проверка: тесты зелёные.
- [x] 6.4 Интеграционный gated-тест `tests/integration/yandex-attachments.test.ts`: подключение + поиск + fetch первого письма + (если есть вложение) скачивание. Проверка: без флага skipped; с флагом зелёный.

## 7. Финальная проверка

- [x] 7.1 `npm test` — зелёный. Проверка: exit 0.
- [x] 7.2 `npx tsc --noEmit` — без ошибок. Проверка: exit 0.
- [x] 7.3 `npm run lint` — без ошибок. Проверка: exit 0.
- [x] 7.4 `openspec validate mail-attachments --strict` — проходит. Проверка: exit 0.

## Workflow follow-up

- После проверки — запустить `/opsx-archive` для зашивания change и обновления основного спека `mail/attachments`.