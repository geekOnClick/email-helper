# Design

## Context

Change `mail-connect` (заархивирован) реализовал `MailProvider`, `AbstractImapProvider`, session store и тулы `mail.connect`/`mail.listFolders`. Провайдеры держат активную IMAP-сессию (`client`) с методами `list()`. imapflow поддерживает `mailboxOpen(path)` (открыть папку), `search(query, {uid})` (UID/seq), `fetchAll(range, query)` (метаданные). Мотивация и охват — см. `proposal.md`. Спека `mail/connection` не меняется — поиск отдельная capability `mail/search`, опирается на активную сессию.

## Goals / Non-Goals

**Goals:**

- Тул `mail.search` + метод `MailProvider.search(criteria)` поверх активной сессии.
- Критерии: тема (subject), отправитель (from), получатель (to), дата (since/before), флаги (unseen/flagged/answered), папка/направление.
- Метаданные `EmailMessage` без тел; `limit` + `hasMore`.
- Переиспользование redact (без секретов в ошибках).

**Non-Goals:**

- Чтение тел/вложений — change `mail-attachments`.
- Семантический поиск через векторы — Фаза 3.
- Отправка — Фаза 4.
- Сложные OR-критерии (imapflow `or`) — пока критерии соединяются через AND (стандарт IMAP SEARCH). Расширение — позже.

## Decisions

### D1. Поиск через imapflow `search` + `fetchAll`
`mailboxOpen(path)` → `search(query, {uid:true})` → `fetchAll(uids, {envelope:true, internalDate:true, flags:true, size:true}, {uid:true})`. UID вместо seq для стабильности при пагинации. SearchObject imapflow maps критерии 1:1.
**Альтернатива:** `fetchAll(range, query)` напрямую — но range 1:* жрёт память на больших ящиках; search сначала выдаёт UID'ы, потом fetch по ним.

### D2. Критерии → SearchObject (AND)
Каждое поле `SearchCriteria` маппится в поле `SearchObject`. Пустые/undefined поля не передаются. IMAP SEARCH по умолчанию AND. Направление (`incoming`/`outgoing`) → выбор папки, не часть query. subject/from/to — substring match (IMAP делает это сервером).

### D3. Папка и направление
`folder` (путь) приоритет. Иначе `direction`: `incoming`→`\Inbox`, `outgoing`→`\Sent`. По умолчанию (без folder и direction) → `incoming`. Путь к \Inbox определяется через `list()` (найти папку с флагом `\Inbox`), т.к. у Яндекс путь «INBOX», но флаг `\Inbox`.

### D4. Limit и hasMore
После search получаем все UID'ы. Берём первые `limit`. `hasMore = uids.length > limit`. `total = uids.length`. Возвращаем `{ messages, total, hasMore }`. Пагинация через `offset` (срез UID'ов) — опционально, добавлю как параметр.
Постраничность через seq/uid range — отложена (для сотен писем достаточно simple offset).

### D5. Метаданные EmailMessage
`{ uid, subject, from, to, date, flags, size, folder }`. `from`/`to` как `{name?, address}`. `date` (internalDate). `flags` массив строк. Без `body`. 

### D6. Расширение ImapClient-мока
Добавить в интерфейс `ImapClient` методы `mailboxOpen(path, opts?)` и `search(query, opts?)` и `fetchAll(range, query, opts?)`. Реальный ImapFlow уже имеет их; мок в тестах реализует.

### D7. redact в ошибках
Ошибка поиска оборачивается через redact (как в connect) — пароль и логин не фигурируют. Переиспользуется `redact` из `src/tools/mail/redact.ts`.

### D8. Типы в src/types/email.ts
Вынести `EmailMessage`, `SearchCriteria`, `SearchResult` в `src/types/email.ts` (в proposal упомянут `src/types/` — в проекте уже есть `src/types/index.ts` заглушка). Будет `src/types/email.ts` с реэкспортом из `src/types/index.ts`.

## Risks / Trade-offs

- **[Риск: большой ящик] search возвращает много UID'ов → память.** → Mitigation: limit по умолчанию 50; hasMore сигнализирует о наличии ещё. Для очень больших — будущая пагинация по seq-range.
- **[Риск: серверы по-разному матчят substring] Яндекс/Outlook могут не учитывать регистр или поддерживать только префикс.** → Mitigation: спека требует substring без учёта регистра; если сервер не поддерживает — документировать и тестировать реально.
- **[Трейд-офф: by UID vs seq] UID стабильнее, но некоторые операции требуют seq.] → Используем UID для search+fetch, что стандартно.
- **[Риск: поиск по теме может вернуть тело в fetch] fetchAll с envelope=true не тянет body, только метаданные.] → Cover тестом (assert нет body).

## Migration Plan

Greenfield-код поверх `mail-connect`. Развёртывание:
1. (imapflow уже установлен) — без новых зависимостей.
2. `src/types/email.ts` + расширение `MailProvider`/`AbstractImapProvider`/`ImapClient`.
3. `src/tools/mail/mail-search.tool.ts`, регистрация.
4. Юнит-тесты (мок) + gated-интеграция.
5. `npm test`, `tsc`, `lint`, `openspec validate`.

Откат: удалить `mail-search.tool.ts`, откатить расширение `MailProvider.search` (убрать метод, не ломает существующее).

## Open Questions

- Нет деферрабельных вопросов: imapflow API известен, критерии из спеки ясны.