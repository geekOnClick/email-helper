# Proposal

## Why

Оркестратор и анализатор подключены, но вся рутина с почтой (подключение, поиск, чтение, скачивание) до сих пор не делегируется никому — оркестратору при зарегистрированных субагентах доступны только `delegate` и (для анализатора) `mail.fetch`. Без субагента-помощника нет второй половины ролевой модели PLAN.md раздел 3.1: некому подключаться к ящику, искать письма и скачивать вложения. Этот change вводит второго реального субагента — помощника (дешёвая модель `MODEL_HELPER`) — и замыкает Фазу 2: оркестратор сможет делегировать и анализ (анализатор), и рутину (помощник), так что агент впервые способен провести полный сценарий «подключись → найди → проанализируй → скачай» от toilets реестра.

## What Changes

- **Субагент-помощник** как класс `Helper` (в `src/agents/helper.ts`): реализует контракт `Subagent` (`{ name: 'helper', description, run(input): Promise<string> }`). В `run()` крутит собственный цикл `runToolLoop` (роль `'helper'`, свой скил `skills/helper.md`) со **своим набором тулов** — всеми рутинными тулами реестра (`mail.connect`, `mail.listFolders`, `mail.search`, `mail.fetch`, `mail.downloadAttachments`), БЕЗ `delegate` (глубина делегирования = 1).
- **Наполнение `skills/helper.md`** (вместо каркаса-заглушки) — системный промпт роли помощника: роль (дешёвая модель, чётко по инструкции), доступные тулы, зоны ответственности (подключение, поиск, чтение, скачивание), формат ответа, ограничения (не анализирует содержимое, не отправляет письма без подтверждения).
- **Слой сборки всего агента** (`src/agents/compose.ts`): фабрика `composeAgents(opts)` — регистрирует mail-тулы в реестре (через готовый `registerMailConnectTools` с shared `MailSessionStore`), строит `Analyzer` и `Helper`, передаёт обоих в `Orchestrator.create({ subagents: [analyzer, helper] })`. Это снимает необходимость регистрировать тулы «руками» и даёт единую точку инициализации для будущего транспорта (Фазы 5/7). Существующие seam'ы (`Subagent`, `OrchestratorOptions.subagents`, `registerMailConnectTools`) **не ломаются**.
- **Экспорт** из `src/agents/index.ts` (`Helper`, `createHelper`, типы; `composeAgents`, типы).
- **Юнит-тесты** с мок `RouterAiClient` (паттерн из `tests/orchestrator.test.ts`): финал без тулов, рутина с вызовом `mail.search` → финал, ошибка тулa, исчерпание итераций; проверки набора тулов (есть `mail.connect`/`mail.search`/`mail.downloadAttachments`, нет `delegate`) и регистрация обоих субагентов (analyzer+helper) в одном реестре. **Gated-тест** (`INTEGRATION_LLM=1`) против живого RouterAI — помечен как в `analyzer-loop.test.ts`.

## Capabilities

### New Capabilities

- `agent/helper`: субагент-помощник — рутинные операции с почтой (подключение, поиск, чтение, скачивание) через собственный цикл tool-calling с ролью `helper` на дешёвой модели и набором рутинных тулов (без делегирования).

### Modified Capabilities

Нет — `agent/orchestrator` (seam делегирования) и `llm/routerai` (клиент) используются как есть, их требования не меняются; тулы `mail/*` вызываются помощником, но их спеки поведения не затрагиваются. `agent/analyzer` (только что заархивирован) — used as-is.

## Impact

- **Новый код:** `src/agents/helper.ts` (`Helper` — `Subagent`-реализация; `createHelper(opts)` — фабрика), `src/agents/compose.ts` (`composeAgents(opts)` — сборка оркестратора + субагентов + регистрация mail-тулов), пополнение экспорта `src/agents/index.ts`.
- **Системный промпт:** `skills/helper.md` наполняется (был каркас).
- **Без новых runtime-зависимостей** — переиспользуются `runToolLoop`, `loadSkill`, `RouterAiClient`, `mapToolsToOpenAi`, `registerMailConnectTools` (`getSharedSessionStore`), `Orchestrator.create`.
- **Конфиг:** без новых полей — `MODEL_HELPER` уже есть (`z-ai/glm-5.3-flash`), роль `helper` уже резолвится в `resolveModel` (`src/llm/models.ts`), лимиты `AGENT_MAX_ITERATIONS`/`AGENT_MAX_TOOL_RESULT_CHARS` переиспользуются.
- **Внешние системы:** IMAP-провайдеры (Яндекс/Outlook) через `mail.connect` и `RouterAiClient` (`/chat/completions`) — новых эндпоинтов нет. Mail-тулы уже зарегистрированной рутиной пользуются shared-сессией.
- **Тесты:** мок `RouterAiClient` (injectable-transport pattern); на gated-интеграцию не опираемся (сервис временно 500 — observation в `archive/2026-10-28-llm-client/design.md`), gated-тест оставлен на восстановление API.
- **Не затрагивает:** `agent/orchestrator` (used as-is), `agent/analyzer` (used as-is), `llm/routerai` (used as-is), спеки `mail/*`, тул `mail.send` (Фаза 4), векторную БД (Фаза 3), транспорты (Фазы 5–7).
- **Новые спеки:** `agent/helper` (new capability).