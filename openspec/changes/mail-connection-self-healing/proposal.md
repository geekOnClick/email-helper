# Proposal

## Why

Guided-команды CLI (`/analyze`, `/analyze-many`, `/analyze-attachments`, `/smart-search`, `/smart-send`) подключаются к IMAP один раз и переиспользуют сессию между запросами. `SessionStore` — простой `Map`, а `ensureMailConnected` проверяет только наличие записи (`store.has()`), без проверки живости TCP-соединения. Когда сервер (Яндекс) закрывает простаивающее соединение по IDLE-таймауту или рвётся сеть, запись в `Map` остаётся, но сокет мёртв — следующий запрос пользователя падает с `Connection not available`, даже если `mail.connect` ранее отработал. Существующий retry-механизм провайдера ограничен (`MAIL_OP_MAX_RETRIES` по умолчанию 1) и исключает ошибку «подключение не установлено» из повторов, поэтому на нестабильном соединении восстановление часто не успевает.

## What Changes

- **Прозрачное переподключение в guided-командах**: `ensureMailConnected` SHALL проверять не только наличие сессии в `SessionStore`, но и её живость. Если сессия есть, но реальное соединение разорвано (imapflow `client.usable === false` или эквивалент) — система SHALL прозрачно переподключиться (reconnect провайдера) перед выполнением операции, без запроса к пользователю. Если сессии нет изначально — подключение через `mail.connect` (как сейчас).
- **Новый публичный контракт провайдера для проверки живости и переподключения**: провайдер SHALL предоставлять `isConnectionUsable(): boolean` (делегирует в imapflow `client.usable`, толерантен к `client === null`) и `reconnect(): Promise<void>` (существующий `reconnect` делается публичным). Так `SessionStore`/guided-команды могут прозрачно поднимать упавшее соединение.
- **Повышение потолка повторов**: дефолт `MAIL_OP_MAX_RETRIES` поднимается с 1 до **2** (итого до 3 попыток на операцию). Даёт больше шансов на восстановление при сетевых блыпаниях и IDLE-обрывах.
- **Retry для «подключение не установлено»**: ошибка `подключение не установлено` (из `requireClient()` при `this.client === null` после неудачного/невызванного reconnect) SHALL трактоваться как connection-ошибка и подпадать под retry-цикл `runWithTimeoutAndRetry` (с переподключением). Сейчас она специально исключена — это мешает восстановлению, когда reconnect обнулил `client`.
- **Обнаружение мёртвой сессии в lifecycle**: требование «Жизненный цикл IMAP-сессии» (`mail/connection`) дополняется сценарием — сессия в `SessionStore` с разорванным сокетом SHALL определяться как непригодная и прозрачно переподключаться при следующем использовании.
- **Не меняется**: тулы `mail.*` (контракты `search`/`fetch`/`downloadAttachments`/`send`/`connect`), MCP-путь оркестратора, стратегии аутентификации, token store, формат ошибок (маскировка секретов). Retry-цикл `runWithTimeoutAndRetry` и `reconnect()` сохраняют текущую логику закрытия старого client + нового `tryConnect` без изменения учётных данных.

## Capabilities

### New Capabilities

_(нет — изменения затрагивают существующие capability `mail/connection`, `mail/search`, `mail/attachments`, `transport/cli`.)_

### Modified Capabilities

- `mail/connection`: MODIFIED «Жизненный цикл IMAP-сессии» (сценарий обнаружения мёртвой сессии + прозрачного переподключения); ADDED «Проверка живости и прозрачное переподключение» (контракт `isConnectionUsable`/публичный `reconnect`).
- `mail/search`: MODIFIED «Повтор операции поиска при обрыве соединения» (дефолт `MAX_RETRIES` = 2; retry для «подключение не установлено»).
- `mail/attachments`: MODIFIED «Повтор операций чтения и скачивания при обрыве соединения» (дефолт `MAX_RETRIES` = 2; retry для «подключение не установлено»).
- `transport/cli`: ADDED «Проверка живости соединения в guided-командах» (`ensureMailConnected` проверяет `isConnectionUsable` и прозрачно переподключается).

## Impact

- **Исходный код**:
  - `src/tools/mail/providers/abstract-imap-provider.ts`: публичный `reconnect()` (был `protected`), новый `isConnectionUsable()`; `isConnectionError()` больше не исключает «подключение не установлено» (теперь connection-ошибка).
  - `src/tools/mail/mail-provider.ts`: добавить `isConnectionUsable()`/`reconnect()` в интерфейс `MailProvider`.
  - `src/transport/cli/commands/connect.ts` (`ensureMailConnected`): после `store.has()` — проверка `provider.isConnectionUsable()`; если мёртв — `provider.reconnect()` (с выводом прогресса); при неудаче — `false`.
  - `src/config/schema.ts`: `MAIL_OP_MAX_RETRIES` дефолт `1 → 2`.
- **Конфигурация**: `MAIL_OP_MAX_RETRIES` дефолт 2 (в `.env` может быть переопределён).
- **Тесты**: новые тесты на `isConnectionUsable`/публичный `reconnect`; `ensureMailConnected` с мёртвой сессией → переподключение; retry для «подключение не установлено»; адаптация существующих тестов провайдера (метод `reconnect` стал публичным).
- **MCP-путь и тулы `mail.*`**: контракты тулов не меняются; retry/reconnect-механизм провайдера усиливается (больше попыток, прозрачнее восстановление), что полезно и для MCP-пути (оркестратор получает те же тулы).
