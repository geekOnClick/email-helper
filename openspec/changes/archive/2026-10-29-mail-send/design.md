# Design

## Context

Фазы 0–3 завершены (см. `proposal.md` — Why). Фундамент почты (`archive/2026-10-27-mail-connect/`): `MailProvider` (IMAP-only) + `AuthStrategy` (`basic`/`oauth2`) + `MailSessionStore` + провайдеры Яндекс/Outlook + `OAuthTokenStore` + `MSDeviceFlowClient`. `AuthStrategy.getImapAuth()` возвращает опции imapflow; `OAuth2MsalStrategy` хранит/обновляет access+refresh token в `OAuthTokenStore` (`./.tokens/oauth.json`). Реестр тулов (`ToolDef`, `registerTool`), `registerMailConnectTools` (5 mail-тулов), `HELPER_TOOLS` whitelist помощника (7 тулов), `composeAgents` — точка сборки. `skills/helper.md` явно запрещает отправку («тул `mail.send` появится в Фазе 4»). `nodemailer` заложен в `PLAN.md` (раздел 2), но не установлен. `redact()` применяется к IMAP-ошибкам. Требования — см. спеки `mail/send` (new) и `agent/helper` (modified). `mail/connection` НЕ модифицируется: SMTP-аутентификация — отдельное поведение, не затрагивающее контракты подключения/сессии IMAP.

## Goals / Non-Goals

**Goals:**

- Тул `mail.send` по SMTP для Яндекс (basic) и Outlook (XOAUTH2), переиспользующий `AuthStrategy` + `OAuthTokenStore`.
- Схема критериев письма `ComposeMailInput` (TO/CC/BCC, тема, текст/HTML, вложения, кодировка) с валидацией.
- Двухфазный протокол подтверждения: `confirm != true` → предпросмотр черновика без отправки; `confirm === true` → валидация + отправка. Без побочного состояния между вызовами (stateless тул).
- Injectable SMTP-транспорт (`SmtpTransport` interface + `SmtpTransportFactory`) — для моков в unit-тестах и mock-сервера `smtp-server` в интеграционных.
- Включение `mail.send` в whitelist помощника + регистрация в `composeAgents`.

**Non-Goals:**

- Очередь отправки, отложенная отправка, повторы при сбое SMTP — позже (Фаза 8).
- Черновики в Sent-папке через IMAP APPEND — отдельная фича (PLAN.md не требует).
- Шаблоны писем как отдельная сущность — критерии письма задаются аргументами тулa; «шаблоны» собирёт оркестратор на уровне промпта.
- HTML-only письма без text/plain — `ComposeMailInput.text` обязателен (accessibility), HTML опционален.
- Проверка доставки/прочтения (DSN/MDN) — вне scope.

## Decisions

### D1. SMTP-аутентификация — расширение `AuthStrategy` методом `getSmtpAuth`

Интерфейс `AuthStrategy` дополняется методом `getSmtpAuth(account, smtpConnection): Promise<SmtpAuth>`, где `SmtpAuth` — nodemailer-совместимый объект аутентификации (`{ user, pass }` для basic; `{ user, accessToken }` для XOAUTH2). Реализации:
- `BasicAuthStrategy.getSmtpAuth()` → `{ user: login, pass: password }` (тот же пароль приложения, что и для IMAP).
- `OAuth2MsalStrategy.getSmtpAuth()` → `{ user: login, accessToken }`, где accessToken берётся через тот же `obtainAccessToken()` (store → refresh → device flow).

`getImapAuth()` остаётся as-is. **Альтернатива:** отдельный `SmtpAuthStrategy` интерфейс — rejected (дублирование: одна стратегия = одни учётные данные для обоих протоколов). **Альтернатива:** `AuthStrategy.getAuth(protocol)` с параметром — rejected (нарушает OCP для существующих вызовов, усложняет imap-путь). Метод-пара сохраняет стратегию как единый источник credentials.

### D2. Outlook scope — расширение `DEFAULT_SCOPE` на `SMTP.Send`

`MSDeviceFlowClient.DEFAULT_SCOPE` сейчас `'offline_access https://outlook.office.com/IMAP.AccessAsUser.All'`. Microsoft требует отдельного scope `https://outlook.office.com/SMTP.Send` для отправки по SMTP. Расширяем scope: `'offline_access https://outlook.office.com/IMAP.AccessAsUser.All https://outlook.office.com/SMTP.Send'`. Один access token покрывает оба протокола.

**Миграционный момент:** существующие refresh-токены в `OAuthTokenStore` выданы под старый scope. При первом `refresh()` с новым scope Microsoft ротирует refresh-token и возвращает токен с расширенными правами — прозрачно для кода (`obtainAccessToken` → refresh → persist перезаписывает). Пользователь перезапускает device code flow только если refresh отозван. Это поведение, не breaking-change: старый токен продолжает работать для IMAP до первого refresh, после которого покрывает и SMTP.

**Альтернатива:** отдельный token store для SMTP — rejected (пользователь авторизуется дважды). **Альтернатива:** второй access token только под SMTP scope — rejected (Microsoft допускает multi-scope в одном токене, нет смысла плодить).

### D3. SMTP-соединение — не переиспользует IMAP-сессию, отдельный транспорт

SMTP и IMAP — разные протоколы/порты. `mail.send` открывает **кратковременное** SMTP-соединение через `nodemailer.createTransport(opts)`, отправляет, закрывает (`transport.close()`). Не хранится в `MailSessionStore` (тот для IMAP-сессий). Но тул **требует активное `mail.connect`** — не для SMTP, а как gate: подтверждает, что аккаунт валиден и провайдер выбран (спека `mail/send` «Требуется активное подключение»). Это reuse существующего UX-контракта (`mail.fetch`/`mail.downloadAttachments` тоже требуют сессию).

**Альтернатива:** отдельный `SmtpSessionStore` — rejected (SMTP stateless per-send, нечего хранить). **Альтернатива:** не требовать `mail.connect`, брать аккаунт из `deps.accounts` напрямую — rejected (нарушает контракт помощника: все операции с ящиком через активную сессию, единая точка валидации аккаунта; спека явно требует gate).

Из `sessionStore.get(login)` тул берёт `MailAccount` (через `MailSessionStore` расширить сохранение аккаунта — уже хранит `{ provider, account }`, добавим геттер `getAccount(login)`) и `MailProvider.providerKind` для выбора SMTP-параметров. Auth-стратегия строится по `account` через существующую factory-логику (`buildOAuth2Strategy`-аналог).

### D4. Параметры SMTP-соединения по провайдеру

| Провайдер | Host | Port | Secure | Auth |
|-----------|------|------|--------|------|
| Яндекс | `smtp.yandex.ru` | 465 | true (TLS) | basic (`{user, pass}`) |
| Outlook | `smtp-mail.outlook.com` | 587 | false (STARTTLS) | oauth2 (`{user, accessToken}`) |

Функция `smtpConnectionFor(providerKind): { host, port, secure }` (аналог `connection` getter в провайдерах). Outlook STARTTLS на 587 — стандарт для личных `@outlook.com`; `smtp.office365.com:587` — для корпоративных (не наш случай, tenant `consumers`). **Альтернатива:** `smtp.office365.com:465` — rejected (Microsoft deprecates 465 для consumers, 587+STARTTLS документирован). Захардкоженные параметры выносятся в `providers/smtp-options.ts` (чистые данные, тестируемые).

### D5. `ComposeMailInput` — схема критериев письма

```ts
interface ComposeMailInput {
  to: EmailAddress[];        // ≥1 (спека: хотя бы один TO)
  cc?: EmailAddress[];
  bcc?: EmailAddress[];
  subject: string;           // непустое (спека)
  text: string;              // text/plain, обязательно (Non-Goal: HTML-only)
  html?: string;             // text/html альтернатива
  attachments?: { path: string }[];  // локальные файлы, абсолютные пути
  encoding?: string;         // default 'utf-8'
}
interface EmailAddress { name?: string; address: string; }
```

Переиспользуется `EmailAddress` из `src/types/email.ts`. Валидация (`validateComposeMail(input): ValidationResult`): ≥1 получателя суммарно (TO/CC/BCC), все адреса валидного формата (regex RFC-822-упрощённый), `subject` непустое, `text` непустое, пути вложений существуют (`fs.stat`). `ValidationResult` = `{ valid: boolean, errors: string[] }`.

### D6. Двухфазный протокол подтверждения — stateless, через флаг `confirm`

Тул `mail.send` принимает `{ login, mail: ComposeMailInput, confirm: boolean }`:
- `confirm !== true` → `validateComposeMail` + возврат `SendPreview { ready: false, preview: { from, to, cc, bcc, subject, textLength, hasHtml, attachments: [{filename, size}] }, validation: { valid, errors } }`. **Без SMTP-соединения.**
- `confirm === true` → `validateComposeMail`; если `valid === false` → возврат `{ ready: false, validation }` без отправки; иначе — `sendMail` через транспорт → `SendResult { ready: true, messageId, recipients: string[] }`.

**Stateless:** повторный вызов с `confirm:true` переотправит (если аккаунт активен). Оркестратор/транспорт держит состояние «пользователь подтвердил» — тул его не хранит (соответствует stateless-контракту помощника, `archive/2026-10-28-helper-agent/`). **Альтернатива:** session-scoped draft id (первый вызов создаёт draft, второй — `confirm` по id) — rejected (вводит состояние в тул, ломает stateless-модель, усложняет сериализацию результата тулa в цикле). **Альтернатива:** подтверждение на уровне транспорта (тул всегда отправляет, оркестратор решает) — rejected (PLAN.md 8.5: «агент показывает черновик и ждёт подтверждения» — предпросмотр обязан быть observable-поведением тулa, спека `mail/send` «Подтверждение перед отправкой»).

`SendResult` и `SendPreview` — discriminated union по полю `ready`: цикл тулов/оркестратор различает ответ по `ready` (true = отправлено, false = ждёт подтверждения/невалидно).

### D7. Injectable `SmtpTransport` + `SmtpTransportFactory`

```ts
interface SmtpTransport {
  sendMail(opts: nodemailer.SendMailOptions): Promise<{ messageId: string }>;
  close(): Promise<void>;
}
type SmtpTransportFactory = (opts: nodemailer.TransportOptions) => SmtpTransport;
```

Дефолтная фабрика: `createDefaultTransport(opts)` → `nodemailer.createTransport(opts)` (обёртка, типизированная под `SmtpTransport`). Deps тулa: `{ sessionStore, accounts, transportFactory?, oauth2?, tokenStorePath? }`. В тестах — `transportFactory` отдаёт mock, записывающий `sendMail`-вызовы (unit), или реальный nodemailer против `smtp-server` (integration). Паттерн симметричен `ImapClientFactory` в `abstract-imap-provider.ts`.

### D8. Включение в helper и compose

- `HELPER_TOOLS` (`src/agents/helper.ts`) += `'mail.send'`.
- `registerMailConnectTools` (`src/tools/mail/register-tools.ts`) — добавить `createMailSendTool({ sessionStore, accounts, transportFactory, oauth2, tokenStorePath })` в реестр. Альтернатива — отдельный `registerMailSendTools` — rejected (один mail-регистратор = один вызов в `composeAgents`, меньше точек отказа; `registerMailConnectTools` уже регистрирует все mail-тулы, имя можно оставить или переименовать в `registerMailTools`). Решение: расширить существующий `registerMailConnectTools` (переименовать опц. в `registerMailTools` с alias для обратной совместимости compose — но compose локален, достаточно переименовать + обновить вызов).
- `composeAgents` получает опц. `smtpTransportFactory?`; при отсутствии — тул создаётся с дефолтной фабрикой (real nodemailer). Graceful: compose не падает без явной фабрики.
- `skills/helper.md`: добавить `mail.send` в раздел доступных тулов (двухфазный протокол: без `confirm` → предпросмотр, с `confirm:true` → отправка), снять ограничение «не отправляешь письма».

### D9. Безопасность — `redact` + secrets из конфига

- Учётные данные берутся из `account` (через `sessionStore.getAccount(login)` или `deps.accounts.find`) и `OAuthTokenStore` — НЕ из аргументов тулa (спека «Секреты не в аргументах тулa»).
- SMTP-ошибки пропускаются через `redact(message, account.password, account.login)` (переиспользование `src/tools/mail/redact.ts`).
- `accessToken`/`refreshToken` добавляются в redact-набор при oauth2 (расширить вызов `redact` или использовать существующий — он вырезает по подстроке, достаточно передать токен как секрет).
- Вложения: проверка, что `path` — абсолютный и файл существует; тул читает файл через nodemailer (`attachments: [{ path }]`), сам не интерпретирует содержимое.

### D10. Тестирование — мок-транспорт + `smtp-server` mock

- **Unit `tests/mail-send-tool.test.ts`**: mock `SmtpTransport` (записывает `sendMail` opts, возвращает `{ messageId }`), stub `sessionStore` (active + inactive), stub аккаунт. Сценарии: (1) `confirm:false` → preview, transport.sendMail НЕ звался; (2) `confirm:true` валидное → sendMail звался, `ready:true`; (3) `confirm:true` невалидное → `ready:false`, sendMail НЕ звался; (4) нет сессии → ошибка; (5) несколько получателей TO/CC/BCC; (6) вложения; (7) ошибка SMTP → redact.
- **Unit `tests/smtp-client.test.ts`**: `SmtpClient` построение опций по провайдеру (Яндекс 465/basic, Outlook 587/STARTTLS/oauth2), стратегия `getSmtpAuth` для basic/oauth2.
- **Unit `tests/compose-mail.test.ts`**: `validateComposeMail` — все ветви валидации (нет получателей, кривой адрес, пустая тема, пустое тело, валидный минимум).
- **Integration `tests/integration/mail-send-smtp-server.test.ts`** (gated `INTEGRATION_SMTP=1` или без gate, т.к. mock-сервер локальный и быстрый): поднимает `smtp-server` на случайном порту, тул отправляет реальное письмо через nodemailer → assert сервер получил `MAIL FROM`/`RCPT TO`/`DATA` с правильными заголовками и телом; вложения (base64); несколько получателей. Без внешних аккаунтов — можно не gate, но для единообразия оставить всегда-on (быстрый, детерминированный).
- **Integration `tests/integration/mail-send-real.test.ts`** (gated `INTEGRATION_TEST=1`): реальная отправка через Яндекс/Outlook на тестовый адрес; ручное подтверждение (помечается manual-verified, т.к. шлёт реальное письмо). Опционально, при наличии тестового ящика.

`smtp-server` + `@types/smtp-server` — dev-зависимости. `nodemailer` + `@types/nodemailer` — runtime/dev.

## Risks / Trade-offs

- **[Риск: refresh-token под старым scope не покрывает SMTP сразу]** → Mitigation: первый `getSmtpAuth` для Outlook вызовет `obtainAccessToken` → `refresh()` с новым scope → ротация токена → persist. Если refresh отозван — device flow (пользователь повторно авторизуется с расширенным scope). Документировать в `.env.example`/tasks: после установки Фазы 4 Outlook может потребовать повторной авторизации один раз.
- **[Риск: `smtp-mail.outlook.com:587` STARTTLS требует актуального TLS-стека]** → Mitigation: nodemailer использует Node TLS; Node ≥ 20 актуален. Gated-тест против реального Outlook подтвердит.
- **[Риск: отправка реального письма в тесте — побочный эффект]** → Mitigation: unit + smtp-server integration полностью детерминированы (mock); реальный gated-тест помечен manual, требует явного запуска и тестового ящика-получателя.
- **[Трейд-офф: stateless подтверждение vs draft-id]** → stateless проще, соответствует контракту помощника; цена — повторный `confirm:true` переотправит. Оркестратор ответственен за gated UX («показал черновик → ждёт подтверждения → затем один вызов send с confirm»). Записано в D6.
- **[Трейд-офф: требование `mail.connect` для SMTP]** → gate по IMAP-сессии может показаться избыточным (SMTP не зависит от IMAP), но сохраняет единый UX-контракт помощника и спеку `mail/send`. Альтернатива (без gate) ломает согласованность с `mail.fetch`/`mail.downloadAttachments`.
- **[Риск: пароль приложения Яндекс для SMTP — тот же что IMAP]** → подтверждено Яндекс-документацией (один пароль приложения на все протоколы ящика). Без отдельной настройки.
- **[Риск: `DEFAULT_SCOPE` меняется глобально — влияет на IMAP device flow]** → новый scope — надмножество старого; IMAP-операции продолжают работать (access token имеет оба права). Не breaking для IMAP.

## Migration Plan

Greenfield SMTP поверх существующего фундамента. Развёртывание:

1. Установить зависимости: `npm i nodemailer`, `npm i -D @types/nodemailer smtp-server @types/smtp-server`.
2. Расширить `AuthStrategy` (`mail-provider.ts`) + `BasicAuthStrategy`/`OAuth2MsalStrategy` методом `getSmtpAuth`.
3. Расширить `MSDeviceFlowClient.DEFAULT_SCOPE` на `SMTP.Send` (D2).
4. `src/tools/mail/providers/smtp-options.ts` — параметры соединения по провайдеру (D4).
5. `src/tools/mail/smtp-client.ts` — `SmtpClient`/`SmtpTransport`/`SmtpTransportFactory`/`createDefaultTransport` (D7).
6. `src/tools/mail/compose-mail.ts` — `ComposeMailInput` + `validateComposeMail` (D5).
7. `src/tools/mail/mail-send.tool.ts` — тул с двухфазным протоколом (D6).
8. `MailSessionStore.getAccount(login)` — геттер аккаунта (D3).
9. `register-tools.ts` — регистрация `mail.send` (D8); `helper.ts` whitelist; `compose.ts` опц. `smtpTransportFactory`; `skills/helper.md`.
10. Юнит-тесты (`mail-send-tool`, `smtp-client`, `compose-mail`).
11. Integration `smtp-server` mock + gated реальный тест.
12. `npm test`, `tsc`, `lint`, `openspec validate mail-send --strict`.

**Откат:** удалить `smtp-client.ts`, `compose-mail.ts`, `mail-send.tool.ts`, `providers/smtp-options.ts`; откатить `AuthStrategy` (убрать `getSmtpAuth`), `DEFAULT_SCOPE`, `session-store`, `register-tools`, `helper.ts`, `compose.ts`, `skills/helper.md`. `nodemailer`/`smtp-server` можно оставить или удалить. Обратно-совместимо: тул `mail.send` новый, его отсутствие не ломает существующих потребителей.

## Open Questions

- **Точный SMTP-хост Outlook для личных `@outlook.com` под tenant `consumers`:** `smtp-mail.outlook.com:587` (документирован для consumers) vs `smtp.office365.com:587` (корпоратив). Решено в D4 (`smtp-mail.outlook.com:587`), но верифицируется gated-тестом `mail-send-real.test.ts` — если отклонит, переключить на `smtp.office365.com:587`. Не меняет спеки/подход (параметр в `smtp-options.ts`).
- **Нужно ли отдельное gated-имя для SMTP-интеграции:** `INTEGRATION_TEST=1` (существующий) покрывает реальную отправку; mock `smtp-server` — без gate. Решено в D10. Deferrable: если реальный тест нестабилен, можно оставить только mock + manual.
