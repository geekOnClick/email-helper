# Tasks: mcp-dynamic-credentials

## 1. Расширение тулa mail.connect

- [x] 1.1 Обновить тип `MailConnectArgs` в `src/tools/mail/mail-connect.tool.ts`: добавить опциональное поле `credentials?: { provider: MailProviderKind; password: string; authStrategy?: AuthStrategyKind }`
- [x] 1.2 Обновить `inputSchema` тулa `mail.connect`: добавить опциональный объект `credentials` с полями `provider` (enum `yandex`/`outlook`), `password` (string), `authStrategy` (enum `basic`/`oauth2`, по умолчанию `basic`)
- [x] 1.3 В обработчике: если `credentials` передан — построить временный `MailAccount` из `{ login: args.login, provider, password, authStrategy: authStrategy ?? 'basic' }` и использовать его вместо поиска в `deps.accounts`; валидировать обязательные поля `provider` и `password` (ошибка при пустых/невалидных)
- [x] 1.4 Если `credentials` опущен — сохранить текущую логику: поиск аккаунта в `deps.accounts` по `login`; если не найден — ошибка `аккаунт не найден: <login>`
- [x] 1.5 При ошибке подключения с динамическими кредами — маскировать пароль через `redact(msg, account.password, account.login)` (аналогично `mail.send`)

## 2. Тесты (unit)

- [x] 2.1 Тест: `mail.connect` с `credentials` для Яндекс — создаёт временный аккаунт, подключается, сохраняет сессию в `MailSessionStore`, не обращается к `deps.accounts`
- [x] 2.2 Тест: `mail.connect` без `credentials` — fallback на `deps.accounts` (существующее поведение, регрессия)
- [x] 2.3 Тест: `mail.connect` без `credentials` и аккаунт не найден в `.env` — ошибка `аккаунт не найден`
- [x] 2.4 Тест: `mail.connect` с невалидным `credentials.provider` — ошибка валидации
- [x] 2.5 Тест: `mail.connect` с пустым `credentials.password` — ошибка валидации
- [x] 2.6 Тест: ошибка подключения с динамическими кредами — пароль замаскирован `[REDACTED]` в сообщении ошибки
- [x] 2.7 Тест: динамический пароль не попадает в успешный результат тулa (возвращается только `ConnectionResult`)

## 3. Тесты (интеграция через MCP)

- [x] 3.1 Интеграционный тест: MCP `tools/list` возвращает обновлённую схему `mail.connect` с полем `credentials`
- [x] 3.2 Интеграционный тест: MCP `tools/call` для `mail.connect` с `credentials` — подключается через stub-провайдер, сессия доступна последующему `mail.search` по тому же `login`

## 4. Документация

- [x] 4.1 Обновить README: в разделе «Инструменты MCP» для `mail.connect` описать опциональный блок `credentials` (поля `provider`, `password`, `authStrategy`) и fallback на `.env`
- [x] 4.2 Обновить README: в разделе «Подключение других агентов» упомянуть, что внешний агент может передать свои креды в `mail.connect` вместо использования `.env` сервера

## 5. Финальные проверки

- [x] 5.1 `npm test` — все тесты проходят (включая новые), регрессий нет
- [x] 5.2 `npx tsc --noEmit` — чисто
- [x] 5.3 `npm run lint` — чисто
- [x] 5.4 `openspec validate mcp-dynamic-credentials --strict` — valid

## 6. Очистка учётных данных (hardening)

Усиление `dispose()` провайдера: после закрытия IMAP-сессии ссылка на аккаунт
обнуляется (`this.account = null`), чтобы пароль стал недостижим и был собран
GC. `cleanup()` → `disposeAll()` уже вызывается при завершении MCP-сервера
(stdio EOF, SIGINT/SIGTERM, HTTP stdin-close) — динамические креды, переданные
через MCP, удаляются из памяти и не сохраняются на диск.

- [x] 6.1 `AbstractImapProvider.dispose()`: обнулять `this.account` после logout
- [x] 6.2 `account` → `MailAccount | null`, `requireAccount()` helper (бросает «закрыт»),
      `connect()` guard на disposed, `accountId()` null-safe
- [x] 6.3 Тесты `yandex-provider`: dispose обнуляет account; connect после dispose → «закрыт»;
      операции после dispose → «подключение не установлено»
- [x] 6.4 Тесты `mail-connect-dynamic-credentials`: `store.dispose(login)` и
      `disposeAll()` очищают динамические сессии из store (пароль недоступен)
- [x] 6.5 README: документировать очистку кредов при завершении сервера
- [x] 6.6 `npm test` → 430 passed / 14 skipped; tsc/lint чисто; validate --strict valid
