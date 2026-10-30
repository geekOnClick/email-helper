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
 * Фабрика stub-клиента: server-side search возвращает [] (имитация ненадёжного
 * SEARCH Яндекса), fetchAll('1:*') возвращает все сообщения для fallback.
 */
function makeFactory(opts: { searchResult?: number[]; messages?: typeof MESSAGES }): ImapClientFactory {
  const messages = opts.messages ?? MESSAGES;
  return () =>
    ({
      connect: vi.fn().mockResolvedValue(undefined),
      list: vi.fn().mockResolvedValue([INBOX]),
      mailboxOpen: vi.fn().mockResolvedValue(undefined),
      // server-side SEARCH всегда возвращает пусто (имитация бага Яндекса)
      search: vi.fn().mockResolvedValue(opts.searchResult ?? []),
      // fetchAll возвращает сообщения по UID-диапазону
      fetchAll: vi.fn().mockImplementation((range: string) => {
        // для '1:*' возвращаем все; для конкретного UID — фильтр
        if (range === '1:*') return Promise.resolve(messages);
        const uids = range.split(',').map((n) => Number(n));
        const filtered = messages.filter((m) => uids.includes(m.uid));
        return Promise.resolve(filtered);
      }),
      logout: vi.fn().mockResolvedValue(undefined),
    }) as never;
}

describe('AbstractImapProvider: client-side fallback search', () => {
  let factory: ImapClientFactory;

  beforeEach(() => {
    factory = makeFactory({});
  });

  it('серверный search вернул 0 → fallback находит по subject (кириллица)', async () => {
    const provider = new YandexMailProvider({ account, clientFactory: factory });
    await provider.connect();
    const result = await provider.search({ subject: 'Нормоконтроль' } as SearchCriteria);
    expect(result.total).toBe(1);
    expect(result.messages[0]?.uid).toBe(2);
    expect(result.messages[0]?.subject).toBe('Нормоконтроль  ВКР Козлов А.В.');
  });

  it('fallback находит по подстроке subject', async () => {
    const provider = new YandexMailProvider({ account, clientFactory: factory });
    await provider.connect();
    const result = await provider.search({ subject: 'ВКР' } as SearchCriteria);
    expect(result.total).toBe(1);
    expect(result.messages[0]?.uid).toBe(2);
  });

  it('fallback находит по from (email)', async () => {
    const provider = new YandexMailProvider({ account, clientFactory: factory });
    await provider.connect();
    const result = await provider.search({ from: 'Kozloww1508@yandex.ru' } as SearchCriteria);
    expect(result.total).toBe(1);
    expect(result.messages[0]?.uid).toBe(2);
  });

  it('fallback находит по from (имя)', async () => {
    const provider = new YandexMailProvider({ account, clientFactory: factory });
    await provider.connect();
    const result = await provider.search({ from: 'Козлов' } as SearchCriteria);
    expect(result.total).toBe(1);
    expect(result.messages[0]?.uid).toBe(2);
  });

  it('fallback находит по to', async () => {
    const provider = new YandexMailProvider({ account, clientFactory: factory });
    await provider.connect();
    const result = await provider.search({ to: 'test@yandex.com' } as SearchCriteria);
    expect(result.total).toBe(2);
  });

  it('серверный search нашёл → fallback НЕ вызывается', async () => {
    // Если сервер вернул UID, fallback не нужен.
    const f = makeFactory({ searchResult: [2] });
    const provider = new YandexMailProvider({ account, clientFactory: f });
    await provider.connect();
    const result = await provider.search({ subject: 'Нормоконтроль' } as SearchCriteria);
    expect(result.total).toBe(1);
    expect(result.messages[0]?.uid).toBe(2);
  });

  it('без текстовых критериев → fallback НЕ вызывается', async () => {
    const f = makeFactory({ searchResult: [] });
    const provider = new YandexMailProvider({ account, clientFactory: f });
    await provider.connect();
    // только unseen — нет текстовых критериев, fallback не нужен
    const result = await provider.search({ unseen: true } as SearchCriteria);
    expect(result.total).toBe(0);
    expect(result.messages).toEqual([]);
  });

  it('нет совпадений → пустой результат', async () => {
    const provider = new YandexMailProvider({ account, clientFactory: factory });
    await provider.connect();
    const result = await provider.search({ subject: 'несуществующая тема' } as SearchCriteria);
    expect(result.total).toBe(0);
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

  it('subject + before → отсеивает будущие письма', async () => {
    const provider = new YandexMailProvider({ account, clientFactory: factory });
    await provider.connect();
    const result = await provider.search({
      to: 'test@yandex.com',
      before: '2026-10-02',
    } as SearchCriteria);
    expect(result.total).toBe(1);
    expect(result.messages[0]?.uid).toBe(1);
  });
});
