# Proposal

## Why

Фазы 0–3 завершены: агент подключается к ящикам (Яндекс/Outlook), ищет, читает, скачивает вложения, индексирует и ищет письма семантически. Но отправка писем — последнее рутинное действие помощника из `PLAN.md` (раздел 3.2, тул `mail.send`) — отсутствует: SMTP-клиента нет, и помощник явно помечен в `skills/helper.md` как «не отправляет письма (тул `mail.send` появится в Фазе 4)». Фаза 4 (`PLAN.md` раздел 5 + решение 8.5) закрывает этот пробел: вводит `mail.send` по SMTP для Яндекс + Outlook со схемой «критериев письма», поддержкой нескольких получателей (TO/CC/BCC) и обязательным подтверждением перед отправкой (агент показывает черновик и ждёт подтверждения пользователя).

## What Changes

- **SMTP-клиент** (`nodemailer`) для Яндекс (`smtp.yandex.ru:465`, TLS, basic/пароль приложения) и Outlook (`smtp-mail.outlook.com:587` или `smtp.office365.com:587`, STARTTLS, OAuth2 XOAUTH2 — access token из того же `OAuthTokenStore`, что IMAP).
- **Расширение `AuthStrategy`** методом `getSmtpAuth(account, connection): Promise<nodemailer transport auth>` — стратегии `BasicAuthStrategy` и `OAuth2MsalStrategy` отдают SMTP-credentials, переиспользуя refresh-token. Для Outlook — расширение scope device code flow на `SMTP.Send` (один access token покрывает IMAP + SMTP), что требует одноразовой повторной авторизации при переходе с Фазы 1 (refresh ротируется).
- **Схема «критериев письма»** (`ComposeMailInput`): получатели TO/CC/BCC (массивы `EmailAddress`), тема, текстовое тело, опц. HTML-альтернатива, опц. вложения (пути к локальным файлам), кодировка (default UTF-8).
- **Тул `mail.send`** (`src/tools/mail/mail-send.tool.ts`): принимает `login` + `ComposeMailInput` + `confirm: boolean`. При `confirm !== true` — валидирует критерии и возвращает предпросмотр черновика (`{ ready: false, preview: {...}, validation: {...} }`) БЕЗ отправки. При `confirm === true` — валидирует, отправляет через SMTP-транспорт и возвращает `{ ready: true, messageId, recipients }`. Deps: `sessionStore` (требует активное `mail.connect`), `accounts`, инжектируемый `SmtpTransportFactory`.
- **Injectable SMTP-транспорт**: интерфейс `SmtpTransport` (`sendMail(opts): Promise<{ messageId }>`), фабрика `createSmtpTransport(connection, auth)` — для unit-тестов мокается, для интеграционных — реальный nodemailer против mock-сервера `smtp-server`.
- **Подключение помощника**: `mail.send` → в `HELPER_TOOLS` whitelist (`src/agents/helper.ts`); регистрация через `registerMailConnectTools` (или отдельный `registerMailSendTools`); `composeAgents` пробрасывает опц. `smtpTransportFactory`. Спека `agent/helper` modified (расширение набора рутинных тулов сценарием отправки).
- **Тесты**: unit-тесты тулa и SMTP-клиента с мок-транспортом; интеграционный gated-тест с mock SMTP-сервером (`smtp-server` npm, dev-dep) — проверка отправки письма, нескольких получателей, вложений, ошибок SMTP; gated-тест против реальных Яндекс/Outlook (`INTEGRATION_TEST=1`, ручное подтверждение).

## Capabilities

### New Capabilities

- `mail/send`: тул `mail.send` — отправка письма по SMTP (Яндекс basic, Outlook OAuth2 XOAUTH2) по строгим критериям (получатели TO/CC/BCC, тема, тело, вложения, кодировка), с валидацией, предпросмотром черновика и обязательным подтверждением перед отправкой.

### Modified Capabilities

- `agent/helper`: расширение набора рутинных тулов помощника — добавляется тул `mail.send` как новый вид рутины (отправка писем); снимается ограничение «не отправляет письма».

## Impact

- **Новый код:** `src/tools/mail/smtp-client.ts` (`SmtpClient`, `SmtpTransport`, `createSmtpTransport`), `src/tools/mail/compose-mail.ts` (`ComposeMailInput`, валидация критериев, построение `MailMessage`), `src/tools/mail/mail-send.tool.ts` (`createMailSendTool`), `src/tools/mail/providers/smtp-options.ts` (SMTP-connection по провайдеру: хост/порт/secure) или расширение существующих провайдеров.
- **Модификации:** `src/tools/mail/mail-provider.ts` / `providers/basic-auth.ts` / `providers/oauth2-msal.ts` (метод `getSmtpAuth`), `src/tools/mail/oauth/device-flow.ts` (`DEFAULT_SCOPE` += `SMTP.Send`), `src/tools/mail/register-tools.ts` (регистрация `mail.send`), `src/agents/helper.ts` (`HELPER_TOOLS` += `mail.send`), `src/agents/compose.ts` (опц. `smtpTransportFactory`), `skills/helper.md` (добавление тулa, снятие ограничения), `src/types/email.ts` (`ComposeMailInput` и связанные типы).
- **Новые зависимости:** `nodemailer` (runtime), `@types/nodemailer` (dev), `smtp-server` + `@types/smtp-server` (dev, mock SMTP в тестах). `nodemailer` уже заложен в `PLAN.md` (раздел 2).
- **Внешние системы:** `smtp.yandex.ru:465`, `smtp-mail.outlook.com:587` (или `smtp.office365.com:587`), Microsoft identity platform v2.0 (расширенный scope `SMTP.Send`).
- **Не затрагивает:** IMAP-операции Фазы 1 (`mail.connect`/`search`/`fetch`/`downloadAttachments` — as-is), LLM-клиент и агентов (as-is), векторное хранилище (as-is), `mail/connection` spec (scope — деталь реализации OAuth2-стратегии, не requirement-level). SMTP-сессия независима от IMAP-сессии (отдельный транспорт), но переиспользует учётные данные.
- **Безопасность:** `redact` применяется к SMTP-ошибкам (пароль/accessToken не попадают в сообщения); учётные данные берутся из конфига/store, не из аргументов тулa; подтверждение перед отправкой защищает от случайной/несанкционированной отправки.
