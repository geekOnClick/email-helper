# Design

## Context

Фаза 1 завершена: 5 тулов `mail.*` зарегистрированы через `src/tools/mail/register-tools.ts`, каркас реестра `ToolDef` (`name`, `description`, `inputSchema: JSONObjectSchema`, `handler`) в `src/tools/registry.ts`. Конфиг (`src/config/schema.ts`) уже содержит `ROUTERAI_API_KEY`, `ROUTERAI_BASE_URL` (default `https://routerai.ru/api/v1`), `MODEL_ORCHESTRATOR` (`z-ai/glm-5.2`), `MODEL_ANALYZER` (`z-ai/glm-5.2`), `MODEL_HELPER` (`z-ai/glm-5.3-flash`). Заглушка `src/llm/index.ts` пуста. RouterAI — OpenAI-совместимый прокси (подтверждено заголовками ответа: `OpenAI-Beta`/`OpenAI-Organization`/`X-Generation-Id`, `access-control-allow-headers` включает их). Объект `fetch` доступен глобально в Node ≥ 20.

**Verification note (read-only зонд, 2026-10-28):** живой `POST /chat/completions` и `GET /models` на момент проверки возвращали серверный `{"error":{"message":"internal error","code":500}}`. Это временное состояние сервиса RouterAI (статус 500 на валидный Bearer-запрос), не контрактное поведение. Поэтому точный wire-формат tool-calling верифицируется в задаче реализации первым gated-запросом (`INTEGRATION_LLM=1`); дизайн опирается на опубликованный контракт OpenAI Chat Completions v1, который RouterAI декларирует как совместимый. Мотивация — см. `proposal.md`.

## Goals / Non-Goals

**Goals:**

- `RouterAiClient` — единственный HTTP-клиент к OpenAI-совместимому API: `chat(request) → ChatResult`.
- Типобезопасные типы сообщений и ответа (OpenAI-формата), валидация через zod, чтобы отсеивать malformed-ответы.
- Маппинг `ToolDef[]` → OpenAI `tools[]` (function schema) в одной утилите.
- Роли→модели: `resolveModel(role | explicit)` из конфига.
- Ретраи на 429/5xx/сетевые с экспоненциальной задержкой + таймаут.
- Сокрытие ключа в ошибках/логах.

**Non-Goals:**

- Цикл tool-calling агента (вызов тулов по `tool_calls`, повторный запрос с `role:"tool"`) — отдельные change'ы `orchestrator`, `analyzer-agent`, `helper-agent`. Клиент лишь выполняет один шаг запрос→ответ.
- Streaming (`stream:true`) — не нужен для оркестратора; если понадобится — позже.
- Embeddings-эндпоинт (`/embeddings`) — Фаза 3 (`vector-store`).
- Подсчёт стоимости/usage-трекинг — Фаза 8 (observability). `usage` из ответа возвращается, но не агрегируется.
- Выбор провайдера/модели в runtime, fallback-роутинг — RouterAI сам роутит к модели по имени.

## Decisions

### D1. Нативный `fetch` без SDK openai-node
**Почему:** Node ≥ 20 имеет встроенный `fetch`, RouterAI — тонкий OpenAI-совместимый прокси; лишняя зависимость `openai` тянет 100+ пакетов и абстракции для стриминга/файлов, которые не нужны. Прямой контроль над запросом проще для ретраев и сокрытия секрета.
**Альтернативы рассмотрены:** `openai` npm-пакет — rejected (тянет зависимость, скрывает wire-format, тяжелее в CI/headless); `undici` напрямую — избыточно, `fetch` и так поверх undici.

### D2. Потокобезопасный GET; мок через inject транспорта
Клиент принимает `RequestInit`-подобный транспорт (по умолчанию `globalThis.fetch`) — опция `fetch?: typeof fetch`. Это позволяет инжектить мок в тестах без патчинга глобала. Все HTTP-детали за фасадом `RouterAiClient`.

### D3. Формат запроса — OpenAI Chat Completions v1
`POST {BASE_URL}/chat/completions`, заголовки `Authorization: Bearer <key>`, `Content-Type: application/json`. Тело: `{ model, messages, tools?, tool_choice?, temperature?, max_tokens?, top_p? }`. `messages`: `{role, content?}` (system/user), `{role:"assistant", content?, tool_calls?}`, `{role:"tool", tool_call_id, content}`. `tools`: `[{type:"function", function:{name, description, parameters}}]`. Это стандартный контракт; RouterAI декларирует совместимость.

### D4. Валидация ответа через zod
Схема `ChatCompletionResponse`: `choices[0].message {role, content?, tool_calls?}`, `tool_calls: [{id, type:"function", function:{name, arguments:string}}]`, опц. `usage`, `id`, `model`. `safeParse` → при ошибке возвращаем `RouterAiError` (не бросаем необработанное). `arguments` остаётся строкой (парсится отдельно — см. D6).

### D5. Ретраи: 429/5xx/`AbortError`(таймаут)/сетевой `TypeError`
- базовая задержка `RETRY_BASE_MS`, множитель `2`, до `RETRIES` попыток.
- только для идемпотентных чат-запросов (все чат-запросы к LLM идемпотентны на уровне HTTP — повтор допустим).
- заголовок `Retry-After` на 429/503 учитывается, если присутствует (минимум с базовой задержкой).
- 4xx (кроме 429) НЕ повторяются (обычно ошибка запроса/авторизации).
- таймаут через `AbortController` на каждый `fetch` (`REQUEST_TIMEOUT_MS`).

### D6. Аргументы вызова функции — отдельный парсинг
`tool_calls[].function.arguments` — строка JSON (по контракту). Парсим lazily: `parseToolCallArguments(raw)` → `{ ok: true, value } | { ok:false }`. Возврат вызова содержит и `raw`, и распарсенный `args`. Спека требует «ошибку с именем функции, не роняя запрос» — то есть malformed-arguments не должны ронять весь запрос: это отдельный `ToolCall` с `parseError`. Решение: возвращаем вызов с `args: null` + флаг ошибки, чтобы оркестратор мог сообщить модели о некорректном вызове (будущие change'ы).

### D7. Маппинг ToolDef → OpenAI tools
`mapToolsToOpenAi(tools: ToolDef[]): OpenAiTool[]`. `inputSchema` (`JSONObjectSchema`) передаётся как `parameters` as-is (он уже в JSON-схеме). Имя `mail.search` с точкой — допустимо для OpenAI `name`? Контракт требует `^[a-zA-Z0-9_-]{1,64}$`. **Точки недопустимы.** Поэтому имя трансформируется: `.` → `_` (`mail.search` → `mail_search`) и обратно при резолве (`_` → `.`) через единый `toOpenAiToolName`/`fromOpenAiToolName`. Альтернатива — переименовать тулы, но это ломает существующие спеки `mail.*`.

### D8. Роли → модели
`AgentRole = 'orchestrator' | 'analyzer' | 'helper'`. `resolveModel(config, { role?, model? })`: явный `model` > `config.MODEL_<ROLE>` > default. Map ролей к полям конфига: `orchestrator→MODEL_ORCHESTRATOR`, `analyzer→MODEL_ANALYZER`, `helper→MODEL_HELPER`. Сервисный helper для embeddings не тут.

### D9. Сокрытие секрета
`redactKey(msg)`: заменяет значение `ROUTERAI_API_KEY` (если встретится в строке) на `***`. Применяется ко всем формируемым сообщениям ошибок и к телу запроса при логировании (логируем без `Authorization`). Заголовок `Authorization` НЕ логируется никогда. ErrorMessage-клиент не эскейпит, а `RouterAiError` формируется из безопасного подмножества (статус, модель, короткая причина), без сырого тела ответа, содержащего ключ (его там нет по контракту, но подстраховка — `redactKey`).

### D10. Структура модулей
- `src/llm/types.ts` — типы сообщений (`ChatMessage`, `ToolCall`), `OpenAiTool`, `ChatRequest`, `ChatResult`, `RouterAiError`.
- `src/llm/schema.ts` — zod-схемы ответа (`ChatCompletionResponseSchema`).
- `src/llm/tool-mapping.ts` — `mapToolsToOpenAi`, `toOpenAiToolName`/`fromOpenAiToolName`.
- `src/llm/models.ts` — `AgentRole`, `resolveModel`.
- `src/llm/routerai-client.ts` — `RouterAiClient` (fetch, ретраи, парсинг, redact).
- `src/llm/index.ts` — реэкспорт (замена заглушки).
- Конфиг-поля ретраев: добавить опц. `LLM_REQUEST_TIMEOUT_MS`, `LLM_RETRIES`, `LLM_RETRY_BASE_MS` в `ConfigSchema` (с defaults), без обязательности.

## Risks / Trade-offs

- **[Риск: живой API RouterAI временно 500 на момент зонда]** → Mitigation: контракт (OpenAI v1) известен; верификация wire-формата tool-calling — первым шагом задачи 6 (gated `INTEGRATION_LLM=1`). До восстановления сервиса — юнит-тесты на моках полностью покрывают контракт.
- **[Риск: точный формат `tool_calls` для glm-через-RouterAI может отличаться от эталонного OpenAI]** (напр. `function_call` legacy или иной shape аргументов) → Mitigation: валидация zod принимает оба варианта (`tool_calls` v1 + `function_call` legacy), нормализуя к единому `ToolCall`. Зафиксировать реальный формат в observation по итогам gated-теста.
- **[Риск: имена тулов с точкой vs `^[a-zA-Z0-9_-]{1,64}$`]** → Mitigation: D7 (`.`↔`_`). Таблица соответствия — в `tool-mapping.ts`.
- **[Трейд-офф: `stream:false` — весь ответ в RAM]** Для писем/анализа размера ответа оркестратора это приемлемо; стриминг вводится позже при необходимости.
- **[Риск: 401 при неверном/истёкшем ключе]** → Mitigation: не ретраим (4xx), возвращаем `RouterAiError` с указанием «ошибка авторизации», без раскрытия ключа.

## Migration Plan

Greenfield-модуль `src/llm/`, поверх существующего конфига. Развёртывание:

1. Добавить опц. поля ретраев в `ConfigSchema` (`LLM_REQUEST_TIMEOUT_MS`, `LLM_RETRIES`, `LLM_RETRY_BASE_MS`).
2. `types.ts`, `schema.ts`, `tool-mapping.ts`, `models.ts`.
3. `routerai-client.ts` (fetch, ретраи, валидация, redact).
4. `index.ts` (экспорт), удалить заглушку.
5. Юнит-тесты (мок fetch: plain, tool_calls, legacy function_call, 429→retry, 5xx→retry, timeout, malformed, 401, redact).
6. (Gated) интеграция против живого RouterAI — верификация формата tool_calls.
7. `npm test`, `tsc`, `lint`, `openspec validate`.

Откат: удалить `src/llm/*` (вернуть заглушку `index.ts`) и откатить опц. поля конфига — обратно-совместимо.

## Open Questions

- **Точный wire-формат `tool_calls` ответа glm-5.2/5.3-flash через RouterAI** — deferred до задачи верификации (gated-тест). Структура валидации (D4) допускает оба варианта, так что разрешение не меняет спеки/подход.