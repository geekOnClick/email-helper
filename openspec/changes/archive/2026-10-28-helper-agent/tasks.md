# Tasks

## 1. Системный промпт помощника

- [x] 1.1 Наполнить `skills/helper.md` вместо каркаса-заглушки: роль помощника (дешёвая модель, чётко по инструкции), доступные тулы (`mail.connect`, `mail.listFolders`, `mail.search`, `mail.fetch`, `mail.downloadAttachments`), зоны ответственности (подключение, поиск, чтение, скачивание), формат ответа (кратко: что сделал, сколько, пути), ограничения (не анализирует содержимое, не отправляет письма без подтверждения, не выводит пароль). Проверка: файл содержит секции Роль/Доступные тулы/Зоны ответственности/Формат ответа/Ограничения; `loadSkill('helper')` возвращает непустую строку.

## 2. Субагент-помощник

- [x] 2.1 Реализовать `src/agents/helper.ts`: константа `HELPER_TOOLS = ['mail.connect','mail.listFolders','mail.search','mail.fetch','mail.downloadAttachments']`, приватный класс `Helper` (реализует `Subagent`: `name: 'helper'`, `description`, `run(input): Promise<string>` — крутит `runToolLoop` с ролью `'helper'`, своим скилом, набором тулов из фильтра `listTools().filter(t => HELPER_TOOLS.includes(t.name))` через `mapToolsToOpenAi`, БЕЗ `extraTools`), async-фабрику `createHelper(opts: HelperOptions): Promise<Subagent>` (грузит скил через `loadSkill('helper')`, читает лимиты из `config` с override). Проверка: `npx tsc --noEmit`; `createHelper({ client, config })` разрешается в объект с `name === 'helper'`.
- [x] 2.2 Реализовать `src/agents/compose.ts`: `ComposeAgentsOptions` (client, config, accounts, oauth2?, tokenStorePath?, downloadDir?, maxIterations?, maxToolResultChars?), `composeAgents(opts): Promise<Orchestrator>` — регистрирует mail-тулы через `registerMailConnectTools({ accounts, oauth2, tokenStorePath, sessionStore: getSharedSessionStore(), downloadDir })`, строит `analyzer = await createAnalyzer(...)` и `helper = await createHelper(...)`, возвращает `Orchestrator.create({ client, config, subagents: [analyzer, helper], maxIterations?, maxToolResultChars? })`. Проверка: `npx tsc --noEmit`.

## 3. Экспорт

- [x] 3.1 Пополнить экспорт `src/agents/index.ts`: `+export { createHelper }`, `+export type { HelperOptions }`, `+export { composeAgents }`, `+export type { ComposeAgentsOptions }`. Проверка: `npx tsc --noEmit`; `import { createHelper, composeAgents } from '../agents/index.js'` резолвится.

## 4. Юнит-тесты помощника

- [x] 4.1 Реализовать `tests/helper.test.ts` с мок `RouterAiClient` (паттерн `mockClient(results)` и `tc(...)` из `tests/analyzer.test.ts`): финал без тулов → 1 итерация, `truncated:false`, `role:'helper'`, системный промпт первым сообщением; `mail.search` (stub в реестре) → результат → финал (2 итерации, в истории `role:'tool'`). Проверка: тесты зелёные.
- [x] 4.2 Добавить сценарии устойчивости в `tests/helper.test.ts`: ошибка тулa (handler throws) → ошибка-как-результат, финал; исчерпание итераций (`AGENT_MAX_ITERATIONS: 2`, модель всегда зовёт тул) → без исключения. Проверка: тесты зелёные.
- [x] 4.3 Добавить проверки набора тулов: в наборе есть `mail.connect`/`mail_search`/`mail_downloadAttachments` (OpenAI-вид), `delegate` отсутствует. Проверка: тест зелёный.

## 5. Тесты сборки

- [x] 5.1 Реализовать `tests/compose-agents.test.ts`: `resetTools()` в `beforeEach`; `composeAgents({ client: mockClient, config, accounts: [] })` строит оркестратор, в `getOpenAiTools()` присутствует `delegate` (т.к. оба субагента зарегистрированы). Проверка: тест зелёный.

## 6. Интеграционный gated-тест

- [x] 6.1 Реализовать `tests/integration/helper-loop.test.ts`: при `INTEGRATION_LLM=1` — один простой прогон `createHelper(...).then(h => h.run('Подключись и сообщи провайдера.'))` через живой RouterAI (без тулов), проверка `content` непустой; при 500/исчерпании — пропуск с observation (как в `tests/integration/analyzer-loop.test.ts`). Без флага — skipped. Проверка: без флага skip; с флагом — зелёный либо observation.

## 7. Финальная проверка

- [x] 7.1 `npm test` — зелёный (новые тесты помощника и сборки входят). Проверка: exit 0.
- [x] 7.2 `npx tsc --noEmit` — без ошибок. Проверка: exit 0.
- [x] 7.3 `npm run lint` — без ошибок. Проверка: exit 0.
- [x] 7.4 `openspec validate helper-agent --strict` — проходит. Проверка: exit 0.

## Workflow follow-up

- После проверки — запустить `/opsx-archive` для зашивания change и создания основного спека `agent/helper`.
- При восстановлении живого RouterAI — повторить gated-тест (6.1) с реальным тулом и зафиксировать wire-формат цикла помощника в observation.
- Закоммитить Фазу 2 (llm-client + orchestrator + analyzer-agent + helper-agent) — ранее Фаза 2 лежала в рабочем дереве незафиксированной (см. HANDOFF-next-session.md пункт 7).
- После `helper-agent` Фаза 2 завершена: оркестратор + оба субагента. Дальше по PLAN.md раздел 6 — Фазы 3/4/5 можно параллелить. Следующая вероятная фаза — Фаза 3 (векторное хранилище + семантический поиск) или Фаза 5 (CLI-транспорт, использующий `composeAgents`).