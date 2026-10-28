# Proposal

## Why

Изменения `mail-connect` и `mail-search` (Фаза 1) закрыли подключение и поиск метаданных. Остался последний шаг доступа к содержимому: без чтения тел писем и скачивания вложений невозможны анализ (Фаза 2), индексация в векторную БД (Фаза 3) и работа пользователя с вложениями. Этот change вводит тулы `mail.fetch` (тело + заголовки + метаданные вложений) и `mail.downloadAttachments` (скачивание вложений в локальную папку с безопасными именами), завершая базовый доступ к почте Фазы 1.

## What Changes

- Новый тул `mail.fetch` — чтение одного письма по UID: текстовое тело (text/plain/html), заголовки, метаданные вложений (имя, размер, content-type), без записи на диск.
- Новый тул `mail.downloadAttachments` — скачивание вложений письма в локальную папку с безопасными именами (дезинфекция path traversal, уникальные имена при коллизиях).
- Доменные типы `EmailFull` (тело + вложения-метаданные), `AttachmentMeta`, `DownloadResult` в `src/types/email.ts`.
- Расширение `MailProvider`/`AbstractImapProvider`: методы `fetch(uid, folder)` и `downloadAttachments(uid, folder, targetDir)`.
- Использование `imapflow` `fetchAll` (bodyStructure+source для текста) и `downloadMany` (бинарные вложения).
- Утилита безопасных имён файлов `sanitizeFilename` + обеспечение каталога `ensureDir`.
- Юнит-тесты с моком IMAP; интеграционный gated-тест против Яндекс-ящика (скачать вложение с тестового письма).
- Обновление `skills/helper.md` — `mail.fetch`, `mail.downloadAttachments`.

## Capabilities

### New Capabilities

- `mail/attachments`: чтение содержимого письма (тело + метаданные вложений) и скачивание вложений в локальную папку с безопасными именами.

### Modified Capabilities

Нет — `mail/connection` (подключение) и `mail/search` (поиск метаданных) не меняются; этот change вводит самостоятельную capability доступа к содержимому, опираясь на активную сессию из `mail.connect` и UID из `mail.search`.

## Impact

- **Новый код:** `src/types/email.ts` (дополнение: `EmailFull`, `AttachmentMeta`, `DownloadResult`); расширение `MailProvider`/`AbstractImapProvider` (`fetch`, `downloadAttachments`) и `ImapClient` (download, downloadMany); `src/tools/mail/mail-fetch.tool.ts`, `src/tools/mail/mail-download-attachments.tool.ts`; `src/tools/mail/filename.ts` (sanitize), `src/tools/mail/attachments.ts` (extract from bodyStructure); регистрация тулов.
- **Без новых зависимостей** — imapflow (`download`/`downloadMany`/`fetchAll` с `source`/`bodyStructure`) уже установлен; `node:fs`/`node:path` — встроенные.
- **Файловая система:** `DOWNLOAD_DIR` (из конфига) — целевая папка вложений; подкаталог по письму/UID.
- **Внешние системы:** `imap.yandex.ru:993`, `outlook.office365.com:993` (через активную сессию).
- **Тесты:** мок IMAP для юнитов; gated-интеграция против Яндекс (письмо с вложением).
- **Не затрагивает:** отправку (Фаза 4), LLM-анализ (Фаза 2), векторную БД (Фаза 3).
- **Новые спеки:** `mail/attachments` (new capability). Безопасность имён и хранения учтена в спеке.