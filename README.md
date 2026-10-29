# Email Helper — агент-помощник по работе с почтой

Агент-помощник для работы с электронной почтой (Яндекс Почта, Outlook.com):
поиск писем по теме/дате/отправителю, чтение и анализ содержимого, скачивание
вложений, отправка писем по строгим критериям, семантический поиск по
векторному индексу. Архитектура «оркестратор + субагенты»: дорогая модель
анализирует письма, дешёвая выполняет рутину.

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

### Аккаунты и секреты

- Тестовые ящики хранятся в `agent-accounts.txt` (вне git, в `.gitignore`).
- Пароли приложений и OAuth-токены — в `.env` (вне git).
- Секреты маскируются в логах observability (`[REDACTED]`).

## Запуск

### CLI (терминальный REPL)

```bash
npm start
```

Интерактивный REPL: вводите запросы агенту, используйте slash-команды:

| Команда | Назначение |
|---------|-----------|
| `/help` | справка |
| `/quit` | завершить сессию |
| `/clear` | очистить экран |
| `/reset` | сбросить историю диалога |
| `/stats` | статистика сессии (прогоны, вызовы тулов, токены LLM) |

При выходе (`/quit` или EOF) выводится итоговый отчёт сессии: число прогонов,
вызовы тулов (ок/ошибок), суммарные токены LLM.

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
│   │   ├── cli/              # терминальный REPL
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
