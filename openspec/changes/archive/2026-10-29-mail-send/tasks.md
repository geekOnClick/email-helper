# Tasks

## 1. Зависимости

- [x] 1.1 Установить runtime-зависимость `nodemailer`: `npm i nodemailer`. Проверка: `npm install` без ошибок, `package.json` содержит `nodemailer`, `node -e "import('nodemailer')"` резолвится.
- [x] 1.2 Установить dev-зависимости `@types/nodemailer`, `smtp-server`, `@types/smtp-server`: `npm i -D @types/nodemailer smtp-server @types/smtp-server`. Проверка: `npm install` без ошибок; `node -e "import('smtp-server')"` резолвится.

## 2. Расширение AuthStrategy и scope для SMTP

- [x] 2.1 В `src/tools/mail/mail-provider.ts`: расширить интерфейс `AuthStrategy` методом `getSmtpAuth(account: MailAccount, connection: SmtpConnectionOptions): Promise<SmtpAuth>`; определить типы `SmtpConnectionOptions` (`{ host, port, secure }`) и `SmtpAuth` (`{ user: string; pass?: string; accessToken?: string }`). Проверка: `npx tsc --noEmit` без ошибок.
- [x] 2.2 В `src/tools/mail/providers/basic-auth.ts`: реализовать `BasicAuthStrategy.getSmtpAuth()` → `{ user: login, pass: password }`. Проверка: `npx tsc --noEmit`; unit-тест `tests/basic-auth-smtp.test.ts` — стратегия возвращает корректный объект для аккаунта.
- [x] 2.3 В `src/tools/mail/providers/oauth2-msal.ts`: реализовать `OAuth2MsalStrategy.getSmtpAuth()` → `{ user: login, accessToken }` через существующий `obtainAccessToken(account)`. Проверка: `npx tsc --noEmit`; unit-тест — валидный токен из store → без flow; refresh-сценарий; device flow (мок store + мок deviceFlow).
- [x] 2.4 В `src/tools/mail/oauth/device-flow.ts`: расширить `DEFAULT_SCOPE` на `https://outlook.office.com/SMTP.Send` (итог: `offline_access IMAP.AccessAsUser.All SMTP.Send`). Проверка: `npx tsc --noEmit`; существующие unit-тесты device-flow зелёные (scope не влияет на wire-формат запроса).

## 3. Параметры SMTP-соединения по провайдеру

- [x] 3.1 Создать `src/tools/mail/providers/smtp-options.ts`: функцию `smtpConnectionFor(kind: MailProviderKind): SmtpConnectionOptions` — Яндекс `{ host: 'smtp.yandex.ru', port: 465, secure: true }`, Outlook `{ host: 'smtp-mail.outlook.com', port: 587, secure: false }`. Проверка: `npx tsc --noEmit`; unit-тест `tests/smtp-options.test.ts` — оба провайдера возвращают корректные параметры.
- [x] 3.2 Экспортировать `smtpConnectionFor` из `src/tools/mail/providers/index.ts`. Проверка: `npx tsc --noEmit`; импорт резолвится.

## 4. SMTP-клиент и injectable-транспорт

- [x] 4.1 Создать `src/tools/mail/smtp-client.ts`: интерфейс `SmtpTransport` (`sendMail(opts): Promise<{ messageId: string }>; close(): Promise<void>`), тип `SmtpTransportFactory` (`(opts) => SmtpTransport`), дефолтную фабрику `createDefaultTransport(opts)` — обёртка над `nodemailer.createTransport`. Проверка: `npx tsc --noEmit`.
- [x] 4.2 Реализовать `SmtpClient` в `src/tools/mail/smtp-client.ts`: конструктор принимает `{ account, strategy, connection, transportFactory }`; метод `send(mail: ComposeMailInput): Promise<{ messageId: string }>` — строит nodemailer `SendMailOptions` (from=account.login, to/cc/bcc, subject, text, html, attachments, encoding), вызывает `transport.sendMail`, возвращает `{ messageId }`; ошибки пропускает через `redact`. Проверка: `npx tsc --noEmit`; unit-тест `tests/smtp-client.test.ts` — мок `SmtpTransport` (records sendMail): (1) валидное письмо → sendMail с корректными opts, messageId возвращён; (2) несколько получателей TO/CC/BCC → все в opts; (3) вложения → в opts.attachments; (4) ошибка sendMail → redact (пароль/токен не в сообщении).
- [x] 4.3 Пополнить экспорт `src/tools/mail/index.ts`: `+export { SmtpClient, SmtpTransport, SmtpTransportFactory, createDefaultTransport }`.

## 5. Схема критериев письма и валидация

- [x] 5.1 В `src/types/email.ts`: добавить типы `ComposeMailInput` (`{ to: EmailAddress[]; cc?: EmailAddress[]; bcc?: EmailAddress[]; subject: string; text: string; html?: string; attachments?: { path: string }[]; encoding?: string }`), `ValidationResult` (`{ valid: boolean; errors: string[] }`). Переиспользовать существующий `EmailAddress`. Проверка: `npx tsc --noEmit`.
- [x] 5.2 Создать `src/tools/mail/compose-mail.ts`: `validateComposeMail(input: ComposeMailInput): Promise<ValidationResult>` — проверки: ≥1 получателя суммарно (TO+CC+BCC), каждый адрес валидного email-формата (regex), `subject` непустое, `text` непустое, пути вложений существуют (`fs.stat`). Проверка: `npx tsc --noEmit`; unit-тест `tests/compose-mail.test.ts` — (1) валидный минимум (1 TO, subject, text) → valid; (2) нет получателей → invalid; (3) кривой адрес → invalid с указанием; (4) пустая тема → invalid; (5) пустое тело → invalid; (6) несуществующий путь вложения → invalid; (7) CC/BCC валидные → valid.

## 6. Тул mail.send (двухфазный протокол подтверждения)

- [x] 6.1 В `src/tools/mail/session-store.ts`: добавить метод `getAccount(login: string): MailAccount | undefined` (раскрыть сохранённый `{ provider, account }`). Проверка: `npx tsc --noEmit`; существующие тесты session-store зелёные; новый unit-тест `tests/session-store-account.test.ts` — `set` → `getAccount` возвращает аккаунт; без сессии → undefined.
- [x] 6.2 Реализовать `src/tools/mail/mail-send.tool.ts`: `MailSendArgs` (`{ login: string; mail: ComposeMailInput; confirm: boolean }`), `MailSendDeps` (`{ sessionStore; accounts; oauth2?; tokenStorePath?; transportFactory? }`), `createMailSendTool(deps): ToolDef`. Handler: `sessionStore.get(login)` → если нет, ошибка «подключение не установлено»; `account = sessionStore.getAccount(login)`; `validateComposeMail(mail)`. При `confirm !== true` → возврат `SendPreview { ready: false; preview: { from, to, cc, bcc, subject, textLength, hasHtml, attachments: [{filename,size}] }; validation }` (БЕЗ SMTP). При `confirm === true`: если `validation.valid === false` → `{ ready: false; validation }` без отправки; иначе — построить стратегию по account (factory-логика `buildOAuth2Strategy`/`BasicAuthStrategy`), `SmtpClient.send(mail)` → `SendResult { ready: true; messageId; recipients }`. Ошибки → redact. Проверка: `npx tsc --noEmit`.
- [x] 6.3 Unit-тест `tests/mail-send-tool.test.ts`: мок `SmtpTransport` (records sendMail), stub sessionStore (active/inactive), stub аккаунт. Сценарии: (1) `confirm:false` валидное → `ready:false`, preview заполнен, sendMail НЕ звался; (2) `confirm:false` невалидное → `ready:false`, `validation.valid=false`, sendMail НЕ звался; (3) `confirm:true` валидное → sendMail звался, `ready:true`, messageId, recipients; (4) `confirm:true` невалидное → `ready:false`, sendMail НЕ звался; (5) нет сессии → throws/ошибка; (6) несколько получателей TO/CC/BCC → recipients объединён; (7) вложения → в sendMail opts; (8) ошибка sendMail → redact (пароль/токен не в сообщении). Проверка: `npm test -- mail-send-tool` зелёный.

## 7. Регистрация тулов и скил помощника

- [x] 7.1 В `src/tools/mail/register-tools.ts`: добавить `createMailSendTool` в регистрацию; `RegisterToolsDeps` получает опц. `transportFactory?`. Проверка: `npx tsc --noEmit`; `tests/register-tools.test.ts` (если есть) зелёный, либо новый — после `registerMailConnectTools(deps)` `getTool('mail.send')` определён.
- [x] 7.2 В `src/agents/helper.ts`: добавить `'mail.send'` в `HELPER_TOOLS`. Проверка: `npx tsc --noEmit`; `tests/helper.test.ts` зелёный (whitelist содержит mail.send; если тест assert'ит точный набор — обновить).
- [x] 7.3 В `src/agents/compose.ts`: добавить опц. `smtpTransportFactory?` в `ComposeAgentsOptions`; пробросить в `registerMailConnectTools`. Проверка: `npx tsc --noEmit`; `tests/compose-agents.test.ts` зелёный.
- [x] 7.4 Обновить `skills/helper.md`: в разделе «Доступные тулы» добавить `mail.send` (двухфазный протокол: без `confirm:true` → предпросмотр черновика с валидацией; с `confirm:true` → отправка по SMTP, требует активное `mail.connect`); в «Зоны ответственности» добавить «Отправка писем по строгим критериям с подтверждением»; в «Ограничения» убрать «Не отправляешь письма (тул `mail.send` появится в Фазе 4)». Проверка: `loadSkill('helper')` содержит `mail.send` и не содержит старого ограничения.

## 8. Интеграционный тест с mock SMTP-сервером

- [x] 8.1 Создать `tests/integration/mail-send-smtp-server.test.ts`: поднимает `smtp-server` на случайном порту (в `beforeAll`, закрывает в `afterAll`); тул `mail.send` с реальным `nodemailer`-транспортом (default factory) против mock-сервера. Сценарии: (1) `confirm:true` → сервер получил письмо с правильными `from`/`to`/`subject`/`text`; (2) несколько получателей (TO+CC+BCC) → `RCPT TO` для каждого; (3) вложение (temp-файл) → в теле письма base64-часть; (4) `confirm:false` → сервер ничего не получил. Требует активную сессию (stub sessionStore с аккаунтом). Проверка: `npm test -- mail-send-smtp-server` зелёный (быстрый, детерминированный — без gate).

## 9. Финальная проверка

- [x] 9.1 `npm test` — зелёный (все unit + smtp-server integration). Проверка: exit 0.
- [x] 9.2 `npx tsc --noEmit` — без ошибок. Проверка: exit 0.
- [x] 9.3 `npm run lint` — без ошибок. Проверка: exit 0.
- [x] 9.4 `openspec validate mail-send --strict` — проходит. Проверка: exit 0.

## Workflow follow-up

- После проверки — запустить `/opsx-archive` для зашивания change и обновления основного спека `mail/send` + синхронизации modified-спеки `agent/helper`.
- Опционально: gated-тест `tests/integration/mail-send-real.test.ts` (`INTEGRATION_TEST=1`) — реальная отправка через Яндекс/Outlook на тестовый адрес; ручное подтверждение (помечается manual-verified, т.к. шлёт реальное письмо). При первом запуске для Outlook — возможна повторная авторизация device code flow под расширенным scope (`SMTP.Send`); зафиксировать observation.
- После `mail-send` Фаза 4 завершена. Дальше по PLAN.md раздел 6 — Фаза 5 (CLI) или Фаза 6 (MCP).
