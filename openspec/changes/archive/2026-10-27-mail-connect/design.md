# Design

## Context

Фаза 0 завершена: есть TS-скелет, zod-схема конфига (`src/config/schema.ts`, с `AccountSchema` `{provider, login, password}`), заглушки `src/tools/mail/{index.ts,providers/index.ts}`. Ни одного тулового/почтового кода нет. Стек зафиксирован в `PLAN.md` (раздел 2): imapflow для IMAP (nodemailer — Фаза 4). Технический риск Outlook basic-auth (раздел 3.0) требует проверочного теста первой задачей. Аккаунты читаются из `ACCOUNTS` (JSON в `.env`) через `parseAccounts()` из `src/config/loader.ts`. Мотивация и охват — см. `proposal.md`.

## Goals / Non-Goals

**Goals:**

- Абстракция `MailProvider` + реализации Яндекс/Outlook, через которую работают `mail.connect` и `mail.listFolders`.
- Плавающая стратегия аутентификации (`basic` | `oauth2`) как plug-in: добавление стратегии не меняет код подключения.
- Рабочий OAuth2 device code flow для Microsoft identity v2.0, с персистентным refresh-token, чтобы интерактивная авторизация была однажды.
- Проверочный тест Outlook basic-auth как первый шаг реализации — определяет, нужна ли OAuth2-ветка в принципе для тестового ящика.
- Жизненный цикл IMAP-сессии без утечек соединений.

**Non-Goals:**

- Поиск писем, чтение тел/вложений, отправка — отдельные change'ы Фазы 1 (`mail-search`, `mail-attachments`) и Фаза 4 (`mail-send`).
- Регистрация полная в MCP/CLI — только программный API тулов, транспортные слои позже.
- Шифрование хранилища токенов на диске — plain JSON-файл вне git (решение по простоте; усиление в Фазе 8).

## Decisions

### D1. imapflow как IMAP-клиент
**Почему:** ESM-совместимый, активный, нативная поддержка TLS, SASL XOAUTH2, обещания/async. Уже зафиксирован в `PLAN.md`. Альтернатива `imapflow-совместимый` ручной TLS over socket — слишком низкоуровнево и хрупко.
**Альтернативы рассмотрены:** `imap-simple` (CJS, обёртка над `node-imap`, мертвее) — rejected.

### D2. Стратегия аутентификации как интерфейс (Strategy pattern)
Интерфейс `AuthStrategy` с методом `getImapConfig(account): ImapConfigPart`. Реализации: `BasicAuthStrategy`, `OAuth2MsalStrategy`. `MailProvider` принимает стратегию в конструктор (DI), не знает деталей. Добавление стратегии = +1 реализация `AuthStrategy`, `MailProvider` неизменен. Это закрывает требование спеки «добавление стратегии без переписывания логики».

### D3. Проверка Outlook basic-auth = задача 1, детерминированная
Реализуется минимальный зонд: попытка IMAP-LOGIIN к `outlook.office365.com:993` с логином/паролём. Результат фиксирует выбор стратегии **для данного аккаунта** в `.env`/token store. Зонд оформлен как отдельная функция `probeOutlookBasicAuth(account)`, вызываемая из интеграционного теста (gated) и как runtime-фолбэк при первой неудаче basic.
**Почему первой задачей:** рискованность (раздел 3.0) блокирует решение «нужен ли OAuth2 вообще»; ответ определяет объём работы.

### D4. OAuth2 device code flow против `consumers` tenant
**Endpoint:** `https://login.microsoftonline.com/consumers/oauth2/v2.0/`. Личные `@outlook.com`-аккаунты → tenant `consumers`. Device code flow: POST `/devicecode` → получить `device_code`, `user_code`, `verification_uri`; вывод пользователю; поллинг POST `/token` до `grant_type=urn:ietf:params:oauth:grant-type:device_code`. Скоуп `offline_access https://outlook.office.com/IMAP.AccessAsUser.All`. `MS_CLIENT_ID` — public-клиент (без секрета), регистрируется в Azure portal или используется хорошоизвестный.
**Альтернативы рассмотрены:** authorization code flow (требует redirect URL и локального HTTP-сервера — лишний CI-фрикшн для CLI-агента) — rejected; roPC (resource owner password credentials) — Microsoft deprecated для личных аккаунтов, пароль напрямую — rejected.

### D5. XOAUTH2 для IMAP после получения access token
imapflow поддерживает `oauth2: { user, accessToken }` (или provider-функцию). Передаём `user = login`, `accessToken` из MS-ответа. Это и есть стратегия `oauth2` поверх imapflow.

### D6. Token store — отдельный локальный JSON-файл
`OAUTH_TOKEN_STORE_PATH` (default `./.tokens/oauth.json`). Структура: `{ "<account-login>": { accessToken, refreshToken, expiresAt } }`. Файл + каталог добавляются в `.gitignore`. Чтение/запись — `OAuthTokenStore` с блокировкой на запись (однопоточный агент, достаточно атомарной записи через temp+rename).
**Альтернативы:** keytar (OS keychain) — encore-нативная зависимость, усложняет Docker/Linux headless — отложено в Фазу 8.

### D7. Жизненный цикл сессии — явный connect/dispose
`MailProvider.connect()` открывает IMAP-клиент и хранит его; `mail.connect` tool возвращает `ConnectionResult` (`{ connected: true, accountId, provider }`). Повторный connect к тому же аккаунту переиспользует или переоткрывает сессию (определяется в реализации, но без утечек). `dispose()` гарантированно закрывает. Для безопасности операций (`mail.search` и далее, будущие change’ы) провайдер обязует активную сессию.

### D8. Расширение ConfigSchema
`AccountSchema` получает опц. `authStrategy: 'basic' | 'oauth2'` (default `basic`). Добавить `MS_CLIENT_ID`, `MS_TENANT` (default `consumers`), `OAUTH_TOKEN_STORE_PATH` (default `./.tokens/oauth.json`). `authStrategy` влияет на выбор `AuthStrategy` в factory.

### D9. Тестирование: мок IMAP + gated-интеграция
Юнит-тесты мокают `imapflow.ImapFlow` (inject интерфейс `IImapConnection`) — проверяют стратегии, ошибки, lifecycle. Интеграционный тест против реальных ящиков включается переменной `INTEGRATION_TEST=1` и читает аккаунты из `.env`; без неё skipped. Проверочный зонд Outlook basic-auth — часть интеграционного теста.

## Risks / Trade-offs

- **[Риск: Outlook basic-auth может частично работать, но Microsoft отключит позже]** → Mitigation: архитектура `oauth2` готова сразу; `authStrategy` переключается в конфиге без переделки. Записать наблюдённый статус в design/tasks по итогам пробы.
- **[Риск: device code flow требует ручной авторизации в браузере один раз]** → Mitigation: refresh token персистится; интерактивный шаг только первый раз или после отзыва. Для headless/CI — документировать.
- **[Риск: скоуп `IMAP.AccessAsUser.All` требует admin consent в M365 tenant]** → Mitigation: tenant `consumers` для личных аккаунтов не требует admin consent; если потребуется рабочий аккаунт — отдельная задача. Для личного `@outlook.com` из `agent-accounts.txt` достаточно.
- **[Риск: токены на диске в открытом виде]** → Mitigation: файл вне git (`OAUTH_TOKEN_STORE_PATH` в `.gitignore`), права `0600`. Усиление шифрованием — Фаза 8 (hardening).
- **[Трейд-офф: imapflow держит одно соединение на сессию vs пул]** → Один клиент на аккаунт приемлем для помощника (рутина, не высокая нагрузка); пул — Фаза 8 при необходимости.
- **[Риск: `MS_CLIENT_ID` — нужно зарегистрировать приложение в Azure]** → Mitigation: регистрация — ручной шаг пользователя; гайд в `.env.example`/README. На время имплементации можно использовать public-тестовый client_id из SDK MS, если подходит.

## Migration Plan

Greenfield-код для почты — миграции нет. Развёртывание:

1. Установить зависимости: `imapflow`, `@types/imapflow` (dev).
2. Заполнить `.env` (аккаунты из `agent-accounts.txt`, при необходимости `MS_CLIENT_ID`, `MS_TENANT`).
3. Тест: `npm test` (юнит-моки зелёные).
4. Интеграция: `INTEGRATION_TEST=1 npm test` — провека Яндекс-подключения и зонда Outlook basic-auth.
5. По результатам зонда: зафиксировать `authStrategy` для Outlook-аккаунта в `.env`.

Откат: удалить файлы `src/tools/mail/providers/{yandex,outlook}.ts`, `imap-client.ts`, `oauth/*`, откатить изменения `ConfigSchema` (просто убрать новые поля — обратно-совместимо, т.к. поля опц.). 

## Open Questions

- **Регистрация Azure-приложения для `MS_CLIENT_ID`:** — **resolved (task 5.6).** Для личных `@outlook.com`-аккаунтов использован известный public client_id Thunderbird (`9e5f94bc-e8a4-4e73-b8be-63364c29d753`), tenant `consumers`, scope `https://outlook.office.com/IMAP.AccessAsUser.All offline_access`. Microsoft принимает его для device code flow с личными аккаунтами; device code flow + refresh token проверены end-to-end (тест 5.5 зелёный). Регистрация собственного Azure-приложения опциональна на будущее (для брендинга/отзыва).
- **Точный статус basic-auth для тестового `@outlook.com`:** решается первой задачей change'а (проверочный зонд). Влияет на объём, но не на архитектуру.

### Observation (по итогам задачи 2.3, проверочный зонд)

Проверочный зонд basic-auth к `outlook.office365.com:993` для тестового аккаунта `alcauselove@outlook.com` выполнен. Результат: **basic-auth отключён** — сервер возвращает `Login is disabled` (`works=false`). Риск из раздела 3.0 PLAN.md подтверждён: для личного `@outlook.com`-аккаунта в этом клиенте логин/пароль по IMAP не проходят. Вывод:

- Для Outlook-аккаунта устанавливается `authStrategy: 'oauth2'` (см. `.env`).
- Реализуется OAuth2 device code flow (задачи группы 5).
- Basic-ветка и автоопределение остаются в коде (спека требует fallback), но для тестового ящика фактически сработает oauth2.
- `Login is disabled` не раскрывает пароль (redact работает — секрет не фигурирует в `error`).