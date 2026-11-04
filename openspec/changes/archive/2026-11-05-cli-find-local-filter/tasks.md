# Tasks

## 1. Переход /find на локальную фильтрацию (как /find-all)

- [x] 1.1 В `src/transport/cli/prompts.ts` экспортировать `isoToDate` (ранее приватная). Верификация: `tsc` чист, существующие тесты `cli-find-all-prompts.test.ts`/`cli-find-all-collect.test.ts` зелёные.
- [x] 1.2 Переписать `src/transport/cli/commands/find.ts`: `buildSearchArgs(input, fallbackDays)` → `FindAllSearchArgs` (`serverCriteria` = только даты; `subject`/`from` — локальный фильтр). Явная `дата` → `since` = `isoToDate(date)`, `before` = `+1 день` (один день включительно). Без даты → `since` = `now − fallbackDays`. Поиск через `collectAllMessages` (из `find-all.ts`). Вывод `formatMessageList`; `truncated` → предупреждение. Верификация: unit-тесты в `tests/cli-commands-find.test.ts` покрывают: тема+отправитель находятся локально (regression ключевого сценария), на сервер идут только даты (нет subject/from), явная дата → since+before одного дня, ничего не найдено, отмена, нет аккаунтов, ошибка тула, тул не зарегистрирован.
- [x] 1.3 `FindCommandDeps` получает опциональное `fallbackDays?: number` (дефолт 180). Верификация: тип компилируется; тесты передают/не передают `fallbackDays`.

## 2. Проводка fallbackDays из конфига

- [x] 2.1 В `src/transport/cli/bootstrap.ts`: `BootstrapResult` получает `fallbackDays: number` = `config.MAIL_SEARCH_FALLBACK_DAYS`; `buildAgent` возвращает его. Верификация: `tsc` чист; `cli-bootstrap.test.ts` не ломается (новое поле опционально в деструктуризации).
- [x] 2.2 В `src/transport/cli/repl.ts`: `GuidedCommandDeps` получает `fallbackDays?`; `CliRepl` хранит и передаёт в `runFindCommand({ io, accounts, fallbackDays })`. Верификация: `tsc` чист; `cli-repl.test.ts` зелёный.
- [x] 2.3 В `src/index.ts`: деструктурировать `fallbackDays` из `bootstrap()` и передать в `CliRepl`. Верификация: `tsc` чист.

## 3. Финальные проверки

- [x] 3.1 `npx tsc --noEmit` — 0 ошибок. Верификация: команда выходит с 0.
- [x] 3.2 `npm run lint` — 0 ошибок. Верификация: команда выходит с 0.
- [x] 3.3 `npx vitest run` — все тесты зелёные (существующие + обновлённые). Верификация: 604 passed, 14 skipped (integration).
