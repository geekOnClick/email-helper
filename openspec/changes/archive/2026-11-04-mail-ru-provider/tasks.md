# Tasks

## 1. Тип и конфигурация провайдера

- [x] 1.1 Расширить `MailProviderKind` в `src/tools/mail/types.ts` с `'yandex' | 'outlook'` до `'yandex' | 'outlook' | 'mail'`. Проверка: `npx tsc --noEmit` — exhaustive-switch в `smtpConnectionFor` укажет непокрытые ветки.
- [x] 1.2 Расширить `AccountSchema.provider` (zod) в `src/config/schema.ts` с `z.enum(['yandex', 'outlook'])` до `z.enum(['yandex', 'outlook', 'mail'])`; обновить комментарий над схемой. Проверка: `npx tsc --noEmit`; `tests/config.test.ts` — новый тест, что `{ provider: 'mail', login: 'u@mail.ru', password: 'p', authStrategy: 'basic' }` валиден.
- [x] 1.3 Убедиться, что `loadConfig` принимает `ACCOUNTS` с аккаунтом `provider: "mail"` (`alexandr1508@mail.ru`) без ошибок валидации. Проверка: `node`/`tsx`-скрипт загружает конфиг с реальным `ACCOUNTS` из `.env` и не падает.

## 2. Реализация провайдера Mail.ru

- [x] 2.1 Создать `src/tools/mail/providers/mail-ru.ts` с классом `MailRuMailProvider extends AbstractImapProvider`: конструктор принимает `{ account, clientFactory? }`, стратегия `new BasicAuthStrategy()`, `providerKind` возвращает `'mail'`, `connection` возвращает `{ host: 'imap.mail.ru', port: 993, secure: true, disableAutoIdle: true, logger: false }`. Константы `MAIL_RU_IMAP_HOST = 'imap.mail.ru'`, `MAIL_RU_IMAP_PORT = 993`. Проверка: `npx tsc --noEmit`; unit-тест `tests/mail-ru-provider.test.ts` — `providerKind === 'mail'`, `connection.host === 'imap.mail.ru'`, `connection.port === 993`, `connection.secure === true`.
- [x] 2.2 Добавить `MAIL_RU_SMTP` в `src/tools/mail/providers/smtp-options.ts` (`{ host: 'smtp.mail.ru', port: 465, secure: true }`) и ветку `case 'mail': return MAIL_RU_SMTP` в `smtpConnectionFor`. Проверка: `npx tsc --noEmit` (exhaustive-switch укажет, если ветка пропущена); `tests/smtp-options.test.ts` или расширение `factory.test.ts` — `smtpConnectionFor('mail')` возвращает `{ host: 'smtp.mail.ru', port: 465, secure: true }`.
- [x] 2.3 Добавить ветку `provider === 'mail'` в `createMailProvider` (`src/tools/mail/providers/factory.ts`) → `new MailRuMailProvider({ account, clientFactory: opts.clientFactory })`; и в `createAuthStrategyForAccount` → `new BasicAuthStrategy()`. Проверка: `npx tsc --noEmit`; расширение `tests/factory.test.ts` — `createMailProvider({ provider:'mail', login, password, authStrategy:'basic' })` возвращает инстанс `MailRuMailProvider`; `createAuthStrategyForAccount` для `mail` возвращает `BasicAuthStrategy`.
- [x] 2.4 Экспортировать `MailRuMailProvider` и `MAIL_RU_SMTP` из `src/tools/mail/providers/index.ts`. Проверка: `npx tsc --noEmit`; импорт используется в тестах.

## 3. Тул mail.connect и мастер /add-account

- [x] 3.1 Обновить тул `mail.connect` (`src/tools/mail/mail-connect.tool.ts`): `inputSchema.properties.provider.enum` → `['yandex', 'outlook', 'mail']`; рантайм-валидация `if (provider !== 'yandex' && provider !== 'outlook' && provider !== 'mail')`; описание тула упоминает Mail.ru. Проверка: `npx tsc --noEmit`; расширение `tests/mail-connect-provider-login.test.ts` — вызов с `provider: 'mail'` не отвергается на уровне валидации.
- [x] 3.2 Обновить валидацию поля `provider` в мастере `/add-account` (`src/transport/cli/prompts.ts`, `validateAccountField`): принимать `'mail'`; сообщения-подсказки перечисляют `yandex`, `outlook` или `mail`. Проверка: `npx tsc --noEmit`; расширение `tests/cli-add-account-prompts.test.ts` — `provider - mail` принимается, `provider - gmail` отклоняется с обновлённым сообщением.

## 4. Тесты

- [x] 4.1 Создать `tests/mail-ru-provider.test.ts`: `MailRuMailProvider` — `providerKind`, IMAP-параметры (`host`/`port`/`secure`), использование `BasicAuthStrategy`. Проверка: `npx vitest run tests/mail-ru-provider.test.ts` — зелёный.
- [x] 4.2 Расширить `tests/factory.test.ts`: `createMailProvider` для `provider: 'mail'` → `MailRuMailProvider`; `createAuthStrategyForAccount` для `mail` → `BasicAuthStrategy`; `smtpConnectionFor('mail')` → `MAIL_RU_SMTP`. Проверка: `npx vitest run tests/factory.test.ts` — зелёный.
- [x] 4.3 Расширить `tests/config.test.ts`: `AccountSchema` принимает `provider: 'mail'`. Проверка: `npx vitest run tests/config.test.ts` — зелёный.
- [x] 4.4 Расширить `tests/mail-connect-provider-login.test.ts`: тул `mail.connect` принимает `provider: 'mail'` на уровне inputSchema и рантайм-валидации. Проверка: `npx vitest run tests/mail-connect-provider-login.test.ts` — зелёный.
- [x] 4.5 Расширить `tests/cli-add-account-prompts.test.ts`: валидация `provider` принимает `mail`; невалидный `gmail` даёт сообщение с перечислением `yandex`/`outlook`/`mail`. Проверка: `npx vitest run tests/cli-add-account-prompts.test.ts` — зелёный.

## 5. Валидация и сборка

- [x] 5.1 `npx tsc --noEmit` — без ошибок (exhaustive-switch по `MailProviderKind` пройден во всех точках). Проверка: exit 0.
- [x] 5.2 `npx eslint .` — без ошибок. Проверка: exit 0.
- [x] 5.3 `npx vitest run` — все тесты зелёные (без регрессий по существующим `yandex`/`outlook`-тестам). Проверка: ни одного FAIL; счётчик тестов вырос на ~новые.
- [x] 5.4 `openspec validate --specs` — все спеки валидны. Проверка: 15 passed, 0 failed.

## Workflow follow-up

- После реализации и проверки — архивировать change через `/opsx-archive mail-ru-provider` (sync delta-спек к `mail/connection`, `mail/send`, `config/account-management`, `transport/cli`).
- Пользователь верифицирует на реальном ящике: `/connect` (или guided-команда) с аккаунтом `alexandr1508@mail.ru` → успешное IMAP-подключение; `/analyze`/`/smart-search`/`/smart-send` работают.
