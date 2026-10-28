# Tasks

## 1. Доменные типы

- [x] 1.1 Создать `src/types/email.ts`: типы `EmailMessage` (`{uid, subject, from?:{name?,address}, to?:{name?,address}[], date, flags, size, folder}`), `SearchCriteria` (`{subject?, from?, to?, since?, before?, folder?, direction?:'incoming'|'outgoing', unseen?, flagged?, answered?, limit?, offset?}`), `SearchResult` (`{messages: EmailMessage[], total, hasMore}`). Проверка: `npx tsc --noEmit` без ошибок; типы экспортируются из `src/types/index.ts`.
- [x] 1.2 Реэкспортировать типы из `src/types/index.ts` (заменить заглушку). Проверка: импорт `EmailMessage` из `src/types` резолвится.

## 2. Расширение MailProvider и ImapClient

- [x] 2.1 Расширить интерфейс `ImapClient` в `types.ts`: добавить `mailboxOpen(path: string, opts?: {readOnly?: boolean}): Promise<unknown>` и `search(query: unknown, opts?: {uid?: boolean}): Promise<number[]>` и `fetchAll(range: unknown, query: unknown, opts?: {uid?: boolean}): Promise<unknown[]>`. Проверка: `npx tsc --noEmit`.
- [x] 2.2 Добавить метод `search(criteria: SearchCriteria): Promise<SearchResult>` в интерфейс `MailProvider` (`mail-provider.ts`). Проверка: `npx tsc --noEmit`.
- [x] 2.3 Реализовать `search` в `AbstractImapProvider`: открытие папки (по folder/direction), построение SearchObject, search→UID, fetchAll метаданных, limit/offset, hasMore. Без секретов в ошибках (redact). Проверка: `npx tsc --noEmit`.
- [x] 2.4 Хелпер разрешения папки: `resolveFolder(criteria, folders)` → путь; direction→\Inbox/\Sent через флаги. Проверка: unit-тест — incoming без folder → путь папки с \Inbox.

## 3. Маппинг писем

- [x] 3.1 Реализовать `toEmailMessage(row, folder)` в `src/tools/mail/` (маппинг FetchMessageObject imapflow → EmailMessage): subject, from, to, date, flags, size. Без body. Проверка: unit-тест — входной объект → EmailMessage с корректными полями.

## 4. Тул mail.search

- [x] 4.1 Реализовать `src/tools/mail/mail-search.tool.ts`: вход `login` + `SearchCriteria`, требует активную сессию, вызывает `provider.search`, возвращает `SearchResult`. Проверка: `npx tsc --noEmit`.
- [x] 4.2 Зарегистрировать тул `mail.search` в `register-tools.ts`; обновить `skills/helper.md` — добавить `mail.search`. Проверка: `skills/helper.md` содержит `mail.search`; `npx tsc --noEmit`.

## 5. Юнит-тесты (мок)

- [x] 5.1 Unit-тест `AbstractImapProvider.search`: found по теме (uids→fetch), empty, limit/hasMore, направление incoming/outgoing, явная папка приоритет, флаг unseen. Проверка: тесты зелёные.
- [x] 5.2 Unit-тест тулa `mail.search`: со сессией → метаданные; без сессии → ошибка. Проверка: тесты зелёные.
- [x] 5.3 Тест redact в ошибках поиска (пароль не фигурирует). Проверка: assert зелёный.
- [x] 5.4 Интеграционный gated-тест `tests/integration/yandex-search.test.ts`: подключение + поиск по теме тестового письма (тема из теста pre-existing, или `INBOX all` если письмо есть). Проверка: без флага skipped; с флагом зелёный (использует `mail.connect`+`mail.search`).

## 6. Финальная проверка

- [x] 6.1 `npm test` — зелёный. Проверка: exit 0.
- [x] 6.2 `npx tsc --noEmit` — без ошибок. Проверка: exit 0.
- [x] 6.3 `npm run lint` — без ошибок. Проверка: exit 0.
- [x] 6.4 `openspec validate mail-search --strict` — проходит. Проверка: exit 0.

## Workflow follow-up

- После проверки — запустить `/opsx-archive` для зашивания change и обновления основного спека `mail/search`.