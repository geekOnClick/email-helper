# Tasks

## 1. Контракт провайдера: `isConnectionUsable` + публичный `reconnect`

- [x] 1.1 В `src/tools/mail/mail-provider.ts` добавить в интерфейс `MailProvider` методы `isConnectionUsable(): boolean` и `reconnect(): Promise<void>` (с JSDoc: первый — читает `client.usable`, толерантен к `null`; второй — прозрачное переподключение без изменения учётных данных).
- [x] 1.2 В `src/tools/mail/providers/abstract-imap-provider.ts` реализовать `isConnectionUsable()`: `return this.client !== null && this.client.usable === true;` (без сетевых операций).
- [x] 1.3 В `abstract-imap-provider.ts` изменить видимость `reconnect()` с `protected` на `public` (тело метода без изменений: logout старого client + `tryConnect(this.strategy)`).

## 2. Retry для «подключение не установлено» (design D4)

- [x] 2.1 В `abstract-imap-provider.ts` `isConnectionError()` убрать исключение строки «подключение не установлено» (удалить `if (msg.includes('подключение не установлено')) return false;`). Теперь эта ошибка трактуется как connection-ошибка → подпадает под retry-цикл `runWithTimeoutAndRetry`.
- [x] 2.2 Проверить, что `requireClient()` при `this.client === null` по-прежнему бросает `ConnectError('подключение не установлено ...')` (сообщение сохраняется для диагностики; меняется только трактовка в retry).

## 3. Дефолт `MAIL_OP_MAX_RETRIES` 1 → 2 (design D3)

- [x] 3.1 В `src/config/schema.ts` изменить дефолт `MAIL_OP_MAX_RETRIES` с `.default(1)` на `.default(2)`.
- [x] 3.2 Проверить, что `MailOpOptions` в туллах (`mail.search`/`mail.fetch`/`mail.downloadAttachments`) берёт `maxRetries` из конфига (через `mailOpOptionsFromConfig` в `bootstrap.ts`) — новые дефолты применятся автоматически.

## 4. `ensureMailConnected` — проверка живости + прозрачное переподключение (design D2)

- [x] 4.1 В `src/transport/cli/commands/connect.ts` после `if (store.has(account.login)) return true;` — достать провайдер через `store.get(account.login)` и проверить `provider.isConnectionUsable()`.
- [x] 4.2 Если `isConnectionUsable()` = `true` — `return true` (как сейчас, операция без переподключения).
- [x] 4.3 Если `isConnectionUsable()` = `false` (мёртвый сокет) — вывести `Переподключение к <login>...`, вызвать `await provider.reconnect()`; при успехе `Подключено.\n` + `return true`; при ошибке — `Ошибка переподключения к <login>: <msg>\n` + `return false`.
- [x] 4.4 Если `store.has()` = `false` — текущий путь через тул `mail.connect` (без изменений).

## 5. Тесты — провайдер (D1, D2, D4)

- [x] 5.1 Тест `isConnectionUsable()`: `true` при активном client; `false` при `client === null`; `false` при `client.usable === false` (мок imapflow client с `usable: false`).
- [x] 5.2 Тест публичного `reconnect()`: при мёртвом client вызывает logout старого + новый `tryConnect`; `isConnectionUsable()` становится `true` после успеха; учётные данные `this.account` не меняются.
- [x] 5.3 Тест retry для «подключение не установлено»: операция падает с `requireClient()` (client=null), `maxRetries=1` → `runWithTimeoutAndRetry` тратит попытку на reconnect и повторяет; при успехе reconnect возвращает результат (раньше retry не срабатывал).
- [x] 5.4 Адаптация существующих тестов провайдера: метод `reconnect` стал публичным — обновить стабы/моки `MailProvider` (добавить `isConnectionUsable`/`reconnect`), если они это проверяют.

## 6. Тесты — `ensureMailConnected` (D2)

- [x] 6.1 Тест: сессия в store + `isConnectionUsable()=true` → `ensureMailConnected` возвращает `true` без переподключения (reconnect не вызывается).
- [x] 6.2 Тест: сессия в store + `isConnectionUsable()=false` → `ensureMailConnected` вызывает `provider.reconnect()`; при успехе выводит «Переподключение»/«Подключено» и возвращает `true`.
- [x] 6.3 Тест: сессия в store + `isConnectionUsable()=false` + `reconnect()` падает → `ensureMailConnected` выводит ошибку переподключения и возвращает `false`.
- [x] 6.4 Тест: сессии нет в store → `ensureMailConnected` вызывает тул `mail.connect` (текущий путь, без `isConnectionUsable`).

## 7. Тесты — конфиг (D3)

- [x] 7.1 Тест: `loadConfig({})` (без `MAIL_OP_MAX_RETRIES`) → `config.MAIL_OP_MAX_RETRIES === 2`.
- [x] 7.2 Тест: `loadConfig({ MAIL_OP_MAX_RETRIES: '3' })` → переопределение работает (3).

## 8. Финальные проверки

- [x] 8.1 `tsc --noEmit` — без ошибок.
- [x] 8.2 `eslint .` — без ошибок.
- [x] 8.3 `vitest run` — все тесты проходят (включая новые и адаптированные).
- [x] 8.4 `openspec validate mail-connection-self-healing` — валиден.
