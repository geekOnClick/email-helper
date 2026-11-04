# Proposal: mcp-env-account-credentials

## Why

Сейчас внешний агент, вызывая `mail.connect` по MCP, обязан передать пароль приложения
ящика открытым текстом в блоке `credentials.password`. Пароль проходит через контекст
LLМ вызывающего агента, его логи/транскрипт и тело MCP-запроса — существующие защиты
(`redact()`, in-memory storage, `dispose()`) закрывают только хвост (ошибки и логи на
нашем сервере), но не сам wire и не LLM клиента. Нужно полностью исключить передачу
пароля по MCP: пароли хранятся только в `.env` сервера, а по MCP передаются лишь
`provider` + `login`, по которым сервер сам находит пароль.

## What Changes

- **BREAKING**: тул `mail.connect` больше не принимает блок `credentials` (с `password`).
  По MCP передаются только `login` и `provider`. Аккаунт ищется строго по паре
  `(provider, login)` в `ACCOUNTS` из `.env`; пароль извлекается сервером и подставляется
  для авторизации. Передача пароля по MCP исключается.
- **BREAKING**: если по переданным `provider` + `login` аккаунт не найден в `.env` (или
  `provider` не соответствует заведённому аккаунту для данного `login`) — `mail.connect`
  возвращает структурированную MCP-ошибку (`isError: true`, текстовый блок с JSON:
  `error`, `message`, `login`, `provider`, `hint`), не раскрывая пароль и не пытаясь
  подключиться.
- Новая slash-команда `/add-account` в CLI REPL для заведения/обновления аккаунта: мастер
  запрашивает `provider` (`yandex`|`outlook`), `login`, `password`, опц.
  `authStrategy` (`basic`|`oauth2`, по умолчанию `basic`). Поля вводятся построчно в
  формате `ключ - значение` (как остальные guided-команды), пароль — обычным вводом (без
  скрытия). Аккаунт валидируется, при совпадении `login` с существующим — запрашивается
  подтверждение перезаписи (да/нет), затем запись добавляется/обновляется в `ACCOUNTS` в
  `.env` и в in-memory реестре.
- Введён in-memory `AccountRegistry` (изменяемый источник правды об аккаунтах в процессе):
  инициализируется из `.env` при `bootstrap()`, читается тулом `mail.connect` при каждом
  вызове (по `(provider, login)`), пополняется командой `/add-account`. Это заменяет
  замыкание статичной копии массива `accounts` в тул. Команда `/add-account` НЕ
  экспонируется по MCP — только локальный CLI (иначе пароль снова утекает на wire).
- Существующие guided-команды (`/find`, `/analyze`, `/download`, `/send`) и выбор аккаунта
  в них переключаются на чтение из `AccountRegistry` (актуальный список, включая
  добавленные в сессии).
- Пароли заведённых аккаунтов продолжают маскироваться в логах observability (`redact()`)
  и сообщениях об ошибках — без изменений в этой части.
- README обновляется: раздел про креды и MCP-подключение описывает новый flow
  (заведение через `/add-account`, передача по MCP только `provider`+`login`).

## Capabilities

### New Capabilities
- `config/account-management`: управление списком почтовых аккаунтов в `.env` —
  валидируемое добавление/обновление записи аккаунта (`provider`, `login`, `password`,
  `authStrategy`), атомарная персистентность `ACCOUNTS` в `.env` (с сохранением прочих
  переменных и комментариев), и in-memory `AccountRegistry` как изменяемый источник
  правды для тулов и CLI в рамках процесса.

### Modified Capabilities
- `mail/connection`: контракт `mail.connect` меняется — принимаются только `login` и
  `provider`, пароль ищется сервером в `ACCOUNTS` по паре `(provider, login)`;
  plaintext-блок `credentials` убирается; при отсутствии аккаунта возвращается
  структурированная MCP-ошибка. Убирается требование «Безопасность динамических учётных
  данных» (динамические креды больше не передаются).
- `transport/cli`: добавляется slash-команда `/add-account` для заведения/обновления
  аккаунта через мастер ввода с подтверждением перезаписи при дубликате `login`.

## Impact

- **Код**:
  - `src/config/`: новый `AccountRegistry` (in-memory), сервис записи `ACCOUNTS` в `.env`
    (атомарно, с сохранением структуры файла); `loader.ts` — инициализация реестра из
    `ACCOUNTS`.
  - `src/tools/mail/mail-connect.tool.ts`: `inputSchema` без `credentials`; поиск по
    `(provider, login)` через `AccountRegistry`; структурированная MCP-ошибка
    `account_not_found`/`provider_mismatch`.
  - `src/tools/mail/register-tools.ts`, `src/agents/compose.ts`, `src/transport/cli/bootstrap.ts`:
    прокидывание `AccountRegistry` вместо статичного `accounts: MailAccount[]` в `mail.connect`.
  - `src/transport/cli/commands/`: новый `add-account.ts`; `repl.ts` — маршрутизация `/add-account`;
    существующие команды читают список аккаунтов из реестра.
  - `src/mcp/adapters.ts`: без изменений (тул уже возвращает ошибки через `toMcpError`).
- **Безопасность**: пароль приложения больше не пересекает MCP-wire и не попадает в
  контекст LLM вызывающего агента; единственный путь заведения пароля — локальный CLI
  `/add-account` (пароль вводится в терминале оператора сервера, минуя MCP/LLM).
- **Обратная совместимость**: **breaking** — клиенты, передающие `credentials.password`,
  получат ошибку. Миграция: завести аккаунт через `/add-account`, затем вызывать
  `mail.connect` с `provider`+`login`. Вызовы `mail.connect` с только `login` (без
  `provider`) — теперь требуют `provider` (раньше `login` хватало для fallback на `.env`).
- **Тесты**: unit-тесты `AccountRegistry` (add/update, duplicate, provider-mismatch),
  сервиса записи `.env` (атомарность, сохранение комментариев/прочих переменных),
  `mail.connect` (поиск по паре, ошибки `account_not_found`/`provider_mismatch`,
  регрессии маскирования), команда `/add-account` (мастер, подтверждение перезаписи,
  валидация), интеграционный тест через MCP `tools/call` со структурированной ошибкой.
- **MCP**: обновлённая `inputSchema` `mail.connect` автоматически экспонируется через
  `tools/list` (без блока `credentials`, с обязательным `provider`).
