# Tasks

## 1. Мастер сбора критериев

- [x] 1.1 Создать `src/transport/cli/prompts.ts`: типы `SearchCriteriaInput` (тема/дата/отправитель, опц.), `SendCriteriaInput` (тема/текст/получатель). Функция `parseCriteriaLine(line): { field, value } | null` — парсинг `ключ - значение`, валидация имени поля. Unit-тест `tests/cli-prompts.test.ts`: корректный парсинг, пустое поле, отсутствие разделителя, лишние пробелы.
- [x] 1.2 Функции `validateValue(field, value): string | null` (ISO-дата для `дата`, email для `отправитель`, непустое для `тема`/`текст`) и `promptSearchCriteria(io): Promise<SearchCriteriaInput | null>` (цикл сбора, валидация, повтор при ошибке, пустая строка завершает). Unit-тест: сбор 3 полей, невалидная дата → повтор, невалидный email → повтор, пустой ввод после одного поля → критерии, пустой ввод сразу → отмена (null).
- [x] 1.3 Функция `promptSendCriteria(io): Promise<SendCriteriaInput | null>` — сбор темы, текста, получателя с валидацией. Unit-тест: полный сбор, пропуск обязательного поля → повтор, отмена.
- [x] 1.4 Функция `promptAccount(io, accounts): Promise<MailAccount | null>` — 0 аккаунтов → null + сообщение; 1 → авто-выбор; ≥2 → список + выбор. Функция `promptUid(io, messages): Promise<number | null>` — чтение UID, валидация против списка. Функция `promptConfirm(io, question): Promise<boolean>` — да/нет. Unit-тесты для каждого.

## 2. Обработчики guided-команд

- [x] 2.1 Создать `src/transport/cli/commands/find.ts`: `runFindCommand(deps)` — сбор критериев → выбор аккаунта → `mail.search` handler → форматированный вывод списка (`formatMessageList`) или «ничего не найдено». Deps: `{ io, accounts }`. Unit-тест `tests/cli-commands-find.test.ts`: стаб `mail.search` handler, MockConsoleIO, проверка вывода.
- [x] 2.2 Создать `src/transport/cli/commands/analyze.ts`: `runAnalyzeCommand(deps)` — сбор критериев → выбор аккаунта → `mail.search` → если >1: показ 5 + `promptUid` → `mail.fetch` → `analyzer.run(инструкция с телом)` → вывод саммари. Deps: `{ io, accounts, analyzer }`. Unit-тест: стаб анализатора, проверка вызова `analyzer.run` с телом письма.
- [x] 2.3 Создать `src/transport/cli/commands/download.ts`: `runDownloadCommand(deps)` — сбор критериев → выбор аккаунта → `mail.search` → если >1: показ 5 + `promptUid` → `mail.downloadAttachments` в `~/Загрузки` (с `mkdirSync`) → вывод путей или «вложений нет». Deps: `{ io, accounts, downloadDir }`. Unit-тест: стаб `mail.downloadAttachments`, проверка путей.
- [x] 2.4 Создать `src/transport/cli/commands/send.ts`: `runSendCommand(deps)` — сбор (тема/текст/получатель) → выбор аккаунта → черновик → `formatDraft` + вывод → `promptConfirm` → при да: `mail.send` → сообщение об успехе; при нет: отмена. Deps: `{ io, accounts }`. Unit-тест: подтверждение да → вызов `mail.send`; подтверждение нет → без вызова.

## 3. Интеграция в REPL и bootstrap

- [x] 3.1 Изменить `CliRepl` (`src/transport/cli/repl.ts`): убрать `runQuery` (свободный текст), убрать обработчики `/help`/`/clear`/`/reset`, добавить маршрутизацию `/find`/`/analyze`/`/download`/`/send` к обработчикам, оставить `/quit`/`/stats`. Не-slash текст → сообщение «только slash-команды». Deps репозитория (accounts, analyzer, downloadDir) передаются в `CliReplOptions`.
- [x] 3.2 Изменить `bootstrap()` (`src/transport/cli/bootstrap.ts`): создать анализатор через `createAnalyzer` (передать в `composeAgents` для delegate, и вернуть тот же инстанс в `BootstrapResult.analyzer`); добавить `accounts` и `downloadDir` в `BootstrapResult`.
- [x] 3.3 Изменить `src/index.ts`: передать `analyzer`, `accounts`, `downloadDir` из `BootstrapResult` в `CliReplOptions`.
- [x] 3.4 Добавить форматтеры в `src/transport/cli/format.ts`: `formatMessageList(messages)`, `formatDraft(draft)`, `formatCommandHelp()` (список доступных команд). Unit-тесты в `tests/cli-format.test.ts`.

## 4. Обновление/замена существующих тестов

- [x] 4.1 Переписать `tests/cli-repl.test.ts`: убрать тесты свободного текста, `/help`, `/reset`, `/clear`; добавить тесты guided-режима (не-slash отклоняется, `/find` маршрутизируется, `/unknown` → подсказка, `/quit` выход, `/stats` отчёт). Стаб-обработчики команд (vi.mock или стаб deps).
- [x] 4.2 Обновить `tests/cli-repl-progress.test.ts`: проверить, что прогресс tool-вызовов из обработчиков команд отображается (обработчики вызывают тулы → события логгера/прогресса). Либо удалить, если прогресс теперь неактуален (guided-команды детерминированы, прогресс тулов внутри команд).
- [x] 4.3 Обновить `tests/cli-bootstrap.test.ts`: `BootstrapResult` теперь содержит `analyzer`, `accounts`, `downloadDir` — проверить их наличие.
- [x] 4.4 Обновить E2E `tests/integration/cli-e2e-search.test.ts` и `cli-e2e-send.test.ts`: переписать под guided-команды (`/find` вместо свободного текста; `/send` с подтверждением).
- [x] 4.5 Обновить `tests/integration/cli-repl-integration.test.ts`: переписать под guided-режим (composeAgents + stub LLM не нужен для /find, но нужен для /analyze).

## 5. Финальные проверки

- [x] 5.1 `npm test` — зелёный (все unit + commands + E2E). Проверка: exit 0.
- [x] 5.2 `npx tsc --noEmit` — без ошибок. Проверка: exit 0.
- [x] 5.3 `npm run lint` — без ошибок. Проверка: exit 0.
- [x] 5.4 `openspec validate guided-commands --strict` — проходит. Проверка: exit 0.

### Доп. фикс: автоподключение IMAP-сессии в guided-командах

Guided-команды вызывают IMAP-тулы (`mail.search`, `mail.fetch`,
`mail.downloadAttachments`, `mail.send`) напрямую, минуя LLM-цикл оркестратора.
В оркестраторе LLM сам вызывает `mail.connect` перед остальными тулами. В guided-режиме этого шага не было → команды падали с «подключение не установлено».

- [x] Создан `src/transport/cli/commands/connect.ts` (`ensureMailConnected`):
  проверяет `SessionStore.has(login)`, при отсутствии вызывает тул
  `mail.connect`, выводит прогресс/ошибки в io.
- [x] Все 4 команды (`/find`, `/analyze`, `/download`, `/send`) вызывают
  `ensureMailConnected(io, account)` после выбора аккаунта, перед операцией.
- [x] Unit-тесты команд: `seedSession()` в `beforeEach` (pre-seed
  `getSharedSessionStore`) чтобы `ensureMailConnected` не вызывал реальный
  `mail.connect`.
- [x] Тест `tests/cli-commands-connect.test.ts` (4 теста): сессия есть →
  skip, нет → вызов connect, ошибка → false, тул не зарегистрирован → false.
- [x] E2E тесты уже pre-seed сессию через `getSharedSessionStore().set()`.
- [x] Итог: 404 passed / 14 skipped, tsc/lint чисто.

### Доп. фикс 2: client-side fallback для IMAP SEARCH (Яндекс)

**Проблема:** IMAP SEARCH на Яндексе ненадёжен — `SEARCH SUBJECT "Нормоконтроль"`
возвращает 0 даже при точном совпадении темы с кириллицей. Даже ASCII
`SEARCH FROM "Kozloww1508@yandex.ru"` не находит письмо (подтверждено
диагностикой через сырые IMAP-команды). imapflow автоматически добавляет
`CHARSET UTF-8` для литералов, но Яндекс всё равно не ищет корректно.

**Решение:** добавлен client-side fallback в `AbstractImapProvider.search()`:
- Если серверный search по текстовым критериям (`subject`/`from`/`to`)
  вернул 0 — выполняется `fetchAll('1:*')` метаданных и локальная фильтрация.
- `hasTextCriteria()` — проверка наличия subject/from/to.
- `clientSideSearch()` — fetch всех метаданных + фильтрация.
- `matchesCriteria()` — локальный AND по всем критериям (subject/from/to
  подстрочно без учёта регистра; since/before по дате; unseen/flagged/
  answered по флагам).
- Флаги и даты также применяются локально при fallback.
- Если серверный search нашёл совпадения — fallback не вызывается.

**Файлы:**
- `src/tools/mail/providers/abstract-imap-provider.ts` — fallback-логика.
- `tests/imap-client-side-search.test.ts` — 10 тестов (subject/from/to
  кириллица, подстрока, имя отправителя, комбинированный фильтр с датой,
  сервер нашёл → fallback не нужен, без текстовых критериев → fallback
  не нужен, нет совпадений).

**Проверено на реальном Яндексе:** `subject="Нормоконтроль"` → UID=2 ✓,
`subject="ВКР"` → UID=2 ✓, `from="Kozloww1508@yandex.ru"` → UID=2 ✓.

- [x] Итог: 414 passed / 14 skipped, tsc/lint чисто.
