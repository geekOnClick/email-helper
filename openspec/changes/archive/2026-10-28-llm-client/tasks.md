# Tasks

## 1. Конфигурация ретраев

- [x] 1.1 Добавить опц. поля в `ConfigSchema` (`src/config/schema.ts`): `LLM_REQUEST_TIMEOUT_MS` (default `60000`), `LLM_RETRIES` (default `3`), `LLM_RETRY_BASE_MS` (default `1000`). Проверка: `npx tsc --noEmit`; `loadConfig({})` возвращает значения по умолчанию.

## 2. Типы и валидация ответа

- [x] 2.1 Реализовать `src/llm/types.ts`: `AgentRole`, `ChatMessage` (system/user/assistant/tool с `tool_calls`), `ToolCall` (`{id, name, arguments(raw), args(parsed|null), parseError?}`), `OpenAiTool` (`{type:"function", function:{name, description, parameters}}`), `ChatRequest` (`{messages, role?, model?, tools?, tool_choice?, temperature?, max_tokens?, top_p?}`), `ChatResult` (`{content, toolCalls, usage?, model?}`), `RouterAiError`. Проверка: `npx tsc --noEmit`.
- [x] 2.2 Реализовать `src/llm/schema.ts`: zod-схема `ChatCompletionResponseSchema` — `choices[0].message {role, content?, tool_calls?, function_call?}`, `tool_calls: [{id, type, function:{name, arguments}}]`, опц. `function_call` (legacy), `usage`, `id`, `model`. Принимает оба варианта (v1 `tool_calls` и legacy `function_call`), нормализует к `ToolCall[]`. Проверка: unit-тест — парсинг ответа с `tool_calls`, с `function_call` legacy, без вызовов, без `choices` → ошибка.

## 3. Маппинг тулов и модели

- [x] 3.1 Реализовать `src/llm/tool-mapping.ts`: `toOpenAiToolName(name)` (`.`→`_`), `fromOpenAiToolName(name)` (`_`→`.`), `mapToolsToOpenAi(tools: ToolDef[]): OpenAiTool[]` (имя трансформируется, `parameters` = `inputSchema` as-is). Проверка: unit-тест — `mail.search`→`mail_search` и обратно, схема `parameters` сохранена, round-trip.
- [x] 3.2 Реализовать `src/llm/models.ts`: `AgentRole`, `resolveModel(config, {role?, model?})` — явный `model`> `MODEL_<ROLE>` > дефолт роли. Проверка: unit-тест — role `helper`→`MODEL_HELPER`, явный `model` переопределяет, роль `orchestrator`→`MODEL_ORCHESTRATOR`.

## 4. Клиент RouterAI

- [x] 4.1 Реализовать `src/llm/routerai-client.ts`: конструктор `({config, fetch?})`, метод `chat(request): Promise<ChatResult>`. Сборка тела (`model` через `resolveModel`), `POST {BASE_URL}/chat/completions`, `Authorization: Bearer`, `AbortController` таймаут. Парсинг через `ChatCompletionResponseSchema` → `ChatResult` (`content`, `toolCalls` с lazy-парсингом `arguments` через `parseToolCallArguments`). `RouterAiError` при провале. Проверка: `npx tsc --noEmit`.
- [x] 4.2 Ретраи в `routerai-client.ts`: 429/5xx/`TypeError`(сеть)/`AbortError`(таймаут) → экспоненциальная задержка (`LLM_RETRY_BASE_MS` × 2^`n`), до `LLM_RETRIES`; учёт `Retry-After` при наличии; 4xx (кроме 429) не повторяются. Проверка: unit-тест (мок fetch) — 429→успех на 2-й попытке, 500×4→error, 400→error без ретрая.

## 5. Экспорт и сокрытие секрета

- [x] 5.1 Реализовать `redactKey(msg, key)` в `routerai-client.ts` (или `llm/redact.ts`): заменяет вхождение значения ключа на маркер `[REDACTED]` (консистентно с существующей `redact` из mail). Применять во всех сообщениях `RouterAiError` и при логировании тела запроса (без `Authorization`). Проверка: unit-тест — сообщение со встроенным ключом → маркер, заголовок auth не логируется.
- [x] 5.2 Заменить заглушку `src/llm/index.ts` экспортом: `RouterAiClient`, типы, `mapToolsToOpenAi`, `resolveModel`, `AgentRole`. Проверка: `npx tsc --noEmit`; `import { RouterAiClient } from '../llm/index.js'` резолвится.

## 6. Юнит-тесты

- [x] 6.1 Unit-тест `RouterAiClient.chat` (мок fetch, фикстуры OpenAI-формата): успешный текст; `tool_calls` (v1) → `ToolCall[]` с распарсенными args; legacy `function_call` → нормализованный вызов; malformed JSON ответа → `RouterAiError`; пустой `choices` → `RouterAiError`; 401 → error без ретрая без раскрытия ключа. Проверка: тесты зелёные.
- [x] 6.2 Unit-тест параметров запроса: `temperature`/`max_tokens`/`top_p` передаются в теле; системный промпт дошёл; `tool_choice` по имени функции; `tools` из `mapToolsToOpenAi` корректны. Проверка: тесты зелёные.

## 7. Интеграция (gated) и финальная проверка

- [x] 7.1 Интеграционный gated-тест `tests/integration/routerai-chat.test.ts`: при `INTEGRATION_LLM=1` — живой запрос простой реплики к `MODEL_HELPER`, проверка `content` и `model` в ответе; без флага skipped. Шаг верификации wire-формата `tool_calls`: запрос с одним `tool` (echo-функция) → разбор фактического shape, фиксация в observation. Проверка: без флага skip; с флагом — зелёный (либо зафиксированная observation о состоянии API).
- [x] 7.2 `npm test` — зелёный. Проверка: exit 0.
- [x] 7.3 `npx tsc --noEmit` — без ошибок. Проверка: exit 0.
- [x] 7.4 `npm run lint` — без ошибок. Проверка: exit 0.
- [x] 7.5 `openspec validate llm-client --strict` — проходит. Проверка: exit 0.

## Workflow follow-up

- После проверки — запустить `/opsx-archive` для зашивания change и создания основного спека `llm/routerai`.
- По итогам задачи 7.1 — зафиксировать observation о реальном wire-формате ответа RouterAI (tool_calls v1 / legacy function_call / иные расхождения).