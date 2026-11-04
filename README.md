# Email Helper — агент-помощник по работе с почтой

Агент-помощник для работы с электронной почтой (Яндекс Почта, Outlook.com):
поиск писем по теме/дате/отправителю, чтение и анализ содержимого, скачивание
вложений, отправка писем по строгим критериям. Архитектура «оркестратор +
субагенты»: дорогая модель анализирует письма, дешёвая выполняет рутину.
Доступ — через терминальный CLI (guided-команды) и MCP-сервер.

## Технологический стек

| Слой | Технология |
|------|-----------|
| Язык | TypeScript (ESM, strict), Node.js ≥ 20 |
| LLM-провайдер | RouterAI (`https://routerai.ru/api/v1`), OpenAI-совместимый |
| Основная модель | `z-ai/glm-5.2` (оркестратор + анализатор) |
| Дешёвая модель | `z-ai/glm-5.3-flash` (субагент-помощник) |
| Embeddings | `baai/bge-m3` |
| Векторная/графовая БД | FalkorDB (Docker, порт 6380 на хосте) |
| Почтовые протоколы | IMAP/SMTP (imapflow, nodemailer) |
| Тестирование | Vitest |
| SDD | OpenSpec |
| Транспорты | CLI (терминал), MCP (Model Context Protocol) |

## Установка

### Требования

- Node.js ≥ 20 LTS
- Docker (для FalkorDB)

### Шаги

```bash
git clone <repo-url> email-helper
cd email-helper
npm install
```

### FalkorDB (векторная БД)

Поднимите FalkorDB через docker-compose:

```bash
docker compose -f docker/docker-compose.yml up -d
```

Контейнер слушает порт `6380` на хосте (порт 6379 занят другим проектом на
этой машине). Персистентность — в Docker volume.

## Конфигурация

Все настройки — через переменные окружения (`.env`). Скопируйте `.env.example`
в `.env` и заполните значения:

```bash
cp .env.example .env
```

### Ключевые переменные

- `ROUTERAI_API_KEY` — API-ключ RouterAI (из кабинета).
- `ROUTERAI_BASE_URL` — базовый URL API (по умолчанию `https://routerai.ru/api/v1`).
- `MODEL_ORCHESTRATOR`, `MODEL_ANALYZER`, `MODEL_HELPER` — модели для ролей.
- `EMBEDDINGS_MODEL` — модель эмбеддингов (`baai/bge-m3`).
- `FALKORDB_HOST`, `FALKORDB_PORT`, `FALKORDB_PASSWORD` — параметры FalkorDB.
- `ACCOUNTS` — JSON-массив аккаунтов почты:
  ```json
  [
    {"provider":"yandex","login":"user@yandex.com","password":"пароль-приложения"},
    {"provider":"outlook","login":"user@outlook.com","password":"...","authStrategy":"oauth2"}
  ]
  ```
- `MS_CLIENT_ID`, `MS_TENANT` — OAuth2 для Outlook (если basic-auth отключён).
- `MAIL_OP_TIMEOUT_MS` (по умолчанию `30000`) — таймаут одной попытки IMAP-
  операции (мс) для всех тулов `mail.search`/`mail.fetch`/
  `mail.downloadAttachments`/`mail.listFolders`.
- `MAIL_OP_MAX_RETRIES` (по умолчанию `1`) — число повторов с переподключением
  IMAP-сессии при сетевом обрыве/таймауте (применяется ко всем IMAP-тулам).
- `MAIL_SEARCH_FALLBACK_DAYS` (по умолчанию `180`) — `SINCE` по умолчанию
  (в днях) для bounded client-side fallback при поиске только по `subject`.

### Аккаунты и секреты

- Тестовые ящики хранятся в `agent-accounts.txt` (вне git, в `.gitignore`).
- Пароли приложений и OAuth-токены — в `.env` (вне git). Секреты маскируются в
  логах observability (`[REDACTED]`).
- **Заведение/обновление аккаунта** — команда `/add-account` в локальном CLI
  (мастер запрашивает `provider`, `login`, `password`, опц. `authStrategy`);
  запись атомарно сохраняется в `ACCOUNTS` в `.env` и сразу доступна в текущей
  CLI-сессии. Пароль вводится в терминале оператора и **не пересекает MCP-wire**.
- **Передача пароля по MCP исключена**: внешний агент вызывает `mail.connect` с
  `provider` + `login`, а сервер сам находит пароль в `ACCOUNTS`. См. раздел
  «Инструменты MCP» → `mail.connect`.
- **MCP-сервер требует перезапуска** после заведения нового аккаунта через
  `/add-account`: MCP-процесс читает `.env` при старте, поэтому новые аккаунты
  становятся видны по MCP только после перезапуска MCP-сервера (`npm run mcp` /
  `npm run mcp:http`).

## Запуск

### CLI (терминальный REPL)

```bash
npm start
```

Интерактивный REPL работает в **guided-режиме**: принимает только
slash-команды. Свободный текст отклоняется с подсказкой. Каждая команда
собирает параметры через структурированный мастер ввода (формат
`ключ - значение`), без расхода токенов LLM на разбор интента.

#### Команды

| Команда | Назначение |
|---------|-----------|
| `/find` | поиск писем по теме/дате/отправителю |
| `/analyze` | найти и проанализировать письмо (LLM-саммари) |
| `/download` | найти и скачать вложения письма в системную папку загрузок |
| `/send` | отправить письмо с предпросмотром и подтверждением |
| `/add-account` | завести/обновить почтовый аккаунт (записывается в `ACCOUNTS` в `.env`) |
| `/stats` | статистика сессии (прогоны, вызовы тулов, токены LLM) |
| `/quit` | завершить сессию (также `Ctrl+D`/EOF) |

#### Формат ввода критериев

Мастер сбора читает поля по одному на строку в формате `ключ - значение`.
Пользователь может ввести любое подмножество полей. Пустая строка завершает
сбор.

**Для `/find`, `/analyze`, `/download`** (критерии поиска):

```
тема - <текст>
дата - <YYYY-MM-DD>
отправитель - <email>
```

Пример сессии `/find`:

```
> /find
Введите критерии поиска (по одному на строку в формате «тема - текст»):
...
> тема - договор
✓ тема: договор
> дата - 2026-10-01
✓ дата: 2026-10-01
> 
Найдено писем: 2
...
```

**Для `/send`** (данные письма):

```
тема - <текст>
текст - <текст тела>
получатель - <email>
```

После ввода `/send` показывает черновик и запрашивает подтверждение
(да/нет) перед отправкой.

**Для `/add-account`** (заведение/обновление аккаунта в `.env`):

```
provider - <yandex|outlook>
login - <email>
password - <пароль приложения>
authStrategy - <basic|oauth2>   (необязательно, по умолчанию basic)
```

При совпадении `login` с уже заведённым аккаунтом запрашивается подтверждение
перезаписи (да/нет). Запись атомарно сохраняется в `ACCOUNTS` в `.env` и сразу
доступна в текущей CLI-сессии. Команда доступна только в локальном CLI и не
экспонируется по MCP — так пароль не пересекает MCP-wire.

#### Несколько аккаунтов

Если в `ACCOUNTS` настроено несколько почт — после сбора критериев команда
запрашивает выбор аккаунта (логин) из списка. При одном аккаунте выбор
автоматический.

#### Несколько совпадений

`/analyze` и `/download` (нужно конкретное письмо): при нескольких
совпадениях показываются первые 5 и запрашивается UID нужного письма.
`/find` выводит весь список без выбора.

При выходе (`/quit` или EOF) выводится итоговый отчёт сессии: число
прогонов, вызовы тулов (ок/ошибок), суммарные токены LLM.

### MCP-сервер

MCP-сервер экспонирует доменные тулы внешним клиентам (pi, Claude Desktop и
др.) по стандарту Model Context Protocol. Два транспорта:

**stdio** (по умолчанию, для локальных клиентов):

```bash
npm run mcp
```

**Streamable HTTP** (для удалённых/веб, localhost-only по умолчанию):

```bash
npm run mcp:http
# с параметрами:
npm run mcp:http -- --port 3000 --host 127.0.0.1
```

### Инструменты MCP

MCP-сервер экспонирует 8 доменных тулов (внутренний `delegate` оркестратора
скрыт). Все тулы, кроме `vector.search`, требуют предварительного `mail.connect`
для соответствующего `login` — без активной IMAP-сессии возвращается ошибка
`подключение не установлено для <login>`.

#### Почтовые тулы

| Тул | Назначение | Обязательные параметры |
|-----|-----------|----------------------|
| `mail.connect` | Подключение к ящику по IMAP | `login`, `provider` |
| `mail.listFolders` | Список папок ящика | `login` |
| `mail.search` | Поиск писем по критериям | `login`, `criteria` |
| `mail.fetch` | Чтение письма (тело + вложения) | `login`, `uid` |
| `mail.downloadAttachments` | Скачивание вложений письма | `login`, `uid` |
| `mail.send` | Отправка письма (SMTP) | `login`, `mail`, `confirm` |

**`mail.connect`** — подключение к ящику. Принимает только `login` и `provider`;
**пароль не передаётся по MCP** — сервер сам находит его в `ACCOUNTS` (`.env`) по
паре `(provider, login)` и подставляет для авторизации (basic для Яндекса, OAuth2
для Outlook). Это исключает попадание пароля приложения в контекст LLM
вызывающего агента и в MCP-wire. Если аккаунт с такой парой не заведён —
возвращается структурированная MCP-ошибка `account_not_found`; если `login`
существует, но с другим `provider` — `provider_mismatch` (оба случая — JSON в
`content[0].text` с полями `error`/`message`/`login`/`provider`/`hint`).

```json
{ "login": "user@yandex.com", "provider": "yandex" }
```

Заведите аккаунт заранее через локальную CLI-команду `/add-account` (см. раздел
«Аккаунты и секреты»). Передача пароля в аргументах тулa не поддерживается.

**`mail.listFolders`** — список папок ящика (INBOX, Sent, Drafts и т.д.):

```json
{ "login": "user@yandex.com" }
```

**`mail.search`** — поиск писем. Все поля `criteria` опциональны, соединяются
через AND. При возврате 0 результатов по текстовым критериям (subject/from/to)
срабатывает bounded client-side fallback: выборка сужается надёжными серверными
критериями (`since`/`before`/`from`/`to`/флаги) из запроса, а при их
отсутствии — `SINCE` по умолчанию (`MAIL_SEARCH_FALLBACK_DAYS`, 180 дней).
Метаданные фетчатся только по суженному набору (не по всему ящику) и
дофильтровываются локально — обход ненадёжного IMAP SEARCH Яндекса по
кириллическим `SUBJECT`-литералам. Для надёжного поиска на больших ящиках
рекомендуется передавать `from`/`since` вместе с `subject`.

```json
{
  "login": "user@yandex.com",
  "criteria": {
    "subject": "договор",
    "from": "legal@example.com",
    "since": "2026-10-01",
    "before": "2026-10-31",
    "folder": "INBOX",
    "direction": "incoming",
    "unseen": true,
    "limit": 50
  }
}
```

Поля `criteria`: `subject`, `from`, `to` (string), `since`/`before` (ISO
`YYYY-MM-DD`), `folder` (string, приоритет над `direction`), `direction`
(`incoming`\|`outgoing`), `unseen`/`flagged`/`answered` (boolean), `limit`
(integer, по умолчанию 50), `offset` (integer).

**`mail.fetch`** — чтение письма по UID: текстовое тело + метаданные вложений.
UID можно получить из `mail.search`.

```json
{ "login": "user@yandex.com", "uid": 42, "folder": "INBOX" }
```

**`mail.downloadAttachments`** — скачивание вложений в локальный каталог. Без
`targetDir` используется `DOWNLOAD_DIR` из конфигурации. Без `names` — все
вложения.

```json
{
  "login": "user@yandex.com",
  "uid": 42,
  "targetDir": "/home/user/Загрузки",
  "names": ["report.pdf"]
}
```

**`mail.send`** — отправка письма по SMTP с двухфазным протоколом:

- `confirm: false` → валидация + предпросмотр черновика, **без** SMTP.
- `confirm: true` → валидация; если валидно — отправка.

```json
{
  "login": "user@yandex.com",
  "mail": {
    "to": [{ "address": "recipient@example.com", "name": "Имя" }],
    "subject": "Тема письма",
    "text": "Текст тела письма"
  },
  "confirm": false
}
```

Поля `mail`: `to` (array, ≥1, объекты `{ address, name? }`), `cc?`, `bcc?`,
`subject` (string), `text` (string), `html?` (string), `attachments?` (array,
`{ path }`), `encoding?` (string).

#### Устойчивость IMAP-операций

Все IMAP-тулы (`mail.search`, `mail.fetch`, `mail.downloadAttachments`,
`mail.listFolders`) выполняются с общим таймаутом одной попытки
`MAIL_OP_TIMEOUT_MS` (по умолчанию 30 c) и повтором с переподключением
IMAP-сессии при сетевом обрыве/таймауте — до `MAIL_OP_MAX_RETRIES` повторов
(по умолчанию 1). Это исключает зависание тулов на больших ящиках (Яндекс
обрывает соединение после больших выборок) и каскадный падёж последующих
операций. Секреты маскируются в сообщениях об ошибках (`[REDACTED]`).

#### Тулы векторного поиска

| Тул | Назначение | Обязательные параметры |
|-----|-----------|----------------------|
| `embeddings.index` | Индексация письма в FalkorDB | `login`, `uid` |
| `vector.search` | Семантический поиск по смыслу | `query` |

**`embeddings.index`** — индексация письма: строит embedding «тема + тело» и
сохраняет в FalkorDB. Idempotent (повторный вызов обновляет).

```json
{ "login": "user@yandex.com", "uid": 42, "folder": "INBOX" }
```

**`vector.search`** — семантический поиск (без `mail.connect`). Строит embedding
запроса и возвращает top-k ближайших писем с оценкой.

```json
{
  "query": "договор на аренду",
  "k": 5,
  "filter": { "login": "user@yandex.com", "folder": "INBOX" }
}
```

### Подключение других агентов (MCP-клиентов)

MCP-сервер поддерживает два транспорта. Выбор зависит от того, где работает
клиент: локально на этой машине — stdio; удалённо или из браузера — HTTP.

#### Способ 1: stdio (локальные клиенты — pi, Claude Desktop)

Клиент сам запускает процесс MCP-сервера и общается через stdin/stdout. Это
стандартный способ для локальных агентов.

Параметры для конфигурации клиента:

| Параметр | Значение |
|----------|---------|
| `command` | `/home/geekonclick/.nvm/versions/node/v22.11.0/bin/npx` |
| `args` | `["tsx", "src/mcp/index.ts"]` |
| `cwd` | `/home/geekonclick/Рабочий стол/projects/email-helper` |
| `env.PATH` | `/home/geekonclick/.nvm/versions/node/v22.11.0/bin:/usr/bin:/bin` |

**pi** — добавить в конфиг (`.pi/config.yaml`):

```yaml
mcp:
  - name: email-helper
    transport: stdio
    command: /home/geekonclick/.nvm/versions/node/v22.11.0/bin/npx
    args: ["tsx", "src/mcp/index.ts"]
    cwd: "/home/geekonclick/Рабочий стол/projects/email-helper"
```

**Claude Desktop** — файл `claude_desktop_config.json` (macOS:
`~/Library/Application Support/Claude/`, Linux: `~/.config/Claude/`):

```json
{
  "mcpServers": {
    "email-helper": {
      "command": "/home/geekonclick/.nvm/versions/node/v22.11.0/bin/npx",
      "args": ["tsx", "src/mcp/index.ts"],
      "cwd": "/home/geekonclick/Рабочий стол/projects/email-helper",
      "env": {
        "PATH": "/home/geekonclick/.nvm/versions/node/v22.11.0/bin:/usr/bin:/bin"
      }
    }
  }
}
```

#### Способ 2: Streamable HTTP (удалённые/веб-клиенты)

Сервер поднимается как процесс, клиент подключается по URL.

URL: `http://127.0.0.1:3000/mcp`

Клиент делает POST-запросы с JSON-RPC 2.0 (Streamable HTTP transport MCP):

```bash
# Инициализация сессии
curl -X POST http://127.0.0.1:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}'

# Список тулов (использовать Mcp-Session-Id из ответа initialize)
curl -X POST http://127.0.0.1:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Mcp-Session-Id: <id из initialize>" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'
```

**pi** — установка по URL:

```bash
mcp install http://127.0.0.1:3000/mcp
```

#### Предварительные требования

1. **`.env` настроен** — MCP-сервер при старте вызывает `bootstrap()`, который
   грузит конфигурацию (API-ключи, аккаунты почты, FalkorDB). Без `.env`
   сервер упадёт с ошибкой в stderr.
2. **FalkorDB запущен** — для тулов `embeddings.index` / `vector.search`:
   ```bash
   docker compose -f docker/docker-compose.yml up -d
   ```
3. **`mail.connect` первым** — большинство тулов требуют активной IMAP-сессии.
   Типичный flow: `mail.connect` → `mail.search` → `mail.fetch`. Внешний агент
   передаёт только `provider` + `login`; пароль сервер находит в `ACCOUNTS`
   (`.env`) — передача пароля по MCP не предусмотрена. Если аккаунт не заведён,
   `mail.connect` вернёт структурированную ошибку `account_not_found` с `hint`
   о заведении через `/add-account`. Заведите аккаунт заранее через локальный
   CLI (`/add-account`) и помните: **MCP-сервер требует перезапуска** после
   заведения нового аккаунта (читает `.env` при старте). См. раздел «Инструменты
   MCP» выше.
4. **Состояние сессий и очистка кредов** — MCP-сервер stateless по HTTP (новый `Server`+
   `transport` на запрос), но IMAP-сессии из `mail.connect` живут в общем
   `MailSessionStore` процесса. В stdio — одна сессия на процесс; в HTTP —
   общая на все запросы. При завершении сервера (stdio EOF, SIGINT/SIGTERM,
   закрытие HTTP-stdin) `cleanup()` вызывает `disposeAll()`: закрывает все
   IMAP-соединения и **обнуляет ссылки на аккаунты с паролями** в провайдерах —
   пароли хранятся только в памяти процесса и не сохраняются на диск и не
   передаются третьим лицам (только на IMAP/SMTP-сервер провайдера для
   авторизации).
5. **`delegate` скрыт** — внутренний тул оркестратора не экспонируется.

#### Быстрая проверка

```bash
cd "/home/geekonclick/Рабочий стол/projects/email-helper"
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}' | \
  /home/geekonclick/.nvm/versions/node/v22.11.0/bin/npx tsx src/mcp/index.ts 2>/dev/null
```

Должен вернуть JSON-RPC ответ с `serverInfo: { name: "email-helper",
version: "0.1.0" }`.

## Тесты

```bash
npm test          # все тесты (vitest run)
npm run test:watch
npm run lint
```

Покрытие: unit-тесты тулов/агентов/observability, интеграционные и E2E
тесты через CLI и MCP со стаб-провайдерами.

## Структура репозитория

```
email-helper/
├── agent.md                  # описание агента и архитектура
├── PLAN.md                   # детальный план разработки (фазы)
├── skills/                   # системные промпты ролей (orchestrator, analyzer, helper)
├── openspec/                 # SDD-спецификации (OpenSpec)
│   ├── specs/                # зашитые спеки поведения
│   └── changes/              # активные/архивные изменения
├── docker/docker-compose.yml # FalkorDB
├── src/
│   ├── agents/               # оркестратор, анализатор, помощник, цикл tool-calling
│   ├── llm/                  # клиент RouterAI, модели, эмбеддинги
│   ├── tools/
│   │   ├── mail/             # тулы почты + провайдеры (yandex, outlook)
│   │   └── vector/           # FalkorDB + embeddings + vector search
│   ├── transport/
│   │   ├── cli/              # терминальный REPL, guided-команды, мастер ввода
│   │   │   ├── commands/     # обработчики /find /analyze /download /send
│   │   │   └── prompts.ts    # мастер сбора критериев
│   │   └── (telegram убран)
│   ├── mcp/                  # MCP-сервер (adapters, stdio, http)
│   ├── observability/        # логгер тулов, статистика сессии
│   ├── config/               # zod-схема и loader
│   └── index.ts              # точка входа CLI
├── tests/                    # unit + integration + E2E
├── .env.example
└── package.json
```

## Документация

- `PLAN.md` — детальный план разработки (фазы, решения, зависимости).
- `agent.md` — архитектура агента, роли, тулы.
- `openspec/specs/` — спецификации поведения (SDD).

## SDD (Spec-Driven Development)

Проект разработан по методологии OpenSpec: поведение фиксируется в
спецификациях (`openspec/specs/`), изменения проходят цикл
`propose → apply → archive`. См. `openspec/changes/archive/` для истории.
