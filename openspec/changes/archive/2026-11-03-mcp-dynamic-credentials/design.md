# Design: mcp-dynamic-credentials

## Context

См. `proposal.md` — Why. Кратко текущее состояние: тул `mail.connect` ищет аккаунт по `login` в массиве `deps.accounts`, который формируется из `.env` (`ACCOUNTS`) при `bootstrap()`. Сессия сохраняется в `MailSessionStore` по `login`, последующие тулы (`mail.search`, `mail.fetch`, `mail.downloadAttachments`, `mail.send`, `embeddings.index`) получают провайдер через `sessionStore.get(login)`. `mail.send` дополнительно берёт аккаунт через `sessionStore.getAccount(login)` для SMTP.

Таким образом, динамические креды достаточно интегрировать только в `mail.connect` — точку создания сессии. Остальные тулы не требуют изменений, т.к. работают по `login` уже сохранённой сессии.

## Goals / Non-Goals

**Goals:**

- Внешний MCP-клиент может подключиться к своему ящику, передав `login` + `credentials` в вызов `mail.connect`.
- Сохраняется обратная совместимость: вызов только с `login` использует `.env` (существующие CLI и MCP-клиенты работают без изменений).
- Динамические пароли не утекают в логи, ошибки, ответы и не пишутся на диск.

**Non-Goals:**

- Не добавляем динамическую передачу OAuth2-конфига (`MS_CLIENT_ID`, `MS_TENANT`) — это инфраструктурная настройка сервера, берётся из `.env`. Для Outlook+oauth2 в headless MCP рекомендуем `basic` стратегию или интерактивный device code flow (вывод в stderr сервера).
- Не меняем контракты `mail.search`/`mail.fetch`/`mail.downloadAttachments`/`mail.send`/`embeddings.index` — они продолжают работать по `login` сохранённой сессии.
- Не добавляем аутентификацию/авторизацию самого MCP-клиента (кто может вызывать тулы) — это отдельная задача безопасности транспорта.
- Не меняем `MailSessionStore` — он уже хранит `MailAccount` по `login`, временный аккаунт просто записывается туда как любой другой.

## Decisions

### D1: Куда внедрять динамические креды — только `mail.connect`

**Решение:** динамический блок `credentials` добавляется только в тул `mail.connect`.

**Альтернатива:** передавать `credentials` в каждый тул. Отвергнута — дублирование логики создания аккаунта, риск рассинхона кред между вызовами, усложнение схем всех тулов. Текущая архитектура (`MailSessionStore` по `login`) уже изолирует остальные тулы от источника кред.

### D2: Формат блока `credentials`

**Решение:** опциональный объект в `inputSchema` тулa `mail.connect`:

```
credentials: {
  provider: 'yandex' | 'outlook',   // обязательное
  password: string,                  // обязательное
  authStrategy: 'basic' | 'oauth2'   // опц., по умолчанию 'basic'
}
```

`login` остаётся обязательным полем верхнего уровня (идентификатор сессии). Если `credentials` передан — временный `MailAccount` строится из `{ login (из args), provider, password, authStrategy }` и используется вместо `.env`-аккаунта. `oauth2`-конфиг (`MS_CLIENT_ID`, `MS_TENANT`) берётся из `deps.oauth2` (передаётся при регистрации тулa из `bootstrap`).

**Альтернатива:** принимать `password` на верхнем уровне рядом с `login`. Отвергнута — группировка в `credentials` делает схему самодокументируемой и позволяет позже добавить поля (напр. `clientId` для OAuth2 без расширения верхнего уровня).

### D3: Временный `MailAccount` — in-memory, не персистится

**Решение:** временный аккаунт создаётся как обычный объект `MailAccount` (тот же тип, что из `.env`), передаётся в `createMailProvider` и сохраняется в `MailSessionStore.set(account, provider)`. Никаких отдельных хранилищ или флагов «динамический» — `MailSessionStore` не различает источники аккаунтов. Пароль живёт в памяти процесса до `dispose(login)` / `disposeAll()`.

**Обоснование:** `MailSessionStore` уже хранит `MailAccount` (включая пароль) для `.env`-аккаунтов — динамические креды не вводят нового класса данных. `mail.send` уже использует `sessionStore.getAccount(login)` для SMTP — работает автоматически.

### D4: Маскирование динамических паролей

**Решение:** существующая `redact(text, ...secrets)` применяется в `mail.connect` для маскирования динамического пароля в сообщениях ошибок (как уже делается в `mail.send`). Дополнительно: динамический пароль добавляется в список секретов `consoleToolLogger` для observability — но т.к. логгер создаётся в `bootstrap` до вызова тулов, используется подход per-call: обработчик `mail.connect` при ошибке вызывает `redact(msg, account.password, account.login)` вручную (как `mail.send`).

**Альтернатива:** глобальный реестр секретов, пополняемый при `mail.connect`. Отвергнута — усложнение, race conditions в concurrent MCP-вызовах. Per-call `redact` в обработчике проще и достаточен (ошибка — единственный путь утечки; успешный результат не содержит пароль).

### D5: Валидация блока `credentials`

**Решение:** если `credentials` передан, проверяются обязательные поля `provider` и `password`. Невалидный `provider` (не `yandex`/`outlook`) → ошибка с понятным сообщением. Пустой `password` → ошибка. `authStrategy` опц., по умолчанию `basic`; невалидное значение → ошибка. Валидация выполняется в обработчике тулa (runtime), JSON-схема `inputSchema` описывает структуру для MCP-клиентов.

### D6: JSON-схема и MCP-экспозиция

**Решение:** обновлённая `inputSchema` тулa `mail.connect` автоматически попадает к MCP-клиентам через `tools/list` (существующий `registerDomainTools` передаёт `inputSchema` на wire без изменений). Никаких отдельных изменений в MCP-адаптере не требуется.

## Risks / Trade-offs

- **[Пароль в памяти процесса до dispose]** → При long-running MCP-сервере динамические пароли накапливаются в `MailSessionStore`. Mitigation: `dispose(login)` при явном отключении; `disposeAll()` при завершении сервера (уже реализовано в `cleanup`). Документировать в README, что MCP-клиент должен вызывать очистку или сервер перезапускается периодически.
- **[Concurrent вызовы с одним login, разными кредами]** → Второй `mail.connect` с тем же `login` перезапишет сессию (`MailSessionStore.set` заменяет запись). Mitigation: это acceptable — `login` является ключом сессии по контракту; документировать, что `login` должен быть уникален per-клиент.
- **[OAuth2 для Outlook в headless]** → `oauth2` стратегия требует интерактивный device code flow (вывод URL/user code в stderr), что неудобно для MCP-клиента. Mitigation: документировать рекомендацию `basic` для MCP; OAuth2 остаётся доступным, но требует мониторинга stderr сервера.
- **[Доверие к MCP-клиенту]** → Любой подключённый MCP-клиент может передать произвольные креды и подключиться к любому ящику. Mitigation: out of scope (Non-Goal) — это ответственность транспорта (localhost-only HTTP, trust boundary stdio). Документировать.

## Migration Plan

1. Обновление обратно совместимо — существующие вызовы `mail.connect` с только `login` работают через fallback на `.env`.
2. Внешние MCP-клиенты начинают использовать блок `credentials` по мере необходимости; без него поведение не меняется.
3. Отката не требуется — `credentials` опционален. Для полного отката достаточно вернуть старую `inputSchema` (без блока `credentials`) и логику поиска только в `.env`.

## Open Questions

- Нет. Подход полностью определяется существующей архитектурой `MailSessionStore` и точкой внедрения `mail.connect`.
