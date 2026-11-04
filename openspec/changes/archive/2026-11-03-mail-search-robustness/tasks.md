# Tasks: mail-search-robustness

## 1. Конфигурация

- [x] 1.1 Добавить в `src/config/schema.ts` (zod `ConfigSchema`) три поля: `MAIL_OP_TIMEOUT_MS` (`z.coerce.number().int().positive().default(30000)`), `MAIL_OP_MAX_RETRIES` (`z.coerce.number().int().nonnegative().default(1)`), `MAIL_SEARCH_FALLBACK_DAYS` (`z.coerce.number().int().positive().default(180)`). Проверка: `npx tsc --noEmit` чисто; `loadConfig({})` возвращает дефолты.
- [x] 1.2 Документировать три новые переменные в `.env.example` (с дефолтами и комментарием: `MAIL_OP_*` — общий таймаут/повтор для всех IMAP-операций, `MAIL_SEARCH_FALLBACK_DAYS` — `SINCE` по умолчанию для subject-only поиска). Проверка: grep `.env.example` содержит все три имени.

## 2. Типы и контракт провайдера

- [x] 2.1 Ввести тип `MailOpOptions` (`{ timeoutMs: number; maxRetries: number; fallbackDays: number }`) в `src/types/email.ts` (рядом с `SearchCriteria`). Проверка: `tsc` чисто, тип экспортирован.
- [x] 2.2 Расширить сигнатуры `MailProvider` и `AbstractImapProvider`: `search(criteria, options?: Partial<MailOpOptions>)`, `fetch(uid, folder?, options?)`, `downloadAttachments(uid, targetDir, options?: { folder?; names? } & Partial<MailOpOptions>)`, `listFolders(options?)`. Проверка: `tsc` чисто.
- [x] 2.3 `AbstractImapProvider` — дефолты при отсутствии полей (`timeoutMs=30000`, `maxRetries=1`, `fallbackDays=180`), чтобы прямые вызовы без опций (существующие тесты) работали. Проверка: `tsc` чисто.

## 3. Общая механика таймаут + retry (AbstractImapProvider)

- [x] 3.1 Реализовать helper `isConnectionError(err)` (подстроки: `Connection not available`, `ECONNRESET`, `ENOTFOUND`, `ETIMEDOUT`, `socket hang up`, `IMAP connection`, `connection closed`, `read ECONNRESET`, `getaddrinfo ENOTFOUND`; таймаут тоже connection). Проверка: unit-тесты helper'а (true — для перечисленных; false — для `ConnectError «подключение не установлено»`, «письмо N не найдено», невалидные критерии).
- [x] 3.2 Реализовать приватный `reconnect()` = `await this.client?.logout().catch(()=>{})` + `this.client=null` + `await this.tryConnect(this.strategy)` **без** обнуления `this.account` (мягкий reconnect для retry). Проверка: unit-тест «reconnect закрывает старый client, открывает новый, account сохранён».
- [x] 3.3 Реализовать `runWithTimeoutAndRetry<T>(op, { timeoutMs, maxRetries, isConnectionError })`: одна попытка в `Promise.race([op, timeout(timeoutMs)])`; при таймауте — `await this.client?.logout().catch(()=>{})` + `this.client=null`; в catch при `isConnectionError` и оставшихся попытках — `await this.reconnect()` → повтор; не-connection — выброс; исчерпание — `ConnectError` с маскировкой через `redact`. Проверка: unit-тесты (таймаут → retry → успех; таймаут → исчерпание → ошибка; не-connection → без retry; успех → без переподключения).

## 4. Сужение фолбэкка и дофильтровка (search)

- [x] 4.1 Реализовать построение `narrowedQuery` (D1): из критериев запроса взять `since`/`before`/`from`/`to`/флаги, **без** `subject`; если надёжных нет — `since = now - fallbackDays`. Проверка: unit-тест «фолбэкк сужается SINCE по умолчанию при запросе только subject» (мок `search` второй раз вызывается с `since`).
- [x] 4.2 `searchAttempt`: серверный поиск по полному `query`; если пуст и `hasTextCriteria` — серверный поиск `narrowedQuery` → `effectiveUids`; иначе `effectiveUids = uids`. Проверка: unit-тест «серверный поиск по subject вернул 0 → фолбэкк сужается имеющимся from» (мок `search` второй раз с `from`, без `subject`).
- [x] 4.3 Удалить `clientSideSearch` (с `fetchAll('1:*')`) и его вызов; заменить на `searchAttempt`. Проверка: grep `fetchAll\('1:\*'\)` в `abstract-imap-provider.ts` — нет совпадений.
- [x] 4.4 После fetch метаданных по `slice` ALWAYS применять `messages = rows.map(toEmailMessage).filter(m => this.matchesCriteria(m, criteria))` (D2). Проверка: unit-тест «сервер вернул ложные совпадения по subject → дофильтровка отсекает лишние».
- [x] 4.5 Сохранить `total = effectiveUids.length`, `hasMore = offset+limit < total`, `slice = effectiveUids.slice(offset, offset+limit)` — без изменений контракта пагинации. Проверка: unit-тест «пагинация по offset сохранена: limit=2, offset=0 → 2 сообщения, hasMore=true при total>2».
- [x] 4.6 Обернуть `search` в `runWithTimeoutAndRetry(() => searchAttempt(criteria), { timeoutMs, maxRetries })`. Проверка: unit-тест «таймаут search → ConnectError о таймауте, без зависания»; «обрыв в search → reconnect + retry, успех».

## 5. Таймаут + retry для fetch / downloadAttachments / listFolders

- [x] 5.1 Вынести тела `fetch`/`downloadAttachments`/`listFolders` в `*Attempt`-методы (логика без таймаута/retry, как сейчас). Обернуть каждый в `runWithTimeoutAndRetry`. Проверка: `tsc` чисто; grep `runWithTimeoutAndRetry` — вызывается из `search`/`fetch`/`downloadAttachments`/`listFolders`.
- [x] 5.2 Unit-тест `downloadAttachments`: таймаут → `ConnectError`, без зависания (мок `downloadMany` висит > таймаута).
- [x] 5.3 Unit-тест `downloadAttachments`: `Connection not available` → `reconnect` + retry, успех на повторе (возвращены пути).
- [x] 5.4 Unit-тест `fetch`: таймаут → `ConnectError`; `Connection not available` → `reconnect` + retry, успех.
- [x] 5.5 Unit-тест `listFolders`: таймаут → `ConnectError`; `Connection not available` → `reconnect` + retry, успех.
- [x] 5.6 Unit-тест: успех `downloadAttachments`/`fetch`/`listFolders` без обрыва → `reconnect` НЕ вызывается (одна попытка). Проверка: счётчик `tryConnect`/`reconnect` = 1.
- [x] 5.7 Unit-тест: при retry `downloadAttachments` `uniqueFilename` не затирает уже скачанный файл (дубликат `Счет-1.pdf`, не перезапись). Проверка: pre-existing файл остался, retry создал `-N` суффикс.

## 6. Проводка конфига → тулы → провайдер

- [x] 6.1 `RegisterToolsDeps` (`src/tools/mail/register-tools.ts`) получает `mailOpOptions?: MailOpOptions`; пробрасывается в `createMailSearchTool`/`createMailFetchTool`/`createMailDownloadAttachmentsTool`/`createMailListFoldersTool`. Проверка: `tsc` чисто.
- [x] 6.2 Тулы пробрасывают `mailOpOptions` в вызовы провайдера (`provider.search(criteria, deps.mailOpOptions)` и т.д.). Проверка: unit-тесты тулов с мок-провайдером — `search`/`fetch`/`downloadAttachments`/`listFolders` вызваны с `mailOpOptions`.
- [x] 6.3 `composeAgents` (`src/agents/compose.ts`): передаёт `mailOpOptions: { timeoutMs: config.MAIL_OP_TIMEOUT_MS, maxRetries: config.MAIL_OP_MAX_RETRIES, fallbackDays: config.MAIL_SEARCH_FALLBACK_DAYS }` в `registerMailConnectTools`. Проверка: `tsc` чисто.
- [x] 6.4 Регрессия: `bootstrap` собирается с новым конфигом, MCP-сервер стартует. Проверка: smoke-тест `bootstrap({skipFalkor:true})` не падает с ошибкой конфига (tests/smoke.test.ts, cli-bootstrap.test.ts, compose-agents.test.ts, mcp-server.test.ts зелёные).

## 7. Финальные проверки

- [x] 7.1 `npm test` — все тесты проходят (включая новые), регрессий в существующих тестах поиска/fetch/download нет.
- [x] 7.2 `npx tsc --noEmit` — чисто.
- [x] 7.3 `npm run lint` — чисто.
- [x] 7.4 `openspec validate mail-search-robustness --strict` — valid.

## 8. Документация

- [x] 8.1 README: в разделе `mail.search` описать bounded-фолбэкк (поиск только по `subject` сужается `SINCE` = `MAIL_SEARCH_FALLBACK_DAYS`), рекомендацию передавать `from`/`since` для надёжности на больших ящиках.
- [x] 8.2 README: описать общий таймаут + retry/reconnect для всех IMAP-тулов (`mail.search`/`mail.fetch`/`mail.downloadAttachments`/`mail.listFolders`) и три env-переменные (`MAIL_OP_TIMEOUT_MS`, `MAIL_OP_MAX_RETRIES`, `MAIL_SEARCH_FALLBACK_DAYS`). Проверка: grep README содержит имена переменных.
