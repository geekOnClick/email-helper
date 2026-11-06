# Tasks

## 1. Зависимости и конфигурация

- [x] 1.1 Установить npm-зависимости: `react`, `react-dom`, `@mui/material`, `@emotion/react`, `@emotion/styled`, `@mui/icons-material`; dev-зависимости `vite`, `@vitejs/plugin-react`, `@types/react`, `@types/react-dom`
- [x] 1.2 Добавить env-переменные `WEB_PORT` (по умолчанию `3000`) и `WEB_HOST` (по умолчанию `127.0.0.1`) в `src/config/schema.ts` и `.env.example` (если есть)
- [x] 1.3 Добавить npm-скрипты в `package.json`: `web` (`tsx src/index.ts --web`), `web:dev` (concurrently Vite + `--web`), `web:build` (`vite build`)
- [x] 1.4 Создать `vite.config.ts` в корне: `root: src/transport/web/client`, `build.outDir: ../../../dist/client`, плагин `@vitejs/plugin-react`, dev-прокси `/api` → `WEB_PORT`

## 2. Core-слой: чистые доменные функции команд

- [x] 2.1 Создать каталог `src/transport/commands/`; для каждой команды выделить DTO-тип и сигнатуру чистой функции
- [x] 2.2 Рефакторинг `smart-search`: выделить `runSmartSearch(deps: { accountLogin, prompt, fallbackDays?, maxEmails?, deps... }): Promise<SearchResult>` — парсинг промпта (LLM) + `mail.search` без `ConsoleIO`
- [x] 2.3 Рефакторинг `analyze`: выделить `runAnalyze(deps: { accountLogin, uid, folder? }): Promise<{ analysis: string }>` — `mail.fetch` + анализатор (LLM)
- [x] 2.4 Рефакторинг `analyze-many`: выделить `runAnalyzeMany(deps): Promise<{ summaries, commonTheme? }>` — поиск + пакетный анализ
- [x] 2.5 Рефакторинг `analyze-attachments`: выделить `runAnalyzeAttachments(deps): Promise<{ attachmentSummaries }>` — скачивание + извлечение текста + анализ
- [x] 2.6 Рефакторинг `smart-send`: выделить `generateSmartSendBody(deps)` (генерация) и `sendSmartSend(deps)` (отправка подтверждённого тела) — разделить подтверждение
- [x] 2.7 Рефакторинг `add-account`: выделить `saveAccount(deps: { provider, login, password, authStrategy?, envPath }): Promise<{ login, provider }>` — валидация + запись в `.env` + реестр (использует существующую логику записи)
- [x] 2.8 CLI-обработчики (`src/transport/cli/commands/*.ts`) сделать тонкими адаптерами: собирают ввод через `ConsoleIO`, вызывают чистые функции, рендерят результат; сохранить пошаговое поведение REPL
- [x] 2.9 Проверить, что существующие CLI-тесты (`cli-commands-*.test.ts`) проходят после рефакторинга (адаптер обёртывает ту же логику)

## 3. Бэкенд: Node HTTP REST API

- [x] 3.1 Создать `src/transport/web/server.ts`: `runWeb(opts)` — `node:http` сервер, вызов `bootstrap()`, маршрутизация, отдача статики `dist/client/`
- [x] 3.2 Реализовать роутер: маппинг `method + url` → handler; префикс `/api`; 404 на неизвестные `/api/*`; 405 на недопустимые методы; CORS для dev-origin Vite
- [x] 3.3 Создать `src/transport/web/api/dtos.ts` с типизированными интерфейсами DTO для всех эндпоинтов
- [x] 3.4 Реализовать `GET /api/accounts` (список аккаунтов без паролей из реестра bootstrap'а)
- [x] 3.5 Реализовать `POST /api/accounts` (валидация + сохранение через `saveAccount`; ответ `201 { login, provider }` без пароля)
- [x] 3.6 Реализовать `GET /api/folders/:accountLogin` (вызов `mail.listFolders`; подключение через session-store, как CLI `ensureMailConnected`)
- [x] 3.7 Реализовать `POST /api/smart-search` (вызов `runSmartSearch`; возврат `SearchResult`)
- [x] 3.8 Реализовать `GET /api/emails/:accountLogin/:uid` (вызов `mail.fetch`; возврат `EmailFull`) — новое чтение тела письма
- [x] 3.9 Реализовать `POST /api/analyze`, `POST /api/analyze-many`, `POST /api/analyze-attachments` (вызовы чистых функций; возврат отчётов)
- [x] 3.10 Реализовать `POST /api/smart-send/generate` и `POST /api/smart-send/send` (разделённые генерация и отправка для подтверждения)
- [x] 3.11 Реализовать `GET /api/attachments/download/:accountLogin/:uid/:part` (вызов `mail.downloadAttachments`; потоковая выдача файла) — для скачивания вложений
- [x] 3.12 Единая обработка ошибок: `account_not_found` → 404, невалидный DTO → 400, прочие → 500; форма ответа `{ error, code? }`; маскировка секретов (redact)

## 4. Фронтенд: React + Vite SPA (Material-UI)

- [x] 4.1 Создать `src/transport/web/client/index.html` и `main.tsx` (точка входа, рендер `App` в `#root`)
- [x] 4.2 Создать `App.tsx`: `ThemeProviders` (MUI), макет (AppBar + Drawer + основная зона), состояние (выбранный аккаунт, список писем, выбранное письмо)
- [x] 4.3 Компонент `AccountSelector` (дропдаун): загрузка `GET /api/accounts`, выбор аккаунта, подсказка при пустом списке
- [x] 4.4 Компонент `CommandToolbar` (AppBar): кнопки Smart Search, Analyze, Analyze Many, Analyze Attachments, Smart Send, Add Account
- [x] 4.5 Компонент `EmailList` (Drawer/List): тема, отправитель, дата, флаг непрочитанного; выбор письма
- [x] 4.6 Компонент `EmailView` (правая панель): шапка (тема, отправитель, получатели, дата) + тело письма (HTML-санитизация через `DOMPurify` или `dangerouslySetInnerHTML` с фильтром) + список вложений с кнопкой скачивания
- [x] 4.7 Компонент `SmartSearchForm`: поле промпта + кнопка; вызов `POST /api/smart-search`; результат → `EmailList`
- [x] 4.8 Компонент `AnalyzePanel` (правая панель): индикатор прогресса (`CircularProgress`) + читаемый рендер отчёта LLM (заголовки/абзацы/списки через Markdown-рендер или форматирование)
- [x] 4.9 Компонент `SmartSendForm`: поля получатель/тема/промпт; кнопка «Сгенерировать» → тело для редактирования; кнопки «Отправить»/«Отмена»
- [x] 4.10 Компонент `AddAccountForm` (диалог): поля provider/login/password/authStrategy; вызов `POST /api/accounts`
- [x] 4.11 API-клиент `src/transport/web/client/api.ts`: типизированные функции-обёртки над `fetch` для всех эндпоинтов; обработка ошибок (`{ error, code? }`)
- [x] 4.12 HTML-санитизация: добавить `dompurify` (или эквивалент); рендер HTML-писем безопасно (удалены скрипты, внешние ресурсы) в ограниченной области прокрутки

## 5. Интеграция запуска

- [x] 5.1 Расширить `src/index.ts` разбором `--web` флага: при `--web` → `runWeb()` (без REPL); без флага → текущий REPL
- [x] 5.2 `runWeb()`: вызвать `bootstrap()`, поднять HTTP-сервер на `WEB_HOST:WEB_PORT`, логировать URL, обработать graceful-shutdown (cleanup bootstrap'а)
- [x] 5.3 Отдача статики: `GET /` → `dist/client/index.html`; `GET /assets/*` → файлы сборки; 503 при отсутствии сборки с подсказкой `npm run web:build`
- [x] 5.4 Smoke-тест: `npm run web:build` собирает SPA; `npm run web` поднимает сервер и `GET /` отдаёт HTML

## 6. Тесты

- [x] 6.1 Unit-тесты чистых функций команд (`tests/commands-*.test.ts`): вызов с DTO, проверка результата без `ConsoleIO`; переиспользование существующих моков тулов/агентов
- [x] 6.2 Unit-тесты API-обработчиков (`tests/web-api-*.test.ts`): мок `bootstrap`/тулов, проверка HTTP-кода и JSON-ответа; проверка исключения `password` из ответов
- [x] 6.3 Тест: `account_not_found` → 404; невалидный DTO → 400; маскировка секретов в сообщениях ошибок
- [x] 6.4 Тест: CORS-заголовок для dev-origin Vite присутствует в dev-режиме
- [x] 6.5 Проверка: существующие CLI-тесты (`cli-commands-*.test.ts`, `cli-repl*.test.ts`) продолжают проходить после рефакторинга
- [x] 6.6 Smoke-тест сборки SPA: `npm run web:build` завершается успешно, `dist/client/index.html` существует

## 7. Финальные проверки

- [x] 7.1 `npx tsc --noEmit` — без ошибок (включая новые React-типы)
- [x] 7.2 `npx eslint .` — без ошибок (включая новые каталоги `src/transport/web/`, `src/transport/commands/`)
- [x] 7.3 `npx vitest run` — все тесты проходят (включая новые)
- [x] 7.4 `openspec validate --changes` — change `web-interface` валиден
- [ ] 7.5 Ручная проверка: `npm run web:build && npm run web` → браузер `localhost:3000` → выбор аккаунта → smart-search → чтение письма → analyze → отчёт в правой панели
