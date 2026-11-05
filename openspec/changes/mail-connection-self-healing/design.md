# Design

## Context

Guided-команды CLI подключаются к IMAP один раз и переиспользуют сессию между запросами через `SessionStore` (`src/tools/mail/session-store.ts`) — простой `Map<login, {provider, account}>`. `ensureMailConnected` (`src/transport/cli/commands/connect.ts`) проверяет только `store.has(login)` без проверки живости TCP-сокета. imapflow выставляет `client.usable = false` при разрыве (`imap-flow.js:254`), но этот признак не используется.

Retry-механизм провайдера (`abstract-imap-provider.ts:runWithTimeoutAndRetry`) ловит `Connection not available` и делает reconnect, но: (1) `MAIL_OP_MAX_RETRIES` по умолчанию 1 → 2 попытки; (2) `isConnectionError()` специально исключает «подключение не установлено» (стр. 408) — если `reconnect()` обнулил `this.client` и упал, повторной попытки нет; (3) `reconnect()` сейчас `protected` — внешние потребители (guided-команды) не могут прозрачно поднять соединение до операции.

`MailProvider` интерфейс (`src/tools/mail/mail-provider.ts`) — контракт всех провайдеров (yandex/outlook). `AbstractImapProvider` — базовый класс с `runWithTimeoutAndRetry`/`reconnect`/`requireClient`.

## Goals / Non-Goals

**Goals:**
- Guided-команды прозрачно поднимают упавшее в простое соединение при запросе пользователя — без ошибки `Connection not available` и без повторного ввода учётных данных.
- Усилить retry-механизм провайдера: больше попыток по умолчанию, retry для «подключение не установлено».
- Переиспользовать существующий `reconnect()` (закрытие старого client + `tryConnect`) без новой логики подключения.
- Сохранить контракты тулов `mail.*` и MCP-путь без изменений.

**Non-Goals:**
- Не меняем тулы `mail.*` (контракты `search`/`fetch`/`downloadAttachments`/`send`/`connect`), MCP-оркестратор, стратегии аутентификации, token store.
- Не вводим фоновый heartbeat/keepalive (NOOP-пинг по таймеру) — только проверка по запросу.
- Не меняем маскировку секретов в ошибках и формат `ConnectError`.
- Не добавляем автоматический reconnect при `dispose` (явное закрытие остаётся закрытием).

## Decisions

### D1: Публичные `isConnectionUsable()` и `reconnect()` в `MailProvider`

Добавить в интерфейс `MailProvider` два метода:
- `isConnectionUsable(): boolean` — возвращает `true` только если `this.client !== null` и нижележащий imapflow-клиент пригоден (`client.usable === true`). Толерантен к `client === null` (возвращает `false`). Не выполняет сетевых операций — только читает состояние.
- `reconnect(): Promise<void>` — существующий `protected reconnect()` (`abstract-imap-provider.ts:436`) делается `public`. Закрывает старый client (logout), открывает новый через `tryConnect(this.strategy)`, не меняя `this.account`. Уже реализован — просто меняем видимость.

**Альтернатива (а):** приватный метод + публичный `ensureUsable()`, который сам решает — отказались (меньше гибкости; guided-команде нужно отдельно проверить, отдельно переподключить, чтобы вывести прогресс).
**Альтернатива (b):** NOOP-пинг (`client.noop()`) вместо `client.usable` — отказались (лишний round-trip; `usable` уже отражает разрыв, выставляется imapflow при close/error).

### D2: `ensureMailConnected` проверяет живость и прозрачно переподключает

В `connect.ts` после `store.has(login)`:
1. Достать провайдер: `const provider = store.get(login)`.
2. Если `provider` есть — проверить `provider.isConnectionUsable()`.
3. Если пригодно — `return true` (как сейчас).
4. Если непригодно (мёртвый сокет) — вывести прогресс `Переподключение к <login>...`, вызвать `await provider.reconnect()`, при успехе `return true`, при ошибке — сообщение + `return false`.

Если `store.has()` = false — текущий путь через `mail.connect` (без изменений).

**Альтернатива:** удалить сессию из store и подключиться через `mail.connect` заново — отказались (теряем провайдер с уже загруженными folder cache; `reconnect()` переиспользует существующий lifecycle и стратегию, чище).

### D3: Дефолт `MAIL_OP_MAX_RETRIES` 1 → 2

В `src/config/schema.ts` `MAIL_OP_MAX_RETRIES` дефолт меняется с 1 на 2 (итого до 3 попыток на операцию: первичная + 2 повтора). Смягчает сетевые блыпания и IDLE-обрывы, когда первая reconnect-попытка тоже падает. В `.env` может быть переопределён.

**Альтернатива:** оставить 1, поднять только в `.env` — отказались (дефолт должен быть устойчивым; пользователи не обязаны знать про эту настройку).

### D4: «Подключение не установлено» становится connection-ошибкой

В `isConnectionError()` (`abstract-imap-provider.ts:402`) убрать исключение `if (msg.includes('подключение не установлено')) return false`. Теперь `requireClient()` бросает «подключение не установлено» при `this.client === null` → `isConnectionError()` возвращает `true` → `runWithTimeoutAndRetry` тратит попытку на `reconnect()` и повторяет операцию. Это покрывает сценарий: первичная попытка упала (socket мёртв) → `reconnect()` обнулил `this.client`, но сам упал → раньше повторной попытки не было (ошибка «подключение не установлено» исключалась) → теперь есть.

**Альтернатива:** в `reconnect()` при неудаче бросать connection-ошибку вместо «подключение не установлено» — отказались (меньше точечно; `requireClient()` и так даёт правильное сообщение, важно лишь не исключать его из retry).

### D5: Изменение видимости `reconnect` безопасно для тестов

`reconnect` сейчас `protected`, вызывается только внутри `runWithTimeoutAndRetry`. Делаем `public` — существующие тесты провайдера не ломаются (метод остаётся, просто доступен снаружи). Тесты, мокающие `MailProvider`, должны будут добавить `isConnectionUsable`/`reconnect` в стаб — учитываем в задачах.

## Risks / Trade-offs

- **`isConnectionUsable` = `client.usable` не идеален.** imapflow выставляет `usable` не мгновенно при тихом разрыве (сервер закрыл, но мы ещё не пытались писать). Возможен ложный `true` → операция падает `Connection not available` → ловится retry-циклом (D3+D4 усилили). Компромисс: проверка бесплатна, но не гарантирует; retry-цикл — запасной механизм. Итого двойная защита: proactive (D2) + reactive (D3+D4).
- **Больше retry-попыток = дольше ожидание при реальной недоступности.** 3 попытки × таймаут 30с = до 90с на операцию при мёртвом сервере. Принимаем ради устойчивости; `LLM_REQUEST_TIMEOUT_MS` отдельно (60с) не связан.
- **Публичный `reconnect` могут вызвать внешние потребители в неподходящий момент.** Метод не реентерабелен (обнуляет `this.client` посредине). Documentируем: не вызывать параллельно с операциями. Guided-команды вызывают последовательно перед операцией — безопасно.
- **«Подключение не установлено» в retry** может маскировать логическую ошибку (аккаунт не подключался через `mail.connect` вообще). Но `ensureMailConnected` (D2) подключает, если сессии нет; в MCP-пути оркестратор сам вызывает `mail.connect`. Так что `client === null` в операции — почти всегда результат упавшего reconnect, что корректно трактовать как connection-ошибку.
