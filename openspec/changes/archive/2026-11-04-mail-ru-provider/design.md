# Design

## Context

См. `proposal.md` — Why. Текущая архитектура провайдеров: `AbstractImapProvider` (общий lifecycle IMAP-сессии, self-healing через `isConnectionUsable`/`reconnect`, retry-cycle) + два наследника `YandexMailProvider` и `OutlookMailProvider`. Фабрика `createMailProvider(account, opts)` выбирает наследника по `account.provider`. SMTP-параметры — `smtpConnectionFor(kind)` через switch. Валидация аккаунта — `AccountSchema` (zod enum). Mail.ru Group структурно идентичен Яндексу: basic-auth с паролем приложения, IMAP `imap.mail.ru:993` (TLS), SMTP `smtp.mail.ru:465` (TLS), без OAuth2. Самоисцеление соединения и client-side fallback поиска уже реализованы в `AbstractImapProvider` и наследуются бесплатно.

## Goals / Non-Goals

**Goals:**
- Сделать аккаунт `alexandr1508@mail.ru` (`provider: "mail"`) полностью работоспособным: connect, search, fetch, downloadAttachments, send.
- Минимальная площадь изменений: переиспользовать `AbstractImapProvider` (как делает Яндекс), без новой архитектуры.
- Расширить все точки, где `MailProviderKind`/provider-enum захардкожен как `yandex`|`outlook`, до `yandex`|`outlook`|`mail`.

**Non-Goals:**
- OAuth2 для Mail.ru — вне scope (Mail.ru не поддерживает IMAP-OAuth2 для сторонних; используется пароль приложения).
- Автоопределение стратегии (как у Outlook basic→oauth2 fallback) — не нужно, Mail.ru только basic.
- Поддержка доменов вне Mail.ru Group (`@gmail.com` и др.) — вне scope.
- Векторный поиск/embeddings-индексация для `mail` — уже работает через общий путь (не требует изменений под провайдер).

## Decisions

### D1: `MailRuMailProvider extends AbstractImapProvider` — почти копия `YandexMailProvider`

Mail.ru Group по протоколу (IMAP+TLS 993, basic-auth, пароль приложения) неотличим от Яндекса. Создаём `MailRuMailProvider` как минимальный наследник `AbstractImapProvider` с `BasicAuthStrategy`, переопределяя только `connection` (host `imap.mail.ru`, port 993, `secure: true`, `disableAutoIdle: true`, `logger: false`) и `providerKind: 'mail'`.

**Альтернатива**: обобщить `YandexMailProvider` в параметризуемый `BasicImapProvider(host, kind)`. Отклонено — нарушает принцип «один класс = один провайдер», затрудняет будущие провайдер-специфичные нюансы (напр. особенности SEARCH у конкретного сервера), и Яндекс уже зарекомендовал паттерн «минимальный наследник». Дублирование ~20 строк оправдано читаемостью.

### D2: `MailProviderKind` += `'mail'` — расширение типа, а не объединение

Расширяем `type MailProviderKind = 'yandex' | 'outlook' | 'mail'`. Это **BREAKING** для типа на уровне компиляции (все switch/if по `MailProviderKind` должны покрыть новую ветку или стать exhaustive-ошибкой), но обратно-совместимо на уровне данных: существующие аккаунты `yandex`/`outlook` в `.env` работают без изменений. Exhaustive-switch в `smtpConnectionFor` (ветка `default: never`) гарантирует, что компилятор укажет все места, требующие обработки `mail`.

**Альтернатива**: `string` вместо enum. Отклонено — теряется типобезопасность и exhaustive-проверки, которые как раз защищают от «забыл добавить ветку».

### D3: `AccountSchema.provider` (zod) += `'mail'` — валидация на входе

`z.enum(['yandex', 'outlook'])` → `z.enum(['yandex', 'outlook', 'mail'])`. Аккаунт `alexandr1508@mail.ru` с `provider: "mail"` проходит валидацию при загрузке `ACCOUNTS` из `.env`. Без этого `loadConfig` падал бы с ошибкой валидации ещё до старта.

### D4: Фабрика `createMailProvider` — ветка `provider === 'mail'` → `MailRuMailProvider`

Добавляем ветку в `createMailProvider` (после `yandex`, перед `outlook`): `new MailRuMailProvider({ account, clientFactory: opts.clientFactory })`. Аналогично в `createAuthStrategyForAccount` → `new BasicAuthStrategy()` (как для Яндекс). Порядок веток не важен (ранний return по равенству), но `mail` ставим рядом с `yandex` для логической группировки basic-провайдеров.

**Альтернатива**: вынести basic-провайдеры в lookup-таблицу `{ yandex: YandexCfg, mail: MailRuCfg }`. Отклонено — избыточно для 2 провайдеров, switch/if с ранним return читаемее и соответствует существующему стилю.

### D5: `smtpConnectionFor` — `case 'mail': return MAIL_RU_SMTP`

Добавляем `export const MAIL_RU_SMTP: SmtpConnectionOptions = { host: 'smtp.mail.ru', port: 465, secure: true }` и ветку в switch. Ветка `default: never` (exhaustive-проверка) заставит TypeScript указать это место при добавлении `'mail'` в enum — гарантия, что не забудем.

### D6: `mail.connect` тул — `inputSchema.provider.enum` += `'mail'` + рантайм-валидация

`inputSchema.properties.provider.enum` расширяется до `['yandex', 'outlook', 'mail']`, описание упоминает Mail.ru. Рантайм-проверка `if (provider !== 'yandex' && provider !== 'outlook' && provider !== 'mail')` — обновляем. Это дублирование (enum в schema + if в коде) уже существует для `yandex`/`outlook` — сохраняем паттерн ради defence-in-depth (schema для MCP-клиента, if — для прямых вызовов).

### D7: `/add-account` мастер — `provider` принимает `'mail'`

Валидация поля `provider` в `validateAccountField`/подсказках расширена с `yandex|outlook` до `yandex|outlook|mail`. Спека `transport/cli` уже обновлена (delta). Реализация — обновление константы-списка и сообщений.

## Risks / Trade-offs

- **[Mail.ru может требовать разрешения IMAP в настройках ящика]** → Mitigation: пользователь включает IMAP в веб-настройках Mail.ru и получает пароль приложения; ошибка аутентификации возвращается с понятным сообщением (без секрета). Не требует кода — конфигурация ящика на стороне пользователя.
- **[Mail.ru SEARCH по кириллической теме может быть ненадёжен, как у Яндекса]** → Mitigation: client-side fallback (D1 из `mail-search-robustness`) наследуется от `AbstractImapProvider` без изменений — суженный запрос + локальная дофильтровка по `matchesCriteria`.
- **[BREAKING-изменение типа `MailProviderKind`]** → Mitigation: exhaustive-switch в `smtpConnectionFor` выявит все непокрытые ветки на этапе компиляции; тесты фабрики и smtp покрывают новую ветку.
- **[Self-healing может не сработать для Mail.ru так же, как для Яндекса]** → Mitigation: `isConnectionUsable`/`reconnect` реализованы на imapflow `client.usable` — провайдер-агностичны; поведение идентично Яндексу.

## Migration Plan

1. Применить код (D1–D7) + тесты.
2. Перезапустить процесс — `loadConfig` валидирует `ACCOUNTS` с `provider: "mail"` (теперь валидно).
3. Проверить: `mail.connect` с `{ provider: "mail", login: "alexandr1508@mail.ru" }` → успешное IMAP-подключение; `mail.search`/`mail.fetch`/`mail.send` работают.
4. Rollback: удалить ветки `mail` (тип вернётся к `yandex`|`outlook`); аккаунт в `.env` оставить — он просто перестанет валидироваться (как сейчас). Никаких миграций данных не требуется.

## Open Questions

Нет. Mail.ru IMAP/SMTP-параметры (`imap.mail.ru:993`, `smtp.mail.ru:465`, basic-auth, пароль приложения) — стандартные задокументированные настройки Mail.ru Group.
