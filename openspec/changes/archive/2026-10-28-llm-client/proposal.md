# Proposal

## Why

Фаза 1 закрыла доступ к почте (5 тулов `mail.*`). Дальше — ядро агента: оркестратор и субагенты, которые «думают» через LLM и вызывают эти тулы. Без LLM-клиента нет ни оркестрации (Фаза 2), ни анализа писем (`mail.analyze`), ни векторной индексации (Фаза 3 — embeddings). Этот change вводит OpenAI-совместимый клиент RouterAI как фундамент всех агентных возможностей — первый шаг Фазы 2.

## What Changes

- Новый LLM-клиент RouterAI (`https://routerai.ru/api/v1`), OpenAI Chat Completions v1-совместимый: `POST /chat/completions` с поддержкой `tools`/`tool_choice` (function calling), `stream: false`.
- Конфигурация моделей: `z-ai/glm-5.2` (оркестратор + анализатор) и `z-ai/glm-5.3-flash` (помощник) — читаются из уже существующих полей `MODEL_ORCHESTRATOR`/`MODEL_ANALYZER`/`MODEL_HELPER`.
- Типобезопасная обёртка над запросами/ответами: сообщения (`system`/`user`/`assistant`/`tool`), определения функций (`tools`), вызовы (`tool_calls`) и результаты (`tool` role). Валидация ответа (zod) от malformed-JSON и расхождений формата.
- Управление запросом: таймаут, ретраи с экспоненциальной задержкой на 429/5xx, токенизация `max_tokens`/`temperature`/`top_p`, передача `Authorization: Bearer <key>`.
- Маппинг доменных тулов агента (`ToolDef` из реестра) в OpenAI `tools`-схему и обратно — единая точка конвертации для будущих агентов.
- Сокрытие секрета (`ROUTERAI_API_KEY`) в ошибках и логах.
- Заглушки агентов НЕ пишутся — каркас оркестратора/субагентов и цикл tool-calling выносятся в отдельные change'ы (`orchestrator`, `analyzer-agent`, `helper-agent`).
- Юнит-тесты с моком `fetch` (фикстуры ответов OpenAI-формата, включая `tool_calls`); gated-интеграционный тест против живого RouterAI (`INTEGRATION_LLM=1`).

## Capabilities

### New Capabilities

- `llm/routerai`: OpenAI-совместимый клиент RouterAI — чат-комплишены с поддержкой function calling (tools), конфигурация ролей-моделей, ретраи/таймауты, сокрытие секрета API-ключа в ошибках.

### Modified Capabilities

Нет — `mail/connection`, `mail/search`, `mail/attachments` не затрагиваются; клиент самостоятелен и не зависит от почтовых сессий.

## Impact

- **Новый код:** `src/llm/types.ts` (сообщения, tools, ответы OpenAI-формата), `src/llm/models.ts` (роли→модели из конфига), `src/llm/routerai-client.ts` (HTTP-клиент, ретраи, парсинг), `src/llm/tool-mapping.ts` (ToolDef→OpenAI tools), `src/llm/index.ts` (экспорт, замена заглушки).
- **Без новых runtime-зависимостей** — `fetch` встроен в Node ≥ 20; `zod` уже установлен для валидации ответа/схем.
- **Внешние системы:** `https://routerai.ru/api/v1/chat/completions` (Bearer-токен). Embeddings-эндпоинт — Фаза 3, здесь не трогается.
- **Конфиг:** переиспользуются `ROUTERAI_API_KEY`, `ROUTERAI_BASE_URL`, `MODEL_*` из `src/config/schema.ts` (новых полей не требуется).
- **Тесты:** мок `globalThis.fetch` с фикстурами (plain ответ, `tool_calls`, 429/5xx → ретрай, malformed-JSON); gated-интеграция против живого API за `INTEGRATION_LLM=1`.
- **Не затрагивает:** агентов/оркестрации (отдельные change'ы Фазы 2), `mail.analyze`, MCP, CLI, векторную БД.
- **Новые спеки:** `llm/routerai` (new capability).
