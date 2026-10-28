# Tasks

## 1. Системный промпт анализатора

- [x] 1.1 Наполнить `skills/analyzer.md` вместо каркаса-заглушки: роль анализатора, доступные тулы (`mail.fetch` для извлечения тел писем), зоны ответственности (саммари одного/нескольких писем, извлечение сущностей, классификация тематики), формат ответа (тема/ключевые тезисы/сущности/вывод), ограничения (не выдумывать факты, саммари на языке письма). Проверка: файл содержит секции Роль/Доступные тулы/Зоны ответственности/Формат ответа/Ограничения; `loadSkill('analyzer')` возвращает непустую строку.

## 2. Субагент-анализатор

- [x] 2.1 Реализовать `src/agents/analyzer.ts`: константа `ANALYZER_TOOLS = ['mail.fetch']`, приватный класс `Analyzer` (реализует `Subagent`: `name: 'analyzer'`, `description`, `run(input): Promise<string>` — крутит `runToolLoop` с ролью `'analyzer'`, своим скилом, набором тулов из фильтра `listTools().filter(t => ANALYZER_TOOLS.includes(t.name))` через `mapToolsToOpenAi`, БЕЗ `extraTools`), async-фабрику `createAnalyzer(opts: AnalyzerOptions): Promise<Subagent>` (грузит скил через `loadSkill('analyzer')`, читает лимиты из `config` с override). Проверка: `npx tsc --noEmit`; `createAnalyzer({ client, config })` разрешается в объект с `name === 'analyzer'`.
- [x] 2.2 Пополнить экспорт `src/agents/index.ts`: `+export { createAnalyzer }`, `+export type { AnalyzerOptions }`. Проверка: `npx tsc --noEmit`; `import { createAnalyzer } from '../agents/index.js'` резолвится.

## 3. Юнит-тесты анализатора

- [x] 3.1 Реализовать `tests/analyzer.test.ts` с мок `RouterAiClient` (паттерн `mockClient(results)` и `tc(...)` из `tests/orchestrator.test.ts`): финал без тулов → 1 итерация, `truncated:false`; `mail.fetch` (стаб в реестре) → результат → финал (2 итерации, в истории `role:'tool'` с телом). Проверка: тесты зелёные.
- [x] 3.2 Добавить сценарии устойчивости в `tests/analyzer.test.ts`: ошибка тулa (handler throws) → ошибка-как-результат, финал; исчерпание итераций (`AGENT_MAX_ITERATIONS: 2`, модель всегда зовёт тул) → `truncated:true`. Проверка: тесты зелёные.
- [x] 3.3 Добавить проверки набора тулов и реестра: тул `delegate` отсутствует в `tools` анализатора; регистрация анализатора + стаб-субагента в одном `SubagentRegistry` → оба доступны (`list().length === 2`); повторная регистрация имени `'analyzer'` → throw `субагент уже зарегистрирован`. Проверка: тесты зелёные.

## 4. Интеграционный gated-тест

- [x] 4.1 Реализовать `tests/integration/analyzer-loop.test.ts`: при `INTEGRATION_LLM=1` — один простой прогон `createAnalyzer(...).then(a => a.run('Дай саммари: ключевые темы письма.'))` через живой RouterAI (без тулов), проверка `content` непустой, `truncated:false`; при 500/исчерпании — пропуск с observation (как в `tests/integration/orchestrator-loop.test.ts`). Без флага — skipped. Проверка: без флага skip; с флагом — зелёный либо observation.

## 5. Финальная проверка

- [x] 5.1 `npm test` — зелёный (новые тесты анализатора входят). Проверка: exit 0.
- [x] 5.2 `npx tsc --noEmit` — без ошибок. Проверка: exit 0.
- [x] 5.3 `npm run lint` — без ошибок. Проверка: exit 0.
- [x] 5.4 `openspec validate analyzer-agent --strict` — проходит. Проверка: exit 0.

## Workflow follow-up

- После проверки — запустить `/opsx-archive` для зашивания change и создания основного спека `agent/analyzer`.
- При восстановлении живого RouterAI — повторить gated-тест (4.1) с реальным `mail.fetch` и зафиксировать wire-формат цикла анализатора в observation.
- Закоммитить Фазу 2 (llm-client + orchestrator + analyzer-agent) — ранее Фаза 2 лежала в рабочем дереве незафиксированной (см. HANDOFF-next-session.md пункт 7).
- Следующие change'ы Фазы 2: `helper-agent` (capability `agent/helper`, наполнение `skills/helper.md`) — подключит второго субагента и сделает полный composeAgents-слой.