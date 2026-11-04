# Design

## Context

См. `proposal.md` — Why. Текущее состояние релевантное подходу:

- Тул `mail.connect` (`src/tools/mail/mail-connect.tool.ts`) получает аккаунты через
  `deps.accounts: MailAccount[]`, который замыкается копией при регистрации тулa в
  `registerMailConnectTools` (вызов из `composeAgents` ← `bootstrap`). Массив строится
  один раз из `ACCOUNTS` (`.env`) в `loadConfigWithAccounts`. Таким образом, обновление
  `.env` в рантайме **не подхватывается** уже зарегистрированным тулом — это ключевой
  архитектурный факт, который меняет подход.
- Все IMAP-тулы кроме `mail.connect` работают по `login` через `MailSessionStore` и не
  зависят от источника аккаунтов (как зафиксировано в D1 change `mcp-dynamic-credentials`).
- `mail.send` берёт аккаунт через `sessionStore.getAccount(login)` (для SMTP) и через
  `deps.accounts.find(...)` как fallback. Fallback на `deps.accounts` нужно переключить
  на реестр для консистентности.
- Guided-команды (`/find`, `/analyze`, `/download`, `/send`) получают `accounts` копией
  через `CliRepl`-deps из `bootstrap().accounts`; выбор аккаунта (`promptAccount`) и
  `ensureMailConnected` работают по `login`. Для подхвата добавленных в сессии аккаунтов
  команды должны читать актуальный список из реестра.
- `.env` парсится через `dotenv` (`import 'dotenv/config'` в `loader.ts`); в файле есть
  комментарии и прочие переменные. Атомарная запись с сохранением структуры — новый
  механизм (прецедент: `OAuthTokenStore` пишет temp+rename+`chmod 0600`).
- `.env` уже вне git (`.gitignore`).
- CLI и MCP-сервер — **разные процессы**. `npm start` (CLI) и `npm run mcp` (или
  `mcp:http`) — отдельные запуски. Это критично для подхвата `.env`: добавленный через
  `/add-account` аккаунт виден в текущем CLI-процессе немедленно (через реестр), но для
  MCP-сервера требуется перезапуск процесса (он читает `.env` при своём `bootstrap`).

## Goals / Non-Goals

**Goals:**

- Пароль приложения никогда не пересекает MCP-wire и не попадает в контекст LLM
  вызывающего агента: по MCP передаются только `provider` + `login`, пароль сервер
  извлекает из `.env` in-memory.
- Заведение/обновление пароля доступно только через локальный CLI `/add-account`
  (минует MCP/LLM), с персистентностью в `.env`.
- Аккаунты, добавленные в текущей CLI-сессии, сразу доступны тулам и guided-командам
  без перезапуска (через изменяемый in-memory реестр).
- Обратная совместимость маскирования секретов сохранена (`redact()` в логах/ошибках).

**Non-Goals:**

- Не добавляем аутентификацию/авторизацию самого MCP-клиента (transport trust boundary —
  localhost-only HTTP, stdio trust) — отдельная задача.
- Не шифруем `.env` at-rest — он уже вне git и читается только процессом оператора;
  шифрование vault вынесено в отдельное future change.
- Не добавляем авто-перечитывание `.env` в MCP-сервере при изменении файла — для
  подхвата новых аккаунтов MCP-сервер перезапускается (документируется).
- Не меняем контракты `mail.search`/`mail.fetch`/`mail.downloadAttachments`/`mail.send`/
  `embeddings.index` — они продолжают работать по `login` сохранённой сессии.
- Не скрываем ввод пароля в `/add-account` (по решению оператора — обычный эхо-ввод).
- Не реализуем Yandex OAuth2 (отдельная future-спека).

## Decisions

### D1: In-memory `AccountRegistry` — изменяемый источник правды

**Решение:** вводится класс `AccountRegistry` (`src/config/account-registry.ts`),
инкапсулирующий изменяемый `MailAccount[]`. Инициализируется из `parseAccounts(ACCOUNTS)`
при `bootstrap()`. API: `findByProviderLogin(provider, login)`, `findByLogin(login)`,
`list()`, `upsert(account)` (с семантикой add-or-replace по `login`), `has(login)`.
Тул `mail.connect` и guided-команды получают ссылку на **один экземпляр** реестра и
читают его при каждом вызове (а не замкнутую копию массива).

**Альтернатива:** продолжать замыкать `accounts: MailAccount[]` и перерегистрировать тул
при изменении. Отвергнута — `registerTool` throws на дубликат имени; перерегистрация
потребовала бы `resetTools()`+полной перекомпозиции агента, что разрушает активные
IMAP-сессии и неатомарно. Изменяемый реестр — минимальное точечное изменение.

**Обоснование:** именно статичное замыкание мешает подхвату `/add-account` без
перезапуска. Реестр делает источник правды единым и изменяемым.

### D2: Поиск по паре `(provider, login)` строго

**Решение:** `mail.connect` принимает обязательные `login` и `provider`. Поиск через
`registry.findByProviderLogin(provider, login)`:
- найден → подключение с найденным аккаунтом;
- не найден, но `login` существует с другим `provider` → ошибка `provider_mismatch`;
- не найден ни с каким `provider` → ошибка `account_not_found`.

Логика различения: `findByProviderLogin` для точного совпадения; если промах —
`findByLogin(login)` чтобы отличить `provider_mismatch` от `account_not_found`.

**Альтернатива:** искать только по `login`, игнорируя `provider`. Отвергнута по решению
оператора (Q4) — защита от путаницы яндекс/outlook при одинаковом логине; `provider`
становится частью контракта, а не информацией.

### D3: Структурированная MCP-ошибка — JSON в text-блоке

**Решение:** при `account_not_found`/`provider_mismatch` тул `mail.connect` выбрасывает
специализированную ошибку (напр. `AccountLookupError` с полями `code`, `login`,
`provider`). MCP-адаптер (`adapters.ts`) уже оборачивает `throw` в `toMcpError(err)` →
`isError: true` + `content[].text`. Текст формируется как JSON-строка:

```json
{
  "error": "account_not_found",
  "message": "Аккаунт не найден в .env",
  "login": "user@yandex.com",
  "provider": "yandex",
  "hint": "Заведите аккаунт через CLI: /add-account (provider, login, password, authStrategy)"
}
```

`hint` для `provider_mismatch` уточняет, что переданный `provider` не совпадает с
заведённым. Пароль в ошибке не фигурирует.

**Альтернатива:** возвращать обычный текст ошибки. Отвергнута — вызывающему агенту нужна
машиночитаемая причина, чтобы понять: надо ли завести аккаунт или исправить `provider`.
JSON-в-text-блоке остаётся в рамках MCP-стандарта (`content[].text` — строка).

**Где формировать JSON:** в `toMcpError` (или в самом `mail.connect` через специальный
тип ошибки, который `toMcpError` сериализует в JSON). Решение: ввести
`AccountLookupError` с методом `toMcpJson()`; `toMcpError` детектит его и кладёт
`JSON.stringify(...)` в text-блок. Это локализует MCP-специфику в адаптере, не размазывая
по тулу.

### D4: Атомарная запись `.env` с сохранением структуры

**Решение:** новый сервис `EnvFileWriter` (`src/config/env-writer.ts`) с методом
`updateAccounts(path, accountsJson)`. Подход:

1. Прочитать `.env` как текст (если отсутствует — начать с пустого).
2. Построчно разобрать: для каждой строки определить, содержит ли она
   `ACCOUNTS=...` (ключ без учёта пробелов вокруг `=`). Сохранить порядок строк и
   комментарии (`#...`).
3. Заменить значение строки `ACCOUNTS` на новый JSON (одной строкой,
   `JSON.stringify(accounts)`). Если такой строки нет — добавить `ACCOUNTS=...` в конец
   (с переводом строки).
4. Атомарная запись: `writeFile(tmp, content)` → `chmod(tmp, 0o600)` → `rename(tmp,
   path)` (как `OAuthTokenStore`).

JSON пишется одной строкой (без pretty-print) — `dotenv` и `parseAccounts` читают
любой валидный JSON; компактная форма устойчива к переносам строк в `.env`.

**Альтернатива A:** использовать `dotenv` только для чтения, а запись — через
`fs.writeFile` с полной перегенерацией файла. Отвергнута: потеряла бы комментарии и
порядок прочих переменных.
**Альтернатива B:** подключить готовую либу (`@next/env`, `dotenv`-edit). Отвергнута:
лишняя зависимость для точечной задачи; round-trip строк проще и контролируем.

**Безопасность кавычек:** значение `ACCOUNTS` содержит `[` `]` `{` `}` `,` `:` — без
пробелов и спецсимволов shell, требующих кавычек, при компактном JSON. Если пароль
содержит `'` или `#` — `JSON.stringify` их не экранирует, но внутри JSON-значения они
безопасны (JSON-строки в двойных кавычках). Однако `dotenv` парсит значение после `=`
до конца строки; `#` внутри незакавыченного значения `dotenv` трактует как начало
комментария. Поэтому значение `ACCOUNTS` записывается **в двойных кавычках**:
`ACCOUNTS="[...]"` — `dotenv` раскрывает кавычки, а `parseAccounts` получает чистый JSON.

### D5: Команда `/add-account` — только CLI, не MCP

**Решение:** команда реализуется в слое CLI (`src/transport/cli/commands/add-account.ts`)
как guided-команда (мастер `ключ - значение` через существующий `prompts.ts`-паттерн),
вызывает `AccountRegistry.upsert()` + `EnvFileWriter.updateAccounts()`. Она **не**
регистрируется как доменный тул в `registry.ts` и потому автоматически не попадает в
MCP `tools/list` (адаптер экспонирует только зарегистрированные тулы). Путь пароля:
`stdin терминала → AccountRegistry + .env`, минуя MCP-wire и LLM.

**Альтернатива:** сделать `/add-account` тулом и фильтровать его в MCP-адаптере (как
`delegate`). Отвергнута — лишний код фильтрации и риск случайно экспонировать тул с
паролем; CLI-слой — естественное место для интерактивного заведения.

### D6: Валидация и подтверждение перезаписи

**Решение:** мастер `/add-account` собирает поля построчно (`provider`, `login`,
`password` — обязательные; `authStrategy` — опц., default `basic`), валидируя каждое
через расширение `prompts.ts` (новые field-валидаторы). После сбора:
- если `registry.has(login)` → `promptConfirm` «Аккаунт существует. Перезаписать?»; при
  отказе — отмена без изменений;
- при подтверждении или новом `login` → `registry.upsert(account)` +
  `EnvFileWriter.updateAccounts(.env, registry.list())`.

**Альтернатива:** перезапись без подтверждения. Отвергнута по решению оператора (Q3=b) —
явное подтверждение защищает от случайной перезаписи пароля.

### D7: Проброс реестра в тулы и команды

**Решение:** `bootstrap()` создаёт единственный `AccountRegistry` и:
- передаёт его в `composeAgents` → `registerMailConnectTools({ accountRegistry, ... })` →
  `createMailConnectTool({ accountRegistry, ... })` (вместо `accounts: MailAccount[]`);
- возвращает `registry` в `BootstrapResult` для `CliRepl` (guided-команды читают
  `registry.list()` при выборе аккаунта; `ensureMailConnected` использует `login`
  без изменений — сессия уже в `MailSessionStore`);
- `mail.send` fallback `deps.accounts.find(...)` заменяется на
  `accountRegistry.findByLogin(login)`.

Shared-синглтон (по образу `getSharedSessionStore`) не вводится — реестр прокидывается
явно через deps, чтобы избежать скрытых глобалов и упростить тесты (инжекция mock-реестра).

### D8: Подхват в MCP-сервере — перезапуск процесса

**Решение:** MCP-сервер (`src/mcp/index.ts`) при своём `bootstrap()` создаёт свой
`AccountRegistry` из текущего `.env`. Добавленный через CLI `/add-account` аккаунт
становится виден MCP-серверу **только после перезапуска** MCP-процесса (он читает `.env`
при старте). Это документируется в README и в `hint`-сообщении ошибки.

**Альтернатива:** file-watch `.env` с hot-reload реестра в MCP. Отвергнута (Non-Goal) —
усложнение, race-conditions с активными сессиями; для локального инструмента
перезапуск MCP-процесса тривиален.

## Risks / Trade-offs

- **[MCP-сервер требует перезапуска для новых аккаунтов]** → Документировать в README и в
  `hint` ошибки `account_not_found`. Mitigation: после `/add-account` выводить
  напоминание «перезапустите MCP-сервер, чтобы он увидел новый аккаунт».
- **[Пароль в `.env` в открытом виде]** → `.env` вне git, читается только процессом
  оператора. At-rest-шифрование — отдельное future change (Non-Goal). Mitigation:
  документировать, что `.env` хранится в защищённом месте.
- **[Пароль виден в эхо терминала при `/add-account`]** → Принято по решению оператора
  (Q2). Mitigation: документировать; при желании скрытый ввод добавляется отдельно.
- **[Concurrent `/add-account` в нескольких CLI-процессах]** → Два процесса могут
  перезаписать `ACCOUNTS` друг друга (last-write-wins). Mitigation: типичный сценарий —
  один оператор; атомарная запись (temp+rename) гарантирует целостность файла. Документировать.
- **[Breaking change для существующих MCP-клиентов с `credentials`]** → Клиенты получат
  ошибку (тул не примет `credentials`). Mitigation: миграция задокументирована в proposal
  и README; `hint`-сообщение ведёт к `/add-account`.
- **[Пароль с `#` или пробелами в `.env`]** → Решено через запись `ACCOUNTS="[...]"`
  в двойных кавычках (D4); `dotenv` раскрывает кавычки. Покрыть тестом.
- **[Удаление аккаунта]** → В текущем scope нет команды удаления (Non-Goal).
  Mitigation: ручное редактирование `.env` + перезапуск; будущая команда `/remove-account`.

## Migration Plan

1. **Подготовка:** оператор заводит существующие ящики через `/add-account` (или они уже
   в `ACCOUNTS` `.env` — обратно совместимо: реестр инициализируется из `ACCOUNTS`).
2. **Развёртывание кода:** после реализации MCP-сервер и CLI перезапускаются.
3. **Обновление клиентов:** внешние MCP-клиенты переключаются с передачи `credentials` на
   передачу `provider` + `login`. Старые вызовы с `credentials` получают ошибку.
4. **Откат:** вернуть старый `inputSchema` `mail.connect` (с блоком `credentials`) и логику
   `resolveAccount` из change `mcp-dynamic-credentials`. `AccountRegistry` и `/add-account`
   можно оставить (они обратно совместимы с `.env` fallback). Чистый откат `mail.connect` —
   вернуть `deps.accounts`-замыкание и `credentials`-блок.

## Open Questions

- Нет. Все решения согласованы с оператором (Q1–Q6). Удаление аккаунта и at-rest-шифрование
  `.env` вынесены в future changes и не влияют на текущие спеки/подход/задачи.
