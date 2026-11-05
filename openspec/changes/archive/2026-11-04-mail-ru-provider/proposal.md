# Proposal

## Why

В `.env` пользователя уже заведён аккаунт `alexandr1508@mail.ru` с `provider: "mail"`, но такой провайдер не реализован в коде: `MailProviderKind = 'yandex' | 'outlook'`, `AccountSchema.provider` принимает только `yandex`/`outlook`, фабрика `createMailProvider` бросает `неизвестный провайдер`, а тул `mail.connect` отвергает `provider: "mail"`. Это делает ящик Mail.ru полностью неработоспособным — ни подключение, ни поиск, ни чтение, ни отправка. Нужно добавить провайдер `mail` (Mail.ru Group: `@mail.ru`, `@inbox.ru`, `@list.ru`, `@bk.ru`), структурно аналогичный Яндексу (basic-auth с паролем приложения, IMAP/SMTP через TLS).

## What Changes

- Добавлен провайдер `mail` (Mail.ru Group) с IMAP `imap.mail.ru:993` (TLS) и SMTP `smtp.mail.ru:465` (TLS), стратегия аутентификации `basic` (логин + пароль приложения). Поведение полностью идентично Яндексу (без OAuth2, без auto-detect).
- Расширен `MailProviderKind` с `'yandex' | 'outlook'` до `'yandex' | 'outlook' | 'mail'` — **BREAKING** для типа, но обратно-совместимо на уровне данных (существующие аккаунты `yandex`/`outlook` работают без изменений).
- `AccountSchema.provider` (zod) принимает `'mail'` — аккаунт `alexandr1508@mail.ru` становится валидным.
- Фабрика `createMailProvider` и `createAuthStrategyForAccount` создают `MailRuMailProvider` (новый класс, наследник `AbstractImapProvider`, почти копия `YandexMailProvider`) для `provider: "mail"`.
- `smtpConnectionFor` возвращает `MAIL_RU_SMTP` (`smtp.mail.ru:465`, TLS) для `kind: "mail"`.
- Тул `mail.connect`: `inputSchema.provider.enum` и рантайм-валидация принимают `'mail'`; описание тула упоминает Mail.ru.
- CLI-мастер `/add-account` принимает `provider: "mail"`; валидация и подсказки обновлены.
- Самоисцеление соединения (change `mail-connection-self-healing`), client-side fallback поиска и повтор операций — применимы к `mail` без изменений (наследуются от `AbstractImapProvider`).
- Новых MCP-тулов нет: `mail` использует существующие `mail.connect`/`mail.search`/`mail.fetch`/`mail.downloadAttachments`/`mail.send`.

## Capabilities

### New Capabilities

<!-- Нет новых capability-каталогов: провайдер `mail` расширяет существующие mail/* behavior,
     новые требования добавляются в уже существующие спеки mail/connection и mail/send. -->

### Modified Capabilities

- `mail/connection`: добавлен провайдер `mail` (Mail.ru Group) — IMAP `imap.mail.ru:993` (TLS), стратегия `basic`; расширен перечень поддерживаемых провайдеров в требовании «Подключение к ящику по IMAP».
- `mail/send`: добавлена SMTP-аутентификация для провайдера `mail` — `smtp.mail.ru:465` (TLS), стратегия `basic` (логин + пароль приложения); расширен перечень провайдеров в требовании «SMTP-аутентификация по провайдеру».
- `config/account-management`: расширен перечень валидных `provider` с `yandex`/`outlook` до `yandex`/`outlook`/`mail` в требовании валидации полей записи аккаунта.
- `transport/cli`: мастер `/add-account` принимает `provider: "mail"`; обновлены валидация и подсказки в требованиях «Поля мастера /add-account» и «Валидация полей /add-account».

## Impact

- **Код**:
  - `src/tools/mail/types.ts` — `MailProviderKind` += `'mail'`.
  - `src/config/schema.ts` — `AccountSchema.provider` enum += `'mail'`; комментарий.
  - `src/tools/mail/providers/mail-ru.ts` (новый) — `MailRuMailProvider extends AbstractImapProvider`, IMAP-параметры, `providerKind: 'mail'`.
  - `src/tools/mail/providers/smtp-options.ts` — `MAIL_RU_SMTP` + ветка `case 'mail'` в `smtpConnectionFor`.
  - `src/tools/mail/providers/factory.ts` — ветка `provider === 'mail'` в `createMailProvider` и `createAuthStrategyForAccount`.
  - `src/tools/mail/providers/index.ts` — экспорт `MailRuMailProvider`.
  - `src/tools/mail/mail-connect.tool.ts` — `inputSchema.provider.enum` += `'mail'`; рантайм-валидация; описание.
- **Конфигурация**: аккаунт `alexandr1508@mail.ru` в `ACCOUNTS` (`.env`) становится валидным; пароль приложения уже заведён пользователем.
- **Зависимости**: новых npm-зависимостей нет — используется существующий стек (imapflow, nodemailer, `AbstractImapProvider`).
- **Тесты**: новый unit-тест `MailRuMailProvider` (IMAP-параметры, `providerKind`); расширение тестов фабрики (`createMailProvider` для `mail`), `smtpConnectionFor` (`mail`), валидации `AccountSchema` (`provider: 'mail'`), `mail.connect` (accept `'mail'`), мастера `/add-account` (`provider: 'mail'`).
- **Спеки**: delta для `mail/connection`, `mail/send`, `config/account-management`, `transport/cli`.
