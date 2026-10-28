# Tasks

## 1. Зависимости и расширение конфигурации

- [x] 1.1 Установить `imapflow` (runtime) и `@types/imapflow` (dev): `npm i imapflow` + `npm i -D @types/imapflow`. Проверка: `npm install` без ошибок, `package.json` содержит зависимости, `node -e "require('imapflow')"` резолвится.
- [x] 1.2 Расширить `src/config/schema.ts`: добавить в `AccountSchema` опц. `authStrategy: z.enum(['basic','oauth2']).default('basic')`; добавить в `ConfigSchema` поля `MS_CLIENT_ID` (строка, default `''`), `MS_TENANT` (default `consumers`), `OAUTH_TOKEN_STORE_PATH` (default `./.tokens/oauth.json`). Проверка: `npx tsc --noEmit` без ошибок; unit-тест — `ConfigSchema.parse({...пустой env})` принимает новые дефолты, `AuthStrategy` из `AccountSchema` валидируется.
- [x] 1.3 Обновить `.env.example` новыми переменными (`AUTHSTRATEGY` пояснение в комментарии примера ACCOUNTS, `MS_CLIENT_ID`, `MS_TENANT`, `OAUTH_TOKEN_STORE_PATH`). Проверка: файл содержит все переменные, `git check-ignore -v .env` по-прежнему игнорируется.

## 2. Проверочный зонд Outlook basic-auth (риск 3.0)

- [x] 2.1 Реализовать `probeOutlookBasicAuth(account)` в `src/tools/mail/providers/outlook-probe.ts`: попытка `imapflow` connect+login к `outlook.office365.com:993`, возврат `{ works: boolean, error?: string }` (секреты в `error` не попадают). Проверка: unit-тест с моком `ImapFlow` — кейс `works=true` (логин успешен) и `works=false` (сервер отклонил auth) возвращают корректные значения; секрет не фигурирует в `error`.
- [x] 2.2 Интеграционный тест-хелпер gated: тест `tests/integration/outlook-basic-auth-probe.test.ts`, пропускается без `INTEGRATION_TEST=1`; с флагом — реальный зонд к Outlook-аккаунту из `.env`, результат логируется в консоль. Проверка: без env тест `skipped`; с env — тест завершается и печатает наблюдённый статус works/refused.
- [x] 2.3 Зафиксировать наблюдённый статус basic-auth: доп. заметка в `design.md` (раздел Open Questions → resolved/observation) и установить `authStrategy` для Outlook-аккаунта в `.env` (`basic` если работает, иначе `oauth2`). Проверка: `design.md` содержит результат пробы; `.env` обновлён (локально, в git не попадает).

## 3. Абстракция MailProvider и AuthStrategy

- [x] 3.1 Создать `src/tools/mail/types.ts`: типы `Folder` (`{name, path, delimiter, flags}`, `flags` массив строк), `MailAccount` (из расширенного `AccountSchema`), `AuthStrategyKind`, `ConnectionResult` (`{connected, accountId, provider}`), `IImapConnectionOptions`. Проверка: `npx tsc --noEmit` без ошибок; типы экспортируются.
- [x] 3.2 Определить интерфейсы `MailProvider` (`connect(): Promise<ConnectionResult>`, `listFolders(): Promise<Folder[]>`, `dispose(): Promise<void>`) и `AuthStrategy` (`getImapAuth(account): Promise<ImapAuth>`) в `src/tools/mail/mail-provider.ts`. Проверка: `npx tsc --noEmit` без ошибок.
- [x] 3.3 Реализовать `MailProviderFactory` в `src/tools/mail/providers/factory.ts`: по `provider` (`yandex`|`outlook`) + `authStrategy` возвращает нужный провайдер с нужной стратегией. Проверка: unit-тест — для `(yandex, basic)` → YandexMailProvider, `(outlook, basic)` → Outlook+basic, `(outlook, oauth2)` → Outlook+OAuth2.
- [x] 3.4 Написать документацию модуля: обновить заглушку `src/tools/mail/index.ts` (экспорт публичного API: `MailProvider`, `Folder`, `ConnectionResult`, `mailConnect`, `mailListFolders`). Проверка: `npx tsc --noEmit` без ошибок; импорт из `src/tools/mail` резолвится.

## 4. Реализация Яндекс-провайдера (basic)

- [x] 4.1 Реализовать `BasicAuthStrategy` в `src/tools/mail/providers/basic-auth.ts`: из аккаунта формирует `{ user: login, pass: password }`. Проверка: unit-тест — стратегия возвращает корректный объект для аккаунта.
- [x] 4.2 Реализовать `YandexMailProvider` в `src/tools/mail/providers/yandex.ts`: `imap.yandex.ru:993`, TLS, использует `BasicAuthStrategy`, открывает сессию, реализует `connect`/`listFolders`/`dispose`. Проверка: unit-тест с моком `ImapFlow` — `connect` возвращает `ConnectionResult{connected:true, provider:'yandex'}`, `listFolders` возвращает массив с `\Inbox`.
- [x] 4.3 Тесты ошибок Яндекс: неверный пароль → ошибка аутентификации (без секрета в сообщении); сервер недоступен → ошибка подключения с провайдером. Проверка: unit-тесты зелёные, assert отсутствия пароля в `error.message`.
- [x] 4.4 Интеграционный тест `tests/integration/yandex-connect.test.ts`: gated, реальное подключение к Яндекс-ящику + `listFolders` содержит `\Inbox`. Проверка: без `INTEGRATION_TEST=1` skipped; с флагом — зелёный.

## 5. Outlook-провайдер и OAuth2 device code flow

- [x] 5.1 Реализовать MS device code flow клиент `src/tools/mail/oauth/device-flow.ts`: `requestDeviceCode()` POST `https://login.microsoftonline.com/{tenant}/oauth2/v2.0/devicecode` (scope `offline_access https://outlook.office.com/IMAP.AccessAsUser.All`); `pollForToken(deviceCode)` polling POST `.../token` (grant_type `urn:ietf:params:oauth:grant-type:device_code`). Проверка: unit-тесты с моком fetch — успех (access+refresh), отказ, истёкший code, отмена.
- [x] 5.2 Реализовать `OAuthTokenStore` в `src/tools/mail/oauth/token-store.ts`: read/write `{accessToken, refreshToken, expiresAt}` в `OAUTH_TOKEN_STORE_PATH`, атомарная запись (temp+rename), права `0600`. Проверка: unit-тесты — write→read round-trip, отсутствующий токен → `null`, refresh-фоллбэк.
- [x] 5.3 Реализовать `OAuth2MsalStrategy` в `src/tools/mail/providers/oauth2-msal.ts`: возвращает `{ user, accessToken }` для XOAUTH2 — из store если валиден, иначе refresh, иначе device code flow (с выводом user_code/verification_uri). Проверка: unit-тест (мок store + мок imapflow) — валидный токен -> без flow; refresh-сценарий; первый раз -> инициирует flow.
- [x] 5.4 Реализовать `OutlookMailProvider` в `src/tools/mail/providers/outlook.ts`: `outlook.office365.com:993`, TLS, выбор стратегии по `authStrategy`; автоопределение — если `basic` и логин отклонён, фоллбэк к `oauth2`. Проверка: unit-тест (мок) — basic-успех, basic-отказ→переключение на oauth2, прямая `oauth2`-стратегия.
- [x] 5.5 Интеграционный тест `tests/integration/outlook-oauth2.test.ts`: gated, реальный device code flow первый раз (требует ручной авторизации пользователем в браузере — задокументировать в комментарии) или reuse refresh token из store. Проверка: без флага skipped; с флагом и наличие refresh-token в store — runs; первый интерактив запуск помечен как manual-verified.
- [x] 5.6 **(требует действий пользователя)** Зарегистрировать Azure-приложение (public client, без секрета) для получения `MS_CLIENT_ID`; занести в `.env`. Если используется известный public-test client_id MS SDK — задокументировать выбор. Проверка: `MS_CLIENT_ID` заполнен в `.env`; не закоммичен (в `.gitignore`).

## 6. Тулы mail.connect и mail.listFolders (каркас registry)

- [x] 6.1 Каркас `src/tools/registry.ts`: тип `ToolDef` (`{name, description, inputSchema, handler}`), `registerTool`, `getTool`, `listTools`. Проверка: `npx tsc --noEmit` без ошибок; unit-тест register/get/list.
- [x] 6.2 Реализовать тул `mail.connect` в `src/tools/mail/mail-connect.tool.ts`: вход — логин аккаунта, выбирает провайдер+стратегию через factory, возвращает `ConnectionResult`. Проверка: unit-тест (мок factory) — успешный connect и ошибка для неизвестного аккаунта.
- [x] 6.3 Реализовать тул `mail.listFolders` в `src/tools/mail/mail-list-folders.tool.ts`: требует активную сессию для логина, иначе ошибка «подключение не установлено». Проверка: unit-тест (мок) — со активной сессией возвращает папки, без — ошибка.
- [x] 6.4 Зарегистрировать тулы в registry; обновить `skills/helper.md` — добавить `mail.connect`, `mail.listFolders` в список доступных тулов помощника (Фаза 1, остальные позже). Проверка: `skills/helper.md` содержит оба тулa; `npx tsc --noEmit` без ошибок.

## 7. Безопасность учётных данных

- [x] 7.1 Добавить в `.gitignore`: `OAUTH_TOKEN_STORE_PATH`/`.tokens/` (если ещё нет). Проверка: `git check-ignore -v .tokens/oauth.json` показывает правило; `git status` чист от токенов.
- [x] 7.2 Утилита маскирования секретов в ошибках: `src/tools/mail/redact.ts` — функция, вырезающая password/accessToken/refreshToken из error-сообщений. Проверка: unit-тест — на входе ошибка с паролем, на выходе сообщение без пароля.
- [x] 7.3 Применить redact в error-путях провайдеров и стратегий. Проверка: повторно прогнать unit-тесты ошибок (4.3, 5.x) — assert отсутствия секретов в `error.message` зелёный.

## 8. Финальная проверка

- [x] 8.1 `npm test` — зелёный (все unit-тесты). Проверка: exit 0.
- [x] 8.2 `npx tsc --noEmit` — без ошибок. Проверка: exit 0.
- [x] 8.3 `npm run lint` — без ошибок. Проверка: exit 0.
- [x] 8.4 `openspec validate --change mail-connect` — проходит. Проверка: exit 0.

## Workflow follow-up

- После проверки — запустить `/opsx-archive` для зашивания change и обновления основного спека `mail/connection`.