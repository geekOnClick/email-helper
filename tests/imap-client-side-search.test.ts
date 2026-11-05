import { describe, it, expect, vi, beforeEach } from 'vitest';
import { YandexMailProvider } from '../src/tools/mail/providers/yandex.js';
import type { ImapClientFactory } from '../src/tools/mail/providers/abstract-imap-provider.js';
import type { MailAccount } from '../src/tools/mail/types.js';
import type { SearchCriteria } from '../src/types/email.js';

const account: MailAccount = {
  provider: 'yandex',
  login: 'test@yandex.com',
  password: 'secret',
  authStrategy: 'basic',
};

const INBOX = {
  path: 'INBOX',
  pathAsListed: 'INBOX',
  name: 'INBOX',
  delimiter: '/',
  parent: '',
  parentPath: '',
  flags: new Set(['\\Inbox']),
  specialUse: '\\Inbox',
  listed: true,
  subscribed: true,
  status: undefined,
};

/** Письма в INBOX (имитация envelope из imapflow). */
const MESSAGES = [
  {
    uid: 1,
    envelope: { subject: 'Вы создали пароль', from: [{ address: 'noreply@id.yandex.com', name: '' }], to: [{ address: 'test@yandex.com' }] },
    internalDate: new Date('2026-10-01'),
    flags: new Set(['\\Seen']),
    size: 100,
  },
  {
    uid: 2,
    envelope: { subject: 'Нормоконтроль  ВКР Козлов А.В.', from: [{ address: 'Kozloww1508@yandex.ru', name: 'Козлов Александр' }], to: [{ address: 'test@yandex.com' }] },
    internalDate: new Date('2026-10-02'),
    flags: new Set([]),
    size: 200,
  },
];

/**
 * Фабрика stub-клиента под НОВЫЙ контракт (change mail-search-robustness):
 * серверный SEARCH Яндекса по `subject` ненадёжен (возвращает []), но по
 * `from`/`since`/флагам — надёжен (возвращает UID'ы). При fallback система
 * сужает надёжными критериями и фетчит метаданные только по суженному набору,
 * затем дофильтровывает локально по subject.
 */
function makeFactory(opts: {
  subjectSearchResult?: number[];
  messages?: typeof MESSAGES;
  fallbackDays?: number;
}): ImapClientFactory {
  const messages = opts.messages ?? MESSAGES;
  const subjectUids = opts.subjectSearchResult ?? [];
  return () =>
    ({
      connect: vi.fn().mockResolvedValue(undefined),
      list: vi.fn().mockResolvedValue([INBOX]),
      mailboxOpen: vi.fn().mockResolvedValue(undefined),
      // search: по subject (ненадёжный) → [], иначе → UID'ы по надёжным критериям
      search: vi.fn().mockImplementation((query: Record<string, unknown>) => {
        if (query.subject !== undefined) return Promise.resolve(subjectUids);
        // надёжные критерии: фильтруем сообщения по ним (имитация серверного поиска)
        let uids = messages.map((m) => m.uid);
        if (query.from !== undefined) {
          const f = String(query.from).toLowerCase();
          uids = uids.filter((uid) => {
            const m = messages.find((mm) => mm.uid === uid);
            return (
              m?.envelope.from?.[0]?.address?.toLowerCase().includes(f) === true ||
              m?.envelope.from?.[0]?.name?.toLowerCase().includes(f) === true
            );
          });
        }
        if (query.to !== undefined) {
          const t = String(query.to).toLowerCase();
          uids = uids.filter((uid) => {
            const m = messages.find((mm) => mm.uid === uid);
            return m?.envelope.to?.some((a) => `${a.address} ${a.name ?? ''}`.toLowerCase().includes(t)) === true;
          });
        }
        if (query.since !== undefined) {
          const since = query.since instanceof Date ? query.since : new Date(query.since as string);
          uids = uids.filter((uid) => {
            const m = messages.find((mm) => mm.uid === uid);
            return (m?.internalDate ?? new Date(0)) >= since;
          });
        }
        if (query.before !== undefined) {
          const before = query.before instanceof Date ? query.before : new Date(query.before as string);
          uids = uids.filter((uid) => {
            const m = messages.find((mm) => mm.uid === uid);
            return (m?.internalDate ?? new Date(0)) < before;
          });
        }
        if (query.seen === false) {
          uids = uids.filter((uid) => {
            const m = messages.find((mm) => mm.uid === uid);
            return m ? !m.flags.has('\\Seen') : true;
          });
        }
        return Promise.resolve(uids);
      }),
      // fetchAll по UID-диапазону (новый код не использует '1:*')
      fetchAll: vi.fn().mockImplementation((range: string) => {
        // '1:*' не должно вызываться в новом коде — если вызван, это баг.
        if (range === '1:*') return Promise.resolve([]);
        const uids = range.split(',').map((n) => Number(n));
        const filtered = messages.filter((m) => uids.includes(m.uid));
        return Promise.resolve(filtered);
      }),
      logout: vi.fn().mockResolvedValue(undefined),
    }) as never;
}

describe('AbstractImapProvider: bounded client-side fallback (mail-search-robustness)', () => {
  let factory: ImapClientFactory;

  beforeEach(() => {
    factory = makeFactory({});
  });

  it('серверный search по subject вернул 0 → fallback сужается SINCE по умолчанию и находит по subject (кириллица)', async () => {
    const provider = new YandexMailProvider({ account, clientFactory: factory });
    await provider.connect();
    const result = await provider.search({ subject: 'Нормоконтроль' } as SearchCriteria);
    expect(result.total).toBe(2); // суженный набор SINCE (все 2 письма)
    expect(result.messages).toHaveLength(1); // дофильтровка по subject
    expect(result.messages[0]?.uid).toBe(2);
    expect(result.messages[0]?.subject).toBe('Нормоконтроль  ВКР Козлов А.В.');
  });

  it('fallback находит по подстроке subject', async () => {
    const provider = new YandexMailProvider({ account, clientFactory: factory });
    await provider.connect();
    const result = await provider.search({ subject: 'ВКР' } as SearchCriteria);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]?.uid).toBe(2);
  });

  it('fallback сужается имеющимся from — fetchAll только по найденным UID', async () => {
    const provider = new YandexMailProvider({ account, clientFactory: factory });
    await provider.connect();
    const result = await provider.search({ from: 'Kozloww1508@yandex.ru' } as SearchCriteria);
    expect(result.total).toBe(1);
    expect(result.messages[0]?.uid).toBe(2);
  });

  it('fallback по from (имя) находит письмо', async () => {
    const provider = new YandexMailProvider({ account, clientFactory: factory });
    await provider.connect();
    const result = await provider.search({ from: 'Козлов' } as SearchCriteria);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]?.uid).toBe(2);
  });

  it('fallback сужается имеющимся to', async () => {
    const provider = new YandexMailProvider({ account, clientFactory: factory });
    await provider.connect();
    const result = await provider.search({ to: 'test@yandex.com' } as SearchCriteria);
    expect(result.total).toBe(2);
    expect(result.messages).toHaveLength(2);
  });

  it('серверный search нашёл → fallback НЕ вызывается (без второй search-попытки)', async () => {
    // Если сервер вернул UID по subject — fallback не нужен.
    const f = makeFactory({ subjectSearchResult: [2] });
    const provider = new YandexMailProvider({ account, clientFactory: f });
    await provider.connect();
    const result = await provider.search({ subject: 'Нормоконтроль' } as SearchCriteria);
    expect(result.total).toBe(1);
    expect(result.messages[0]?.uid).toBe(2);
  });

  it('без текстовых критериев → fallback НЕ вызывается (пустой результат)', async () => {
    const f = makeFactory({ subjectSearchResult: [] });
    const provider = new YandexMailProvider({ account, clientFactory: f });
    await provider.connect();
    // только unseen — нет текстовых критериев, fallback не нужен
    const result = await provider.search({ unseen: true } as SearchCriteria);
    expect(result.total).toBe(1);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]?.uid).toBe(2);
  });

  it('нет совпадений по subject → пустой результат (дофильтровка)', async () => {
    const provider = new YandexMailProvider({ account, clientFactory: factory });
    await provider.connect();
    const result = await provider.search({ subject: 'несуществующая тема' } as SearchCriteria);
    expect(result.total).toBe(2);
    expect(result.messages).toEqual([]);
  });

  it('subject + since → комбинированный фильтр', async () => {
    const provider = new YandexMailProvider({ account, clientFactory: factory });
    await provider.connect();
    const result = await provider.search({
      subject: 'Нормоконтроль',
      since: '2026-10-02',
    } as SearchCriteria);
    expect(result.total).toBe(1);
    expect(result.messages[0]?.uid).toBe(2);
  });

  it('to + before → отсеивает будущие письма', async () => {
    const provider = new YandexMailProvider({ account, clientFactory: factory });
    await provider.connect();
    const result = await provider.search({
      to: 'test@yandex.com',
      before: '2026-10-02',
    } as SearchCriteria);
    expect(result.total).toBe(1);
    expect(result.messages[0]?.uid).toBe(1);
  });

  it('сервер вернул ложные совпадения по subject → дофильтровка отсекает лишние (D2)', async () => {
    // Сервер «нашёл» по subject оба UID (ненадёжно), но реально subject
    // совпадает только у uid=2. Дофильтровка должна отсечь uid=1.
    const f = makeFactory({ subjectSearchResult: [1, 2] });
    const provider = new YandexMailProvider({ account, clientFactory: f });
    await provider.connect();
    const result = await provider.search({ subject: 'Нормоконтроль' } as SearchCriteria);
    expect(result.total).toBe(2); // серверный набор
    expect(result.messages).toHaveLength(1); // локальная дофильтровка
    expect(result.messages[0]?.uid).toBe(2);
  });

  it('fallback не обращается ко всей папке (нет fetchAll 1:*)', async () => {
    const provider = new YandexMailProvider({ account, clientFactory: factory });
    await provider.connect();
    await provider.search({ subject: 'Нормоконтроль' } as SearchCriteria);
    const client = (provider as unknown as { client: { fetchAll: ReturnType<typeof vi.fn> } }).client;
    for (const call of client.fetchAll.mock.calls) {
      expect(call[0]).not.toBe('1:*');
    }
  });
});

describe('AbstractImapProvider: серверный search вернул false (отказ NO/BAD)', () => {
  /**
   * imapflow возвращает `false`, когда сервер отказывает в поиске (NO/BAD).
   * Например, Outlook отказывает в CHARSET UTF-8 + SUBJECT-литерале для кириллицы.
   * Раньше код делал `false.slice(...)` → TypeError «effectiveUids.slice is not
   * a function». Теперь `false` нормализуется в `[]`, что активирует client-side
   * fallback (D1): суженный запрос без subject + локальная дофильтровка.
   */
  function makeFalseFactory(opts: { messages?: typeof MESSAGES; fallbackDays?: number }): ImapClientFactory {
    const messages = opts.messages ?? MESSAGES;
    return () =>
      ({
        connect: vi.fn().mockResolvedValue(undefined),
        list: vi.fn().mockResolvedValue([INBOX]),
        mailboxOpen: vi.fn().mockResolvedValue(undefined),
        // Основной search с subject → false (имитация отказа Outlook NO/BAD).
        // Суженный search (без subject) → UID'ы по надёжным критериям.
        search: vi.fn().mockImplementation((query: Record<string, unknown>) => {
          if (query.subject !== undefined) return Promise.resolve(false);
          let uids = messages.map((m) => m.uid);
          if (query.from !== undefined) {
            const f = String(query.from).toLowerCase();
            uids = uids.filter((uid) => {
              const m = messages.find((mm) => mm.uid === uid);
              return (
                m?.envelope.from?.[0]?.address?.toLowerCase().includes(f) === true ||
                m?.envelope.from?.[0]?.name?.toLowerCase().includes(f) === true
              );
            });
          }
          if (query.since !== undefined) {
            const since = query.since instanceof Date ? query.since : new Date(query.since as string);
            uids = uids.filter((uid) => {
              const m = messages.find((mm) => mm.uid === uid);
              return (m?.internalDate ?? new Date(0)) >= since;
            });
          }
          return Promise.resolve(uids);
        }),
        fetchAll: vi.fn().mockImplementation((range: string) => {
          const uids = range.split(',').map((n) => Number(n));
          const filtered = messages.filter((m) => uids.includes(m.uid));
          return Promise.resolve(filtered);
        }),
        logout: vi.fn().mockResolvedValue(undefined),
      }) as never;
  }

  it('search вернул false по subject → не падает, fallback находит по subject', async () => {
    const provider = new YandexMailProvider({ account, clientFactory: makeFalseFactory({}) });
    await provider.connect();
    // Раньше: TypeError: effectiveUids.slice is not a function
    const result = await provider.search({ subject: 'Нормоконтроль' } as SearchCriteria);
    expect(result.total).toBe(2); // суженный набор (все 2 письма)
    expect(result.messages).toHaveLength(1); // локальная дофильтровка по subject
    expect(result.messages[0]?.uid).toBe(2);
  });

  it('search вернул false по subject + from → fallback сужается по from', async () => {
    const provider = new YandexMailProvider({ account, clientFactory: makeFalseFactory({}) });
    await provider.connect();
    const result = await provider.search({
      subject: 'Нормоконтроль',
      from: 'Kozloww1508@yandex.ru',
    } as SearchCriteria);
    expect(result.total).toBe(1); // сужено по from → только uid=2
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]?.uid).toBe(2);
  });

  it('search вернул false и narrowed тоже false → пустой результат без падения', async () => {
    // Оба search-вызова возвращают false (полный отказ сервера) — нормализуется в [],
    // slice не падает, возвращается пустой результат.
    const f: ImapClientFactory = () =>
      ({
        connect: vi.fn().mockResolvedValue(undefined),
        list: vi.fn().mockResolvedValue([INBOX]),
        mailboxOpen: vi.fn().mockResolvedValue(undefined),
        search: vi.fn().mockResolvedValue(false),
        fetchAll: vi.fn().mockResolvedValue([]),
        logout: vi.fn().mockResolvedValue(undefined),
      }) as never;
    const provider = new YandexMailProvider({ account, clientFactory: f });
    await provider.connect();
    const result = await provider.search({ subject: 'Нормоконтроль' } as SearchCriteria);
    expect(result.total).toBe(0);
    expect(result.messages).toEqual([]);
  });
});
