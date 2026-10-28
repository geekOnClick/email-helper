# Proposal

## Why

Фаза 0 (bootstrap) завершена: есть TypeScript-скелет с конфиг-схемой, но ни один тул не реализован. По `PLAN.md` (раздел 5, Фаза 1) всё взаимодействие с почтой начинается с подключения к ящику — без работающего `mail.connect` невозможны последующие тулы (`mail.search`, `mail.fetch`, `mail.downloadAttachments`). Дополнительно `PLAN.md` (раздел 3.0) фиксирует технический риск по Outlook: статус базовой аутентификации для личных `@outlook.com`-аккаунтов неоднозначен и требует проверочного теста в начале фазы. Этот change закрывает оба вопроса: вводит подключение по IMAP и список папок для Яндекс + Outlook, с плавающей стратегией аутентификации (`basic` | `oauth2`).

## What Changes

- Новый интерфейс `MailProvider` + реализации `YandexMailProvider`, `OutlookMailProvider` в `src/tools/mail/providers/`.
- Подключение к IMAP через `imapflow`: Яндекс — `imap.yandex.ru:993` (basic, пароль приложения); Outlook — `outlook.office365.com:993` (basic или OAuth2 по итогам проверочного теста).
- Стратегии аутентификации `basic` и `oauth2` (device code flow для Microsoft identity platform v2.0), выбираемые per-аккаунт; архитектура позволяет добавить стратегию прозрачно, без переписывания логики подключения.
- Тул `mail.connect` (подключение к ящику, управление жизненным циклом IMAP-сессии) и `mail.listFolders` (список папок ящика).
- **Первой задачей — проверочный тест** Outlook basic-auth (см. риск 3.0): если логин/пароль входят — реализуется `basic`; если нет — реализуется OAuth2 device code flow.
- Безопасное хранение учётных данных: расширение `ConfigSchema` (`authStrategy`, параметры OAuth2 — `MS_CLIENT_ID`, `MS_TENANT`), хранилище выданных OAuth2-токенов (refresh-token) в локальном файле вне git.
- Юнит-тесты с моком IMAP-клиента; проверочный тест подключается к реальному тестовому ящику (интеграционный, опционально, gated).

## Capabilities

### New Capabilities

- `mail/connection`: подключение к почтовому ящику по IMAP и получение списка папок, с поддержкой стратегий аутентификации `basic` и `oauth2` (Microsoft device code flow). Охватывает жизненный цикл IMAP-сессии (открытие/закрытие), абстракцию провайдера (Яндекс, Outlook) и хранение учётных данных/OAuth2-токенов.

### Modified Capabilities

Нет — существующих спек в проекте пока нет (`openspec list --specs` → «No specs found»).

## Impact

- **Новый код:** `src/tools/mail/` — `imap-client.ts`, `mail-provider.ts` (интерфейс), `providers/yandex.ts`, `providers/outlook.ts`, `types.ts` (типы `Folder`, `MailAccount`, `AuthStrategy`, `ConnectionResult`); `src/tools/registry.ts` (каркас реестра тулов — начнётся в этой фазе минимально).
- **Новые зависимости:** `imapflow` (IMAP-клиент), `@types/imapflow` (dev), `nodemailer` не нужен в этом change (Фаза 4).
- **Расширение `ConfigSchema`** (`src/config/schema.ts`): `authStrategy` в `AccountSchema` (`'basic' | 'oauth2'`, по умолчанию `'basic'`), `MS_CLIENT_ID`, `MS_TENANT` (default `consumers`), `OAUTH_TOKEN_STORE_PATH`.
- **Внешние системы:** `imap.yandex.ru:993`, `outlook.office365.com:993`, Microsoft identity platform (`https://login.microsoftonline.com/<tenant>/oauth2/v2.0/`) для device code flow при неудаче basic-auth.
- **Тесты:** мок IMAP-клиента (юнит) + интеграционный тест против тестовых ящиков из `.env` (gated переменной окружения, не падает в CI без аккаунтов).
- **Не затрагивает:** SMTP/отправку (Фаза 4), поиск/чтение/вложения (отдельные change'ы Фазы 1: `mail-search`, `mail-attachments`), LLM, векторную БД.