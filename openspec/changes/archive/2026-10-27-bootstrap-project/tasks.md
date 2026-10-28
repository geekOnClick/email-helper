# Tasks

## 1. Node.js / TypeScript скелет

- [x] 1.1 Создать `package.json` (ESM, `type: module`, Node engines ≥20, скрипты `build`/`test`/`lint`/`format`). Проверка: `npm init`-эквивалент на месте, `node -p "require('./package.json').type"` → `module`.
- [x] 1.2 Создать `tsconfig.json` (strict, `module: NodeNext`, `moduleResolution: NodeNext`, `target: ES2022`, `outDir: dist`, `rootDir: src`, paths под структуру src). Проверка: типы без ошибок — см. финальную группу.
- [x] 1.3 Установить dev-зависимости: `typescript`, `vitest`, `@types/node`, `eslint`, `@typescript-eslint/*`, `prettier`. Проверка: `npm install` завершается без ошибок, `package-lock.json` создан.

## 2. Тулчейн (Vitest, ESLint, Prettier)

- [x] 2.1 Создать `vitest.config.ts` (окружение node, include `tests/**/*.test.ts`). Проверка: `npm test` запускается и находит smoke-тест.
- [x] 2.2 Создать конфиг ESLint (`.eslintrc.cjs` или `eslint.config.js`, TypeScript-парсер, rule: no-unused-vars как warn). Проверка: `npm run lint` проходит без ошибок.
- [x] 2.3 Создать `.prettierrc` (printWidth 100, single quote, trailing comma all). Проверка: `npm run format` отрабатывает без ошибок.
- [x] 2.4 Написать один smoke-тест `tests/smoke.test.ts` (проверяет, что `2+2===4` и что конфиг-схема экспортируется). Проверка: `npm test` зелёный.

## 3. Конфигурация окружения и секреты

- [x] 3.1 Создать `src/config/schema.ts` с zod-схемой конфига: поля `ROUTERAI_API_KEY`, `ROUTERAI_BASE_URL` (default `https://routerai.ru/api/v1`), `MODEL_ORCHESTRATOR` (default `z-ai/glm-5.2`), `MODEL_ANALYZER` (default `z-ai/glm-5.2`), `MODEL_HELPER` (default `z-ai/glm-5.3-flash`), `EMBEDDINGS_MODEL` (default `baai/bge-m3`), массив `ACCOUNTS` (provider, login, password полях OUTlook/yandex), `FALKORDB_*`, `DOWNLOAD_DIR`. Проверка: тип из схемы экспортируется, `zod.parse({})` падает с понятной ошибкой.
- [x] 3.2 Создать `src/config/loader.ts`, читающий `process.env`/`.env` и возвращающий валидированный `Config`. Проверка: unit-тест, что с валидным `.env` возвращает конфиг, с пустым — выбрасывает.
- [x] 3.3 Создать `.env.example` со всеми переменными (без значений), проверить, что `.env` и `agent-accounts.txt` в `.gitignore`. Проверка: `git check-ignore -v .env agent-accounts.txt` обе строки показывают.
- [x] 3.4 Написать тест для `config` (валидный/невалидный кейс). Проверка: `npm test` включает config-тесты и зелёный.

## 4. FalkorDB Docker

- [x] 4.1 Создать `docker/docker-compose.yml`: сервис `falkordb` (image `falkordb/falkordb-server:latest`), порт 6380 (6379 занят другим проектом на хосте), named volume `falkordb_data:/data`, `REDIS_ARGS=--requirepass ${FALKORDB_PASSWORD} --appendonly yes`, healthcheck `redis-cli -a $${FALKORDB_PASSWORD} ping`. Проверка: `docker compose -f docker/docker-compose.yml config` валиден.
- [x] 4.2 Поднять контейнер: `docker compose -f docker/docker-compose.yml up -d`. Проверка: `docker compose exec falkordb redis-cli -a "$FALKORDB_PASSWORD" ping` → `PONG`; healthcheck `healthy`.

## 5. Структура src с заглушками

- [x] 5.1 Создать каталоги-модули `src/{agents,tools/mail/providers,tools/vector,llm,transport/cli,transport/telegram,mcp,types}` с `index.ts`-заглушками (реэкспорт/пустые интерфейсы), чтобы `tsc --noEmit` проходил. Проверка: `npx tsc --noEmit` без ошибок.
- [x] 5.2 Создать `src/index.ts` (точка входа, временно логирует «email-helper skeleton ready»). Проверка: `npm run build` компилирует без ошибок.

## 6. Документация: agent.md и skills

- [x] 6.1 Написать `agent.md` (на русском): назначение, стек, краткая архитектура оркестратор+субагенты, ссылки на PLAN.md и спеки.
- [x] 6.2 Создать `skills/orchestrator.md`, `skills/analyzer.md`, `skills/helper.md` (рус.): рамка роли, доступные тулы, формат ответа. Каркас для Фазы 2.

## 7. Финальная проверка

- [x] 7.1 Запустить `npm test` — зелёный (smoke + config тесты). Проверка: exit 0.
- [x] 7.2 Запустить `npx tsc --noEmit` — без ошибок. Проверка: exit 0.
- [x] 7.3 Запустить `npm run lint` — без ошибок. Проверка: exit 0.
- [x] 7.4 `docker compose` поднят, FalkorDB отвечает PONG. Проверка: команда ping здоровая.
- [x] 7.5 `openspec validate --change bootstrap-project` проходит. Проверка: exit 0.

## Workflow follow-up

- После проверки — запустить `/opsx-archive` для зашивания change и обновления основного спека.