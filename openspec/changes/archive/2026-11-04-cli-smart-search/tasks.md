# Tasks

## 1. Мастер ввода промпта `/smart-search`

- [x] 1.1 Добавить в `prompts.ts` тип `SmartSearchInput` (`{ prompt: string }`) и функцию `promptSmartSearchPrompt(io)`: запрашивает одну строку (промпт естественным языком), возвращает `SmartSearchInput | null` (null при пустом вводе → отмена). Промпт SHALL быть непустым после `trim()`.
- [x] 1.2 Валидация: пустая строка или только пробелы → возврат null (отмена команды); непустая → `{ prompt }`.

## 2. LLM-парсинг промпта в критерии (one-shot, роль `helper`)

- [x] 2.1 Реализовать в `commands/smart-search.ts` функцию `parsePromptToCriteria(llmClient, prompt)`: один вызов `RouterAiClient.chat({ messages, role: 'helper' })` с системным промптом, требующим JSON-ответ вида `{ тема?: string, отправитель?: string, дата_с?: ISO YYYY-MM-DD, дата_по?: ISO YYYY-MM-DD, количество?: number }`.
- [x] 2.2 Парсинг ответа: `JSON.parse` + валидация полей (даты ISO, email при наличии, `количество` — положительное целое). При невалидном JSON или полях — возврат ошибки парсинга (команда выведет сообщение и отменит).
- [x] 2.3 Нормализация `количество`: если промпт не называет число → дефолт `N = 1`; если называет → `min(количество, ANALYZE_MANY_MAX_EMAILS)` (хард-кап).

## 3. Команда `/smart-search` — поиск, сортировка, вывод

- [x] 3.1 Создать `commands/smart-search.ts` с `SmartSearchCommandDeps` (`io`, `accounts`, `llmClient`, `fallbackDays`, `maxEmails`).
- [x] 3.2 Поток: `promptSmartSearchPrompt` → выбор аккаунта (`promptAccount`) → `ensureMailConnected` → `parsePromptToCriteria` → сборка `FindAllSearchArgs` (`serverCriteria` = только даты; `subject`/`from` из критериев) → `collectAllMessages`.
- [x] 3.3 Bounded-окно: если даты из промпта отсутствуют → `serverCriteria.since = now − fallbackDays` (дефолт 180), `before` не задаётся. При наличии `дата_с`/`дата_по` → `since`/`before` из них (`дата_по` включительно → `before` = полночь следующего дня, переиспользовать `isoToDate`).
- [x] 3.4 Сортировка найденных `messages` по `email.date` убыванием (новые сверху); взять top-N. При `collected.truncated` вывести предупреждение о пагинации.
- [x] 3.5 N=1: если найдено ≥1 — фетч тела топ-1 через `mail.fetch`, вывод письма целиком (отправитель, тема, дата, UID, тело) БЕЗ LLM-анализа.
- [x] 3.6 N>1: вывод таблицы top-N через `formatMessageList`; `promptUid` для выбора; после выбора — `mail.fetch` + вывод письма целиком (с телом) БЕЗ анализа.
- [x] 3.7 Обработка: ничего не найдено → «Ничего не найдено.»; ошибка поиска/фетча/LLM → читаемое сообщение без отмены REPL.

## 4. Вывод письма целиком (форматтер)

- [x] 4.1 Добавить в `format.ts` функцию `formatEmailFull(email: EmailFull, useColor?)`: отправитель, тема, дата, UID, тело — визуально-обособленный блок (аналог `formatDraft`, но для чтения входящего письма). Без LLM-анализа.

## 5. Интеграция в REPL, bootstrap, справку

- [x] 5.1 `commands/index.ts`: экспортировать `runSmartSearchCommand` и `SmartSearchCommandDeps`.
- [x] 5.2 `repl.ts`: добавить маршрут `/smart-search` → `runSmartSearchCommand` с deps (`llmClient`, `fallbackDays`, `analyzeManyMaxEmails`); `GuidedCommandDeps` уже имеет нужные поля (проверить).
- [x] 5.3 `format.ts` `formatCommandHelp`: добавить строку `/smart-search` (краткое описание «поиск писем по промпту естественным языком»).
- [x] 5.4 `repl.ts`: обновить сообщение о slash-режиме и «неизвестная команда» (добавить `/smart-search` в список).
- [x] 5.5 `bootstrap.ts`/`index.ts`: убедиться, что `llmClient`, `fallbackDays`, `analyzeManyMaxEmails` прокинуты в `CliRepl` (уже есть после `cli-smart-commands` — проверить, новых полей не вводить).

## 6. Тесты — `/smart-search`

- [x] 6.1 `tests/cli-commands-smart-search.test.ts`: stub `llmClient` со скриптованным JSON-ответом критериев → проверка парсинга промпта в `{ subject, from, since, N }`.
- [x] 6.2 Тест N=1: промпт «последнее письмо от ded@ded.ru» → stub поиска возвращает ≥1 → проверка вывода письма целиком (с телом) без вызова анализатора.
- [x] 6.3 Тест N>1: промпт «10 писем по теме Урок» → stub поиска возвращает несколько → проверка таблицы `formatMessageList` + `promptUid` + вывод выбранного письма с телом.
- [x] 6.4 Тест дефолта N=1: промпт без числа → проверка, что `количество` = 1.
- [x] 6.5 Тест потолка: промпт запрашивает 50 → проверка `min(50, ANALYZE_MANY_MAX_EMAILS=10)` = 10.
- [x] 6.6 Тест bounded-окна: промпт без даты → проверка `serverCriteria.since = now − fallbackDays`, `before` не задан, `subject`/`from` идут в локальный фильтр (не на сервер).
- [x] 6.7 Тест ошибки LLM-парсинга: stub `llmClient` возвращает невалидный JSON → команда выводит ошибку и отменяет (без поиска).

## 7. Тесты — REPL и справка

- [x] 7.1 `tests/cli-repl-routes.test.ts`: маршрут `/smart-search` вызывает `runSmartSearchCommand` с правильными deps.
- [x] 7.2 `tests/cli-format.test.ts`: `formatCommandHelp` содержит `/smart-search`.
- [x] 7.3 `tests/cli-repl.test.ts` (и/или integration): stub `llmClient` в `GuidedCommandDeps`; `/smart-search` в списке доступных команд.

## 8. Финальные проверки

- [x] 8.1 `tsc --noEmit` — без ошибок.
- [x] 8.2 `eslint .` — без ошибок.
- [x] 8.3 `vitest run` — все тесты проходят (включая новые).
- [x] 8.4 `openspec validate cli-smart-search` — валиден.
