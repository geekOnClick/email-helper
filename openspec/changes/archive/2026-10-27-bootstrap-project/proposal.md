# Proposal

## Why

Проект email-helper стартует с нуля: на данный момент есть только `PLAN.md`, `.gitignore` и файл с тестовыми аккаунтами. Чтобы вести разработку по SDD и начать Фазу 1 (работа с почтой), нужен рабочий TypeScript-скелет с тулчейном, конфигурацией окружения и поднятым FalkorDB в Docker. Без этого фундамента невозможно реализовывать и тестировать тулы агента.

## What Changes

- Инициализация Node.js проекта: `package.json` (ESM, `type: module`), `tsconfig.json` (strict), Node ≥ 20.
- Тулчейн: Vitest (unit-тесты), ESLint, Prettier.
- Конфигурация окружения: `.env.example`, zod-схема конфига (аккаунты почт, ключ RouterAI, пути).
- `docker/docker-compose.yml`: FalkorDB (server-образ, персистентность, пароль, healthcheck).
- Структура каталогов `src/` (агенты, тулы, llm, config, transport, mcp, types) — пустые модули-заглушки.
- Черновой `agent.md` с описанием агента и архитектурой (на русском).
- Черновые `skills/orchestrator.md`, `skills/analyzer.md`, `skills/helper.md` (системные промпты ролей, на русском).
- Проверка: `docker compose up -d` поднимает FalkorDB; `npm test` зелёный (один smoke-тест); `openspec validate` проходит.

## Capabilities

### New Capabilities

Это change чисто инфраструктурное (scaffolding, tooling, docs) — spec-level поведения системы не меняется. Согласно методологии OpenSpec, такой change помечается `skip_specs: true` в `.openspec.yaml`; `openspec validate` принимает change без delta-спек.

### Modified Capabilities

Нет — это первый change проекта, существующих спек нет.

## Impact

- Новые файлы: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.eslintrc.*`, `.prettierrc`, `.env.example`, `docker/docker-compose.yml`, `src/**/*.ts`, `agent.md`, `skills/*.md`.
- Зависимости разработки (devDependencies): typescript, vitest, eslint, prettier, `@types/node`, zod.
- Внешние системы: локальный Docker-контейнер FalkorDB (порт 6379 + браузер 3000).
- Не затрагивает: LLM-вызовы, реальную работу с почтой, векторную индексацию — всё это следующие фазы.