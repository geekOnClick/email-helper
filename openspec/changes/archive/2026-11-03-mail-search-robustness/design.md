# Design: mail-search-robustness

## Context

См. `proposal.md` — Why. Кратко текущее состояние: `AbstractImapProvider` (`src/tools/mail/providers/abstract-imap-provider.ts`) держит один IMAP-клиент (`this.client`) на сессию. Методы `search`, `fetch`, `downloadAttachments`, `listFolders` работают поверх одного соединения и **ни один** не имеет ни таймаута, ни повтора при обрыве.

- `search` открывает папку, делает серверный `client.search(query, {uid:true})`; при пустом результате и текстовом критерии запускает `clientSideSearch` — `client.fetchAll('1:*', {envelope, internalDate, flags, size})` по всей папке с локальной фильтрацией через `matchesCriteria`. На ящике с 23 260 писем `fetchAll('1:*')` занимает ~час; после больших выборок соединение Яндекса обрывается (`Connection not available`), и **все** последующие операции (`search`/`fetch`/`downloadAttachments`/`listFolders`) на той же сессии падают каскадом.
- Серверный SEARCH Яндекса по длинным кириллическим `SUBJECT`-литералам (месяц+год, кавычки, «ё») ненадёжен — возвращает `0` даже при существующем письме, тогда как `SINCE`/`FROM`/`TO` обрабатываются корректно (подтверждено: `from=volgaenergo.ru` → 785, `since=2026-09-01` → тысячи, `subject="Платежные документы за Октябрь 2026"` → 0).
- `fetch`/`downloadAttachments` работают по одному UID (не `1:*`), поэтому сами по себе не зависают на объёме ящика — но они уязвимы к висящей IMAP-команде (тяжёлое вложение, тормозной Яндекс) и к обрыву соединения после большой выборки в `search`.

Конфигурация проекта — zod-схема `src/config/schema.ts`, загружается `loadConfigWithAccounts`, прокидывается в `composeAgents` → `registerMailConnectTools` → тулы. Тулы получают провайдера из `MailSessionStore` по `login` и вызывают `provider.search/fetch/downloadAttachments/listFolders` без опций.

## Goals / Non-Goals

**Goals:**

- `mail.search` не зависает на больших ящиках: client-side фолбэкк всегда сужен (надёжными критериями из запроса или `SINCE` по умолчанию), никогда `fetchAll('1:*')`.
- Серверный результат поиска всегда дофильтровывается локально (`matchesCriteria`) — нет ложного непустого набора от ненадёжного кириллического `SUBJECT`.
- Все IMAP-операции тулов (`mail.search`, `mail.fetch`, `mail.downloadAttachments`, `mail.listFolders`) ограничены таймаутом `MAIL_OP_TIMEOUT_MS` и ретраятся с переподключением при сетевом обрыве до `MAIL_OP_MAX_RETRIES`.
- Контракты тулов и возвращаемые типы (`SearchResult`, `EmailFull`, `DownloadResult`, `Folder[]`, `inputSchema`) не меняются.

**Non-Goals:**

- Не меняем `mail/connection` (переподключение используется, но через существующий lifecycle `dispose`+`connect`, без новых требований к connection).
- Не добавляем логирование MCP-вызовов тулов (observability) — отдельная задача.
- Не меняем критерии поиска, формат `EmailMessage`, тул `mail.send` (SMTP-путь), OAuth2, динамические креды.
- Не вводим OR-критерии или семантический поиск.

## Decisions

### D1: Сужение фолбэкка вместо `fetchAll('1:*')` (только search)

Последовательность в `search`:
1. Серверный поиск `client.search(buildSearchObject(criteria), {uid:true})` — со всеми критериями, включая `subject`.
2. Если результат пуст и есть текстовый критерий (`subject`/`from`/`to`) — фолбэкк: построить `narrowedQuery` из **надёжных** критериев запроса (`since`, `before`, `from`, `to`, флаги), **без** `subject`. Если надёжных критериев нет — добавить `since = now - MAIL_SEARCH_FALLBACK_DAYS` (по умолчанию 180). Выполнить серверный поиск `narrowedQuery` → `effectiveUids`. Метаданные фетчатся только по `slice` (D3), не по всем `effectiveUids`.
3. Если серверный поиск непуст — `effectiveUids = uids` (фолбэкк не нужен).

**Альтернатива:** cap по числу писем («последние N по seq»). Отвергнута: у Яндекса seq не упорядочен по `internalDate` (зафиксировано письмо 2022 года с максимальным seq), поэтому «последние N по seq» может не захватить свежие счета. `SINCE` серверно надёжен и даёт корректное сужение по дате.

**Альтернатива:** всегда фетчить все `effectiveUids` и фильтровать. Отвергнута: `effectiveUids` для `since=180 дней` на 23k-ящике ≈ тысячи UID → медленно. Фетч метаданных идёт только по `slice(offset, offset+limit)` (как сейчас), фолбэкк лишь заменяет источник `effectiveUids` с `1:*` на суженный серверный набор.

### D2: Всегда дофильтровывать серверный результат (только search)

После fetch метаданных по `slice` система ALWAYS применяет `matchesCriteria(msg, criteria)` ко всем полученным `EmailMessage` (не только при фолбэкке). Это отсекает ложные совпадения, когда Яндекс применил только `SINCE` и проигнорировал кириллический `SUBJECT`. `matchesCriteria` уже проверяет `subject`/`from`/`to` (case-insensitive substring), `since`/`before`, флаги — повторное применение к серверно-отфильтрованным полям идемпотентно.

**Тонкость:** `total` и `hasMore` считаются по `effectiveUids.length` (серверный/суженный набор), а не по числу прошедших локальный фильтр. Таким образом страница может содержать меньше `limit` сообщений, хотя `hasMore=true` (на следующих страницах могут быть совпадения). Это сохраняет существующий контракт пагинации по `offset` и не требует фетча всего суженного набора.

### D3: Общая механика «таймаут + retry с переподключением» для всех IMAP-операций

Вводится общий helper `runWithTimeoutAndRetry<T>(op: () => Promise<T>, opts): Promise<T>` в `AbstractImapProvider`, переиспользуемый в `search`, `fetch`, `downloadAttachments`, `listFolders`:

- **Таймаут:** одна попытка `op` оборачивается в `Promise.race([op, timeout])`, где `timeout` отклоняется через `opts.timeoutMs` (`MAIL_OP_TIMEOUT_MS`, по умолчанию 30000). При срабатывании таймаута система вызывает `await this.client?.logout().catch(()=>{})` чтобы разорвать висящую IMAP-команду imapflow (`Promise.race` сам по себе не отменяет underlying-вызов), и обнуляет `this.client` — последующий retry переподключится. Ошибка таймаута считается сетевым обрывом (D4) → попадает в retry-цикл.

- **Retry:** до `opts.maxRetries + 1` попыток. В catch определяется, является ли ошибка сетевым обрывом через `isConnectionError(err)` (D5). Если да и попытки остались — `await this.dispose()` (закрытие старой сессии, `this.client=null`, `this.account=null`... **но** для retry нужно сохранить аккаунт) → `await this.connect()` (новое подключение теми же кредами через существующий `tryConnect`) → повтор. Не-сетевые ошибки (например, невалидные критерии, `ConnectError` «подключение не установлено», «письмо N не найдено») выбрасываются сразу без retry. При исчерпании попыток — `ConnectError` с маскировкой секретов.

- **Сохранение аккаунта для retry:** `dispose()` обнуляет `this.account=null`. Для retry провайдер должен помнить аккаунт. Решение: `runWithTimeoutAndRetry` хранит локальный `const account = this.requireAccount()` **до** цикла и передаёт его в `connect()` через временный обход — либо `dispose` не вызывается, а делается мягкое `logout()+this.client=null` без обнуления `account` (оставляя `requireAccount` рабочим). Принимается **мягкий reconnect**: новый приватный метод `reconnect()` = `await this.client?.logout().catch(()=>{})` + `this.client=null` + `await this.tryConnect(this.strategy)` (без обнуления `this.account`). Таким образом `dispose()` (полное закрытие) не вызывается в retry; retry использует `reconnect()`.

**Применение:**
- `search`: `runWithTimeoutAndRetry(() => this.searchAttempt(criteria), {timeoutMs, maxRetries})`, где `searchAttempt` — серверный поиск + фолбэкк (D1) + fetch slice (D2) без своей логики таймаута/retry.
- `fetch`: `runWithTimeoutAndRetry(() => this.fetchAttempt(uid, folder), ...)`.
- `downloadAttachments`: `runWithTimeoutAndRetry(() => this.downloadAttempt(uid, targetDir, options), ...)`.
- `listFolders`: `runWithTimeoutAndRetry(() => this.listFoldersAttempt(), ...)`.

**Альтернатива:** `AbortController`/imapflow cancel — imapflow не поддерживает отмену команды; `logout` — единственный надёжный способ прервать висящий IMAP-запрос.

**Альтернатива:** вынести reconnect в `mail/connection` как общий middleware. Отвергнута — scope change ограничен capabilities `mail/search` + `mail/attachments`; механика реализуется внутри `AbstractImapProvider` (деталь реализации), переиспользуя существующий lifecycle без новых требований к connection.

### D4: Классификация сетевых ошибок `isConnectionError`

Helper `isConnectionError(err)` (подстроки сообщения, upper-case): `Connection not available`, `ECONNRESET`, `ENOTFOUND`, `ETIMEDOUT`, `socket hang up`, `IMAP connection`, `connection closed`, `read ECONNRESET`, `getaddrinfo ENOTFOUND`. Таймаут (D3) тоже классифицируется как connection-error (после `logout` соединение разорвано) → попадает в retry. Не-connection: `ConnectError` «подключение не установлено» (нет сессии — retry не поможет), «письмо N не найдено в ...» (логическая ошибка, не сеть), ошибки валидации.

**Тонкость:** `ConnectError` «подключение не установлено» означает `this.client === null` (сессия не создана/закрыта). Для retry нужен `reconnect()` — но если сессия не была создана изначально, reconnect сделает `tryConnect` и retry сработает. Поэтому «подключение не установлено» трактуем как connection-error → retry через `reconnect()`. Это безопасно: если креды невалидны, `tryConnect` выбросит auth-error (не connection) → retry прекратится.

### D5: Удаление `clientSideSearch` с `fetchAll('1:*')`

Существующий метод `clientSideSearch` (и его `fetchAll('1:*')`) удаляется; логика сужения (D1) и дофильтровки (D2) встраивается в `searchAttempt`. `hasTextCriteria` сохраняется как guard для входа в фолбэкк. `matchesCriteria` сохраняется без изменений (переиспользуется для D2).

### D6: Прокидывание опций через конфиг → тул → провайдер

- `ConfigSchema` (`src/config/schema.ts`): добавляются `MAIL_OP_TIMEOUT_MS` (`z.coerce.number().int().positive().default(30000)`), `MAIL_OP_MAX_RETRIES` (`z.coerce.number().int().nonnegative().default(1)`), `MAIL_SEARCH_FALLBACK_DAYS` (`z.coerce.number().int().positive().default(180)`).
- `RegisterToolsDeps` (`src/tools/mail/register-tools.ts`) получает `mailOpOptions?: MailOpOptions`; `composeAgents` передаёт `{ timeoutMs: config.MAIL_OP_TIMEOUT_MS, maxRetries: config.MAIL_OP_MAX_RETRIES, fallbackDays: config.MAIL_SEARCH_FALLBACK_DAYS }`.
- Все тулы (`createMailSearchTool`, `createMailFetchTool`, `createMailDownloadAttachmentsTool`, `createMailListFoldersTool`) пробрасывают `mailOpOptions` в вызовы провайдера: `provider.search(criteria, mailOpOptions)`, `provider.fetch(uid, folder, mailOpOptions)`, `provider.downloadAttachments(uid, targetDir, {...options, ...mailOpOptions})`, `provider.listFolders(mailOpOptions)`.
- `MailProvider`-методы получают опциональный параметр `options?: Partial<MailOpOptions>`; `AbstractImapProvider` читает `options` с дефолтами (на случай прямого вызова без опций, напр. в существующих тестах). `fallbackDays` используется только в `search`, `timeoutMs`/`maxRetries` — во всех операциях.

**Альтернатива:** хранить опины в самом провайдере при `mail.connect`. Отвергнута — провайдер создаётся в `mail.connect` без знания об op-опциях (это конфиг операций, не connection); per-call опции через тул чище и тестируемее.

## Risks / Trade-offs

- **[Поиск только по subject на большом ящике может возвращать пустые страницы при `hasMore=true`]** → D2: `total`/`hasMore` по суженному набору, страница фильтруется. Mitigation: клиент пагинируется (`offset += limit`), пока не соберёт нужные; таймаут `MAIL_OP_TIMEOUT_MS` ограничивает зависание одной страницы. Документировать в README, что для subject-only поиска лучше добавлять `from`/`since`.
- **[Таймаут прерывает logout'ом — соединение закрывается]** → D3+D4: после logout `this.client=null`; retry через `reconnect()` (без обнуления `account`) восстанавливает сессию. Если `MAIL_OP_MAX_RETRIES=0` — сессия помечается закрытой, последующий вызов любого тулa упадёт с «подключение не установлено» → трактуется как connection-error и ретраится через `reconnect()`. Mitigation: дефолт `MAX_RETRIES=1` даёт авто-восстановление; документировать.
- **[Сужение `SINCE` по умолчанию (180 дней) не найдёт старое письмо при subject-only]** → намеренный trade-off за bounded-поиск; `MAIL_SEARCH_FALLBACK_DAYS` настраивается, а серверный поиск по `subject` (шаг 1) всё равно ищет по всему ящику серверно — фолбэкк нужен только когда сервер вернул 0. Для заведомо старых писем вызывающий должен передать явный `since`.
- **[Определение «сетевого сбоя» по подстроке сообщения хрупко]** → Mitigation: список подстрок централизован в `isConnectionError` с unit-тестами; не-совпадение → ошибка выбрасывается без retry (безопасный fallback). Список покрывает зафиксированные реальные сообщения imapflow/Яндекса.
- **[imapflow `search` по `SUBJECT` с кириллицей иногда возвращает ложный непустой набор]** → D2 дофильтровка отсекает; наблюдаемое поведение — корректное число совпадений.
- **[Retry downloadAttachments может дважды скачать/перезаписать файл]** → retry происходит только при сетевом обрыве **до** успешной записи; если `downloadMany` упал посередине, `writeFile` не успел выполниться. При успешной записи и обрыве на следующем вложении — retry начнёт заново с `bodyStructure`, `uniqueFilename` обеспечит `Счет.pdf`/`Счет-1.pdf` без затирания (существующая механика разрешения коллизий). Risk: дубликаты при частично успешном retry. Mitigation: acceptable — лучше дубликат, чем потеря; документировать. (Альтернатива — idempotent retry по списку уже скачанных — отвергнута как over-engineering для текущего сценария.)
- **[`reconnect()` без `dispose()` оставляет `this.account` в памяти дольше]** → намеренно для retry; `dispose()` (полное закрытие, `account=null`) по-прежнему вызывается при `mail.connect` cleanup / `disposeAll` MCP-сервера. На retry-пути `account` нужен для `tryConnect`.

## Migration Plan

1. Обратно совместимо: новые env-переменные опциональны (zod-дефолты); существующие вызовы тулов работают. `provider.*()` без второго аргумента использует дефолты (для существующих тестов/прямых вызовов).
2. Порядок внедрения: (а) `ConfigSchema` + `.env.example`; (б) `MailOpOptions` тип + расширение сигнатур `MailProvider`/`AbstractImapProvider`; (в) `runWithTimeoutAndRetry` + `isConnectionError` + `reconnect` helper'ы (D3–D4); (г) `searchAttempt` (D1–D2), удаление `clientSideSearch` (D5); (д) обёртка `fetch`/`downloadAttachments`/`listFolders` в `runWithTimeoutAndRetry`; (е) `register-tools` + `composeAgents` проводка; (ж) тулы пробрасывают `mailOpOptions`.
3. Тесты: unit на `runWithTimeoutAndRetry`/`isConnectionError`/`reconnect` (мок-`ImapClient`); unit на `searchAttempt` (сужение, дофильтровка); unit на `fetch`/`downloadAttachments`/`listFolders` (таймаут, retry, успех без обрыва); регрессия существующих тестов.
4. `npm test`, `npx tsc --noEmit`, `npm run lint`, `openspec validate mail-search-robustness --strict`.
5. Откат: вернуть `clientSideSearch` с `fetchAll('1:*')`, убрать `runWithTimeoutAndRetry` из операций (или оставить helper, но не вызывать); вернуть старые сигнатуры без `options`; новые env-переменные оставить (не влияют).

## Open Questions

- Нет деферрабельных вопросов: подход определён согласованным scope (вариант A — расширить текущий change на `mail/attachments`).
