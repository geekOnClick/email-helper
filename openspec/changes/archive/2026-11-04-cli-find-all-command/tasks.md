# Tasks

## 1. Мастер критериев /find-all

- [x] 1.1 В `src/transport/cli/prompts.ts` добавить тип `FindAllCriteriaInput { subject?; from?; dateFrom?; dateTo? }`, набор полей `['тема','отправитель','дата с','дата по']`, парсер/валидатор (тема — непустая; отправитель — email; даты — ISO `YYYY-MM-DD` с проверкой реальной даты) и функцию `promptFindAllCriteria(io)`. Валидация диапазона: если оба поля дат введены — `дата с` не позже `даты по`, иначе попросить повторить. Пустая строка завершает сбор: ≥1 поля → критерии, 0 → `null`. Верификация: unit-тесты в `tests/cli-find-all-prompts.test.ts` покрывают ввод темы, темы+диапазона, диапазона без темы, невалидной даты, невалидного диапазона (с позже по), дубликата поля, пустого ввода-отмены.
- [x] 1.2 Добавить чистую функцию `buildSearchArgsFromFindAll(criteria)` → `{ subject?, from?, since?, before? }` с нормализацией «дата по включительно»: `before` = `dateTo + 1 день`; `since` = `dateFrom` без изменений; если диапазон не указан — `since` = `1970-01-01` (ранний, обходит bounded fallback). Верификация: unit-тесты проверяют нормализацию включительности `dateTo`, ранний `since` при отсутствии дат, передачу `subject`/`from`.

## 2. Форматтер дат и агрегация пагинации

- [x] 2.1 В `src/transport/cli/format.ts` добавить `formatFindAllTable(messages: EmailMessage[]): string` — таблица с заголовками «Дата письма | Тема письма | Отправитель» и строками данных (дата `YYYY-MM-DD`, полная тема, отправитель); ширина колонок по данным; если `messages.length > 10` — первые 10 строк + `найдено ещё ${N-10} писем`; если 0 — пустая строка (обработчик выведет «Ничего не найдено.»). Верификация: unit-тесты в `tests/cli-format-dates-list.test.ts` покрывают 0, заголовки, тему/отправителя, имя отправителя, 3/10/11/15, нормализацию темы, отсутствие отправителя.
- [x] 2.2 Добавить функцию-агрегатор `collectAllMessages(searchTool, login, criteriaArgs, { pageSize=50, maxPages=200 }): Promise<{ messages: EmailMessage[]; truncated: boolean }>` — проходит пагинацию `mail.search` (`limit`/`offset`, пока `hasMore` не `false`), аккумулирует `messages`, останавливается по `hasMore===false`/пустой странице/`maxPages`; `truncated=true` если достигнут потолок. Верификация: unit-тесты с замоканным `mail.search` (одна страница, несколько страниц, `hasMore` true→false, достижение `maxPages` → `truncated`).

## 3. Обработчик команды /find-all

- [x] 3.1 Создать `src/transport/cli/commands/find-all.ts` с `runFindAllCommand({ io, accounts })`: собрать критерии через `promptFindAllCriteria`; если `null` — отмена; выбрать аккаунт через `promptAccount`; если `null` — выход; `ensureMailConnected`; получить тул `mail.search`; вызвать `collectAllMessages`; если `messages.length===0` — «Ничего не найдено.»; иначе вывести `formatFindAllTable(messages)`; если `truncated` — предупреждение о лимите пагинации. Верификация: unit-тесты в `tests/cli-commands-find-all.test.ts` покрывают успех (3 письма → таблица), >10 писем (10 строк + «найдено ещё N»), ничего не найдено, отмену мастера, ошибку подключения, `truncated` (предупреждение).
- [x] 3.2 В `src/transport/cli/commands/index.ts` экспортировать `runFindAllCommand`. Верификация: импорт доступен, `tsc` чист.

## 4. Маршрут REPL и справка

- [x] 4.1 В `src/transport/cli/repl.ts` добавить кейс `'/find-all'` → `runSafe(() => runFindAllCommand({ io: this.io, accounts: this.registry.list() }))`. Верификация: REPL-тест в `tests/cli-repl-find-all-route.test.ts` проверяет, что ввод `/find-all` вызывает `runFindAllCommand` (через шпиона/заглушку) и не падает.
- [x] 4.2 В `src/transport/cli/format.ts` `formatCommandHelp` добавить строку `/find-all` с описанием «поиск всех писем по теме/отправителю и датам». Верификация: unit-тест проверяет наличие `/find-all` в справке; обновить существующий тест справки, если он.snapshot'ит полный текст.

## 5. Интеграция и финальные проверки

- [x] 5.1 Интеграционный REPL-тест `tests/integration/cli-repl-find-all.test.ts`: полный поток `/find-all` с замоканными `mail.connect`/`mail.search` (возвращает 2 страницы, всего 12 писем) → вывод «Найдено писем: 12», 10 дат, «найдено ещё 2 писем». Верификация: тест зелёный.
- [x] 5.2 Проверить `npx tsc --noEmit` (0 ошибок), `npm run lint` (0 ошибок), `npx vitest run` (все тесты зелёные). Верификация: команды выходят с 0.
- [x] 5.3 Обновить README: добавить `/find-all` в список slash-команд с кратким описанием. Верификация: README содержит команду.
