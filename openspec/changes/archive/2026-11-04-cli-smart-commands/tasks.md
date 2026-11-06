# Tasks

## 1. Shared-утилита пакетного поиска (перенос `collectAllMessages`)

- [x] 1.1 Создать `src/transport/cli/commands/search-aggregator.ts`: перенести `collectAllMessages`, `CollectAllMessagesResult`, `CollectAllMessagesOptions`, `matchesLocalFilters`, `normalizeForMatch` из `commands/find-all.ts` без изменения логики
- [x] 1.2 Реэкспортировать `collectAllMessages` и типы из `commands/index.ts` для обратной совместимости тестов

## 2. Зависимости и конфигурация

- [x] 2.1 Добавить в `package.json` зависимости `pdf-parse`, `mammoth`, `xlsx` и установить (`npm install`)
- [x] 2.2 Добавить `ANALYZE_MANY_MAX_EMAILS` (дефолт 10) в `src/config/schema.ts` и `src/config/loader.ts` (env-парсинг)
- [x] 2.3 Пробросить `analyzeManyMaxEmails` через `BootstrapResult` (`bootstrap.ts`)

## 3. Команда `/analyze-many`

- [x] 3.1 Создать `src/transport/cli/commands/analyze-many.ts`: `runAnalyzeManyCommand(deps)` + `AnalyzeManyCommandDeps` (io, accounts, analyzer, fallbackDays, maxEmails). Поток: мастер `promptFindAllCriteria` → выбор аккаунта → `ensureMailConnected` → `collectAllMessages` (из search-aggregator) → усечение до `maxEmails` с предупреждением → фетч тел через `mail.fetch` → сборка инструкции → `analyzer.run()` → вывод саммари + общего смысла
- [x] 3.2 Экспортировать `runAnalyzeManyCommand` из `commands/index.ts`

## 4. Утилита извлечения текста вложений + команда `/analyze-attachments`

- [x] 4.1 Создать `src/transport/cli/commands/attachment-text.ts`: `extractAttachmentText(path)` → `{ text, skipped, reason }`. Текстовые (txt/csv/json/html/htm/eml) — UTF-8 (HTML — stripping тегов); PDF — `pdf-parse`; DOCX — `mammoth.extractRawText`; XLSX — `xlsx`; изображения/бинарь — `skipped: true`
- [x] 4.2 Создать `src/transport/cli/commands/analyze-attachments.ts`: `runAnalyzeAttachmentsCommand(deps)` + `AnalyzeAttachmentsCommandDeps` (io, accounts, analyzer, downloadDir). Поток: мастер `promptSearchCriteria` → выбор аккаунта → `ensureMailConnected` → поиск через `mail.search` → выбор UID (1 → сразу, >1 → показ 5 + UID) → скачивание во временную папку (`os.tmpdir()` + уникальный поддиректорий) через `mail.downloadAttachments` → `extractAttachmentText` для каждого файла → сборка инструкции → `analyzer.run()` → вывод саммари → удаление временной папки в `finally` (всегда)
- [x] 4.3 Экспортировать `runAnalyzeAttachmentsCommand` из `commands/index.ts`

## 5. Команда `/smart-send` (мастер + генерация + цикл правки)

- [x] 5.1 Добавить в `src/transport/cli/prompts.ts`: `SmartSendCriteriaInput` (тема, получатель, промпт), `promptSmartSendCriteria(io)` (валидация: непустая тема, валидный email, непустой промпт; пустая строка — завершение) и `promptSendAction(io)` (читает строку: `отправить`/`отмена`/произвольный текст-правка → `{ action: 'send'|'cancel'|'redo', feedback?: string }`)
- [x] 5.2 Создать `src/transport/cli/commands/smart-send.ts`: `runSmartSendCommand(deps)` + `SmartSendCommandDeps` (io, accounts, llmClient: RouterAiClient). Поток: мастер → выбор аккаунта → `ensureMailConnected` → one-shot `client.chat({ role: 'helper', messages })` генерация тела по теме+промпту → показ черновика (`formatDraft`) → `promptSendAction`: `send` → `mail.send({confirm:true})`; `cancel` → отмена; `redo` → регенерация только тела по обратной связи (тема/получатель фиксированы) → новый черновик → повтор цикла. Тело — plain text
- [x] 5.3 Экспортировать `runSmartSendCommand` из `commands/index.ts`

## 6. Интеграция в REPL и bootstrap

- [x] 6.1 Обновить `src/transport/cli/repl.ts`: убрать маршруты `/find`, `/find-all`, `/download`, `/send`; добавить `/analyze-many`, `/analyze-attachments`, `/smart-send`. Обновить `GuidedCommandDeps` (добавить `llmClient: RouterAiClient`, `analyzeManyMaxEmails`; убрать неиспользуемые `downloadDir`/`fallbackDays` если больше не нужны — проверить: `fallbackDays` нужен `/analyze-many`, `downloadDir` нужен `/analyze-attachments` для tmp-базы)
- [x] 6.2 Обновить `src/transport/cli/format.ts`: `formatCommandHelp` — новый список команд (убрать /find, /find-all, /download, /send; добавить /analyze-many, /analyze-attachments, /smart-send)
- [x] 6.3 Обновить `src/transport/cli/bootstrap.ts`: отдать `llmClient` (RouterAiClient) в `BootstrapResult` для `/smart-send`
- [x] 6.4 Обновить `src/index.ts`: пробросить `llmClient` и `analyzeManyMaxEmails` в `CliRepl`

## 7. Удаление старых команд

- [x] 7.1 Удалить `src/transport/cli/commands/find.ts`
- [x] 7.2 Удалить `src/transport/cli/commands/find-all.ts` (логика перенесена в search-aggregator.ts)
- [x] 7.3 Удалить `src/transport/cli/commands/download.ts`
- [x] 7.4 Удалить `src/transport/cli/commands/send.ts`
- [x] 7.5 Убрать экспорты удалённых команд из `commands/index.ts`; убрать `promptSendCriteria` из `prompts.ts` (заменён на `promptSmartSendCriteria`)

## 8. Тесты — удаление и адаптация

- [x] 8.1 Удалить `tests/cli-commands-find.test.ts`
- [x] 8.2 Удалить `tests/cli-commands-find-all.test.ts`
- [x] 8.3 Удалить `tests/cli-commands-download.test.ts`
- [x] 8.4 Удалить `tests/cli-commands-send.test.ts`
- [x] 8.5 Адаптировать `tests/cli-find-all-collect.test.ts`: импорт `collectAllMessages` из `search-aggregator.ts` (или удалить, если покрывается новыми тестами)
- [x] 8.6 Удалить `tests/cli-repl-find-all-route.test.ts`
- [x] 8.7 Адаптировать `tests/cli-find-all-prompts.test.ts` → переименовать/оставить тесты мастера `promptFindAllCriteria` (он переиспользуется `/analyze-many`)
- [x] 8.8 Адаптировать `tests/cli-repl.test.ts` и `tests/cli-repl-add-account-flow.test.ts`: обновить набор маршрутов и help-текст

## 9. Тесты — новые команды

- [x] 9.1 Создать `tests/cli-commands-analyze-many.test.ts`: пакетный поиск + анализ (mock searchTool/fetchTool/analyzer), усечение по maxEmails, ничего не найдено, отмена, ошибка тулa
- [x] 9.2 Создать `tests/cli-attachment-text.test.ts`: текстовые форматы, HTML stripping, PDF/DOCX/XLSX (mock библиотек или реальные fixtures), пропуск изображения, пропуск бинарного
- [x] 9.3 Создать `tests/cli-commands-analyze-attachments.test.ts`: письмо с вложениями (mock downloadTool → tmp-пути, mock analyzer), письмо без вложений, ошибка анализа → файлы удаляются (проверка unlink/rmdir), неподдерживаемый формат → пропуск с пометкой
- [x] 9.4 Создать `tests/cli-commands-smart-send.test.ts`: генерация + отправка с первого раза, цикл правки (redo → новое тело), отмена, ошибка LLM, тема/получатель неизменны при правке
- [x] 9.5 Создать `tests/cli-repl-routes.test.ts`: маршруты `/analyze-many`, `/analyze-attachments`, `/smart-send` вызывают свои обработчики; `/find`/`/find-all`/`/download`/`/send` → «неизвестная команда»; help-текст содержит новые команды

## 10. Финальные проверки

- [x] 10.1 `npx tsc --noEmit` — без ошибок
- [x] 10.2 `npm run lint` — без ошибок
- [x] 10.3 `npx vitest run` — все тесты зелёные
- [x] 10.4 `openspec validate cli-smart-commands` — change валиден
