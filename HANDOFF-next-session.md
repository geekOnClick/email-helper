# HANDOFF: следующая сессия — Фаза 4 (отправка писем по SMTP)

Проект **email-helper** в `~/Рабочий стол/projects/email-helper`. Разработка по SDD (OpenSpec).

## Контекст для старта

1. Прочитай `PLAN.md` (**Фаза 4 — раздел 5**; решения в разделе 8.5), `openspec/config.yaml`
   (артефакты на русском, структурные заголовки и SHALL/MUST — на английском).
2. **Фазы 0–3 завершены и заархивированы.** `openspec/specs/` — **10 main-спек**: `mail/connection`,
   `mail/search`, `mail/attachments`, `mail/semantic-search`, `llm/routerai`, `llm/embeddings`,
   `agent/orchestrator`, `agent/analyzer`, `agent/helper`, `storage/falkor`.
   `openspec validate --specs --strict` → 10 passed. Архив: `openspec/changes/archive/` (8 change'ов).
3. **Git:** `c15d7aa полностью завершена фаза 3`. Незакоммичен только фикс `tests/integration/routerai-chat.test.ts`
   (maxTokens 20→256 для reasoning-модели). Перед стартом Фазы 4 — закоммить.
4. **RouterAI РАБОТАЕТ** (восстановлено в прошлой сессии). Корневая причина была не в ключе/сервисе,
   а в DDoS-Guard перед RouterAI (избирательно 401 на некоторые ключи). Текущий ключ в `.env`
   (`sk-1...`, 35 симв.) — рабочий. **Wire-форматы верифицированы против живого API:**
   - `POST /chat/completions` → `choices[0].message` с `content`/`tool_calls[].function.arguments` (JSON-строка);
     наш `parseChatResponse` разбирает корректно.
   - `POST /embeddings` (bge-m3) → вектор размерности **1024**.
   - Циклы агентов (orchestrator/analyzer/helper) — зелёные через живой API.
   - Observation «wire-формат не верифицирован» (в `archive/2026-10-28-llm-client/design.md`) — **снят**.
5. **Тесты зелёные:** `npm test` → **214 passed / 14 skipped** (44 файла). Со всеми gated-флагами
   (`INTEGRATION_LLM=1 INTEGRATION_FALKOR=1`) → 222 passed. `tsc`, `lint` — чисто.
6. **Runtime-состояние (вне git):**
   - **FalkorDB** в Docker, контейнер `email-helper-falkordb`, **порт 6380**, healthy.
     Поднять: `docker compose -f docker/docker-compose.yml up -d`. Пароль `falkordb`.
   - Аккаунты Яндекс (basic/пароль приложения) и Outlook (OAuth2, refresh-токен в `.tokens/oauth.json`)
     — в `.env` через `loadConfigWithAccounts()`.
   - `ROUTERAI_API_KEY` в `.env` — рабочий. Модели: `MODEL_HELPER=z-ai/glm-5.3-flash`,
     `MODEL_ORCHESTRATOR/ANALYZER=z-ai/glm-5.2`, `EMBEDDINGS_MODEL=baai/bge-m3`.
   - openspec CLI v1.14.3 (PATH может не содержать — добавляй
     `/home/geekonclick/.nvm/versions/node/v22.11.0/bin`).
7. **Mail-gated тесты** (`INTEGRATION_TEST=1`, Yandex/Outlook IMAP) падают по **timeout 5000ms**
   (default vitest) — давняя особенность окружения, не регрессия. В тестах нет явного timeout;
   при работе с ними — задать `}, 30000)` или поднять default.

## Архитектура (готовый фундамент, НЕ модифицируется в Фазе 4)

- **Почта (Фаза 1):** 5 тулов `mail.connect/listFolders/search/fetch/downloadAttachments`
  (`src/tools/mail/`, `MailSessionStore`, провайдеры Яндекс/Outlook). **SMTP-клиента пока нет** —
  Фаза 4 его введёт (`nodemailer`, по PLAN.md раздел 2).
- **LLM (Фаза 2):** `RouterAiClient` (`src/llm/routerai-client.ts`, injectable `FetchLike`, ретраи,
  `redactKey`), `EmbeddingsClient` (`src/llm/embeddings.ts`). Оркестратор + анализатор + помощник
  (`src/agents/`), `composeAgents()` — точка сборки.
- **Вектор (Фаза 3):** `FalkorClient` (`src/tools/vector/falkor.ts`), тулы `embeddings.index`/`vector.search`.
- **Реестр тулов:** `src/tools/registry.ts` (`ToolDef`, `registerTool`). `HELPER_TOOLS` whitelist
  в `src/agents/helper.ts` (= 7 тулов: 5 mail + 2 векторных).
- **Типы писем:** `src/types/email.ts` (`EmailFull`, `EmailAddress`, `SearchCriteria`).

## Задача: Фаза 4 (PLAN.md раздел 5, решения 8.5)

**Цель:** `mail.send` по SMTP, шаблоны, валидация критериев, подтверждение перед отправкой.

Область (по PLAN.md):
- SMTP-клиент (nodemailer) для Яндекс + Outlook.
- Схема «критериев письма»: получатели (TO/CC/BCC), тема, тело, вложения, кодировка.
- Поддержка нескольких получателей (TO/CC/BCC).
- Валидация и предпросмотр перед отправкой (подтверждение пользователем).
- Тесты с мок SMTP-сервером (smtp-server npm в тестах).

**SDD-изменение:** `mail-send` (capability `mail/send`).

### Ключевые вопросы (уточни в proposal/design)

- **SMTP-провайдеры.** Яндекс: `smtp.yandex.ru:465` (basic/пароль приложения, тот же что IMAP).
  Outlook: OAuth2 (XOAUTH2, refresh-токен уже есть в `.tokens/oauth.json` для IMAP — переиспользовать?).
  См. `src/tools/mail/providers/` (паттерн `MailProvider` + factory), `archive/2026-10-27-mail-connect/design.md`.
- **Тул `mail.send`.** Deps: `sessionStore`? или отдельный SMTP-клиент? Подтверждение перед отправкой —
  как реализовать (тул возвращает черновик, ждёт второго вызова с подтверждением? или это ответственность
  транспорта/оркестратора?). Решить в design. По PLAN.md 8.5 — «агент показывает черновик и ждёт
  подтверждения».
- **Мок SMTP.** `smtp-server` npm — dev-зависимость. Паттерн injectable-транспорта (как `FetchLike`).
- **Подключение помощника.** `mail.send` → в `HELPER_TOOLS` whitelist → modified capability `agent/helper`
  (расширить требование «Набор рутинных тулов» сценарием отправки). См. как сделано в `semantic-search`.

### Старт

**Начни с `/opsx-propose mail-send`.** Перед proposal прочитай:
- `PLAN.md` раздел 5 (Фаза 4) + 3.2 (тул `mail.send`) + 8.5 (критерии письма, подтверждение).
- `src/tools/mail/providers/` (паттерн `MailProvider`, factory, abstract-imap-provider), `session-store.ts`,
  `register-tools.ts`, `types.ts` (`MailAccount`).
- `src/agents/helper.ts` (`HELPER_TOOLS`), `src/agents/compose.ts` (точка сборки).
- `openspec/specs/mail/connection/spec.md` (контракт подключения — переиспользуется для SMTP?),
  `openspec/specs/agent/helper/spec.md` (whitelist контракта).
- `archive/2026-10-27-mail-connect/` (ближайший стиль: провайдер + тул + фабрика),
  `archive/2026-10-28-helper-agent/` (modified-vs-new capability для whitelist).

## SDD-цикл

`/opsx-propose <change>` → `/opsx-apply` → `/opsx-archive`. Slash-команды pi (`.pi/prompts/opsx-*.md`),
под капотом — openspec CLI. Стиль артефактов и modified/new capability — см. `archive/`.
