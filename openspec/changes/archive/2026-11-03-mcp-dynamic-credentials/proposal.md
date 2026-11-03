# Proposal: mcp-dynamic-credentials

## Why

При подключении к MCP-серверу внешние агенты (pi, Claude Desktop и др.) работают со своими собственными почтовыми ящиками, но сейчас тулы могут использовать только аккаунты, заранее прописанные в `.env` сервера. Это делает MCP-сервер непригодным для multi-tenant использования: внешний агент не может подключиться к своему ящику, не имея доступа к `.env` процесса сервера. Нужна возможность передавать учётные данные (провайдер + пароль) в момент вызова тулa `mail.connect`.

## What Changes

- Тул `mail.connect` принимает опциональный блок `credentials` с полями `provider` (`yandex`|`outlook`), `password`, `authStrategy` (`basic`|`oauth2`, по умолчанию `basic`).
- Если `credentials` переданы — система создаёт временный `MailAccount` из переданных данных и `login`, и подключается с ними (вместо поиска в `.env`).
- Если `credentials` опущены — сохраняется текущее поведение: аккаунт ищется в `.env` (`ACCOUNTS`) по `login`.
- Сессия, открытая с динамическими кредами, сохраняется в `MailSessionStore` по `login` и доступна всем последующим тулам (`mail.search`, `mail.fetch`, `mail.downloadAttachments`, `mail.send`, `embeddings.index`) без изменений — они работают по `login`, как раньше.
- Динамические креды (пароли) SHALL NOT логироваться и SHALL NOT попадать в сообщения об ошибках; применяется существующая маскировка через `redact()`.
- `mail.send` при использовании динамического аккаунта берёт учётные данные SMTP из сохранённой в `MailSessionStore` сессии (через `getAccount(login)`) — как и сейчас.
- JSON-схема `inputSchema` тулa `mail.connect` обновляется — обновление автоматически отражается в MCP `tools/list`.
- **Не затрагивается**: OAuth2 device code flow для Outlook остаётся интерактивным (вывод URL + user code); для headless MCP-вызовов рекомендуется `basic` стратегия. OAuth2-конфиг (`MS_CLIENT_ID`, `MS_TENANT`) берётся из `.env` сервера — это инфраструктурная настройка.

## Capabilities

### Modified Capabilities

- **`mail/connection`** — тул `mail.connect` расширяется поддержкой опционального блока `credentials` для подключения с кредами, переданными вызывающим агентом, с fallback на `.env` при их отсутствии. Добавляется требование о безопасности динамических кред (не логировать).

## Impact

- **Код**: `src/tools/mail/mail-connect.tool.ts` (расширение `inputSchema` + логика создания временного `MailAccount`), `src/tools/mail/types.ts` (тип `MailConnectArgs`), `src/tools/mail/register-tools.ts` (без изменений в сигнатуре — `accounts` остаётся как fallback).
- **Тесты**: новые unit-тесты для `mail.connect` с динамическими кредами (переданы → используется временный аккаунт; опущены → fallback на `.env`), интеграционный тест через MCP `tools/call`.
- **MCP**: автоматически — обновлённая JSON-схема `mail.connect` экспонируется клиентам через `tools/list`; внешние агенты видят новое поле `credentials`.
- **Безопасность**: пароли из `credentials` добавляются в список секретов для маскирования в observability (`redact()`), не пишутся на диск (только в памяти `MailSessionStore`).
- **Обратная совместимость**:现有的 вызовы `mail.connect` с только `login` работают без изменений (fallback на `.env`).
