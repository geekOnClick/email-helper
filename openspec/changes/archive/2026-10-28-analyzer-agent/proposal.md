# Proposal

## Why

Каркас оркестрации (`agent/orchestrator`) и LLM-клиент (`llm/routerai`) готовы, но анализатор писем пока существует только как заглушка-скил: оркестратор не имеет зарегистрированного субагента для глубокого анализа, саммари и извлечения сущностей. Без анализатора невозможно ключевое пользовательское действие Фазы 2 — «проанализируй письмо(а)»: оркестратору некому делегировать анализ, и `mail.analyze` (PLAN.md раздел 3.2) физически некуда реализовать. Этот change вводит первый реальный субагент-реализацию, замыкая роль `analyzer` (дорогая модель `MODEL_ANALYZER`) и подключая её к оркестратору через существующий seam `Subagent`/`SubagentRegistry`.

## What Changes

- **Субагент-анализатор** как класс `Analyzer` (в `src/agents/analyzer.ts`): реализует контракт `Subagent` (`{ name: 'analyzer', description, run(input): Promise<string> }`). В `run()` крутит собственный цикл `runToolLoop` (роль `'analyzer'`, свой скил `skills/analyzer.md`) на контексте «инструкция оркестратора + результат тулов», со **своим набором тулов** — ограниченным подмножеством реестра (напр. `mail.fetch` для извлечения тел писем), БЕЗ `delegate` (глубина делегирования = 1) и БЕЗ рутины подключения/скачивания (это работа помощника).
- **Наполнение `skills/analyzer.md`** (вместо каркаса-заглушки) — системный промпт роли анализатора: роль, зоны ответственности (саммари одного/нескольких писем, извлечение сущностей, классификация тематики), доступные тулы, формат ответа, ограничения (не выдумывать факты).
- **Слой сборки агентов**: фабрика `createAnalyzer(opts)` + способ регистрации анализатора в `SubagentRegistry` оркестратора. Существующий seam (`OrchestratorOptions.subagents: Subagent[]`) **не ломается** — появляется фабричная функция, которая строит `Analyzer` и возвращает его как `Subagent` (готов для передачи в `subagents`).
- **Решение по `mail.analyze`**: отдельный тул `mail.analyze` НЕ вводится — анализ делается самим субагентом-анализатором через `delegate` от оркестратора + `mail.fetch` (обоснование и альтернативы — в `design.md`, D-пункт).
- **Экспорт** из `src/agents/index.ts` (`Analyzer`, `createAnalyzer`, типы).
- **Юнит-тесты** с мок `RouterAiClient` (паттерн из `tests/orchestrator.test.ts`): финал без тулов, анализ с вызовом `mail.fetch` → финал, ошибка тулa, исчерпание итераций, регистрация нескольких субагентов, проверка отсутствия `delegate` в наборе анализатора. **Gated-тест** (`INTEGRATION_LLM=1`) против живого RouterAI — помечен как в `orchestrator-loop.test.ts`.

## Capabilities

### New Capabilities

- `agent/analyzer`: субагент-анализатор писем — глубокий анализ содержимого (саммари одного/нескольких писем, извлечение сущностей, классификация тематики) через собственный цикл tool-calling с ролью `analyzer` и ограниченным набором тулов (без делегирования).

### Modified Capabilities

Нет — `agent/orchestrator` (seam делегирования) и `llm/routerai` (клиент) используются как есть, их требования не меняются; тулы `mail/*` вызываются анализатором, но их спеки поведения не затрагиваются.

## Impact

- **Новый код:** `src/agents/analyzer.ts` (`Analyzer` — `Subagent`-реализация; `createAnalyzer(opts)` — фабрика). Пополнение экспорта `src/agents/index.ts`.
- **Системный промпт:** `skills/analyzer.md` наполняется (был каркас).
- **Без новых runtime-зависимостей** — переиспользуются `runToolLoop`, `loadSkill`, `RouterAiClient`, `mapToolsToOpenAi`, `getTool`/`listTools` (всё готово в `src/agents/` и `src/llm/`).
- **Конфиг:** без новых полей — `MODEL_ANALYZER` уже есть (`z-ai/glm-5.2`), роль `analyzer` уже резолвится в `resolveModel` (`src/llm/models.ts`), лимиты `AGENT_MAX_ITERATIONS`/`AGENT_MAX_TOOL_RESULT_CHARS` переиспользуются.
- **Внешние системы:** `mail.fetch` (IMAP через сессию, уже подключённую помощником) и `RouterAiClient` (`/chat/completions`) — новых эндпоинтов нет.
- **Тесты:** мок `RouterAiClient` (injectable-transport pattern); на gated-интеграцию не опираемся (сервис временно 500 — observation из `archive/2026-10-28-llm-client/design.md`), gated-тест оставлен на восстановление API.
- **Не затрагивает:** `agent/orchestrator` (used as-is), `llm/routerai` (used as-is), спеки `mail/*`, `mail.analyze` как отдельный тул (не вводится), `agent/helper` (отдельный change), векторную БД (Фаза 3), отправку (Фаза 4), транспорты (Фазы 5–7).
- **Новые спеки:** `agent/analyzer` (new capability).