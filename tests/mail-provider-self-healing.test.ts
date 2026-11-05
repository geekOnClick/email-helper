import { describe, it, expect, vi, beforeEach } from 'vitest';
import { YandexMailProvider } from '../src/tools/mail/providers/yandex.js';
import type { ImapClientFactory } from '../src/tools/mail/providers/abstract-imap-provider.js';
import { ConnectError } from '../src/tools/mail/providers/abstract-imap-provider.js';
import type { MailAccount } from '../src/tools/mail/types.js';

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

interface StubClient {
  usable: boolean;
  connect: ReturnType<typeof vi.fn>;
  list: ReturnType<typeof vi.fn>;
  mailboxOpen: ReturnType<typeof vi.fn>;
  search: ReturnType<typeof vi.fn>;
  fetchAll: ReturnType<typeof vi.fn>;
  downloadMany: ReturnType<typeof vi.fn>;
  logout: ReturnType<typeof vi.fn>;
}

/** Фабрика, отдающая ссылку на stub-клиент (с `usable`) для инспекции в тестах. */
function makeFactory(stub: Partial<StubClient> = {}): {
  factory: ImapClientFactory;
  client: StubClient;
} {
  const client: StubClient = {
    usable: stub.usable ?? true,
    connect: stub.connect ?? vi.fn().mockResolvedValue(undefined),
    list: stub.list ?? vi.fn().mockResolvedValue([INBOX]),
    mailboxOpen: stub.mailboxOpen ?? vi.fn().mockResolvedValue(undefined),
    search: stub.search ?? vi.fn().mockResolvedValue([]),
    fetchAll: stub.fetchAll ?? vi.fn().mockResolvedValue([]),
    downloadMany: stub.downloadMany ?? vi.fn().mockResolvedValue({}),
    logout: stub.logout ?? vi.fn().mockResolvedValue(undefined),
  };
  const factory: ImapClientFactory = () => client as never;
  return { factory, client };
}

describe('AbstractImapProvider: проверка живости и прозрачное переподключение (mail-connection-self-healing)', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  describe('isConnectionUsable()', () => {
    it('true при активном пригодном client', async () => {
      const { factory } = makeFactory({ usable: true });
      const p = new YandexMailProvider({ account, clientFactory: factory });
      await p.connect();
      expect(p.isConnectionUsable()).toBe(true);
    });

    it('false при client.usable === false (сервер закрыл соединение)', async () => {
      const { factory, client } = makeFactory({ usable: true });
      const p = new YandexMailProvider({ account, clientFactory: factory });
      await p.connect();
      // Имитируем разрыв: imapflow выставил usable=false.
      client.usable = false;
      expect(p.isConnectionUsable()).toBe(false);
    });

    it('false при client === null (после неудачного/невыполненного reconnect)', async () => {
      const { factory } = makeFactory({ usable: true });
      const p = new YandexMailProvider({ account, clientFactory: factory });
      // До connect() client === null.
      expect(p.isConnectionUsable()).toBe(false);
    });
  });

  describe('reconnect() — публичный', () => {
    it('закрывает старый client (logout) и открывает новый; isConnectionUsable становится true', async () => {
      const { factory, client } = makeFactory({ usable: false });
      const p = new YandexMailProvider({ account, clientFactory: factory });
      // Имитируем, что connect уже был (но usable=false — соединение разорвано).
      // Подключаем вручную, затем «роняем» usable.
      await p.connect();
      client.usable = false;
      expect(p.isConnectionUsable()).toBe(false);

      // reconnect: logout старого + новый tryConnect. Фабрика отдаёт тот же client,
      // но tryConnect вызовет client.connect() и после него usable должен стать true.
      client.connect.mockResolvedValue(undefined);
      await p.reconnect();

      expect(client.logout).toHaveBeenCalled(); // старый client закрыт
      expect(client.connect).toHaveBeenCalled(); // новый tryConnect
      // После reconnect usable снова true (factory отдаёт тот же stub с usable=true
      // после переподключения — имитируем успешный connect).
      client.usable = true;
      expect(p.isConnectionUsable()).toBe(true);
    });

    it('сохраняет учётные данные аккаунта (this.account не меняется)', async () => {
      const { factory } = makeFactory({ usable: true });
      const p = new YandexMailProvider({ account, clientFactory: factory });
      await p.connect();
      await p.reconnect();
      // После reconnect аккаунт доступен и идентичен исходному.
      // Проверяем косвенно: connect после reconnect не падает с «провайдер закрыт».
      const res = await p.connect();
      expect(res).toEqual({ connected: true, accountId: account.login, provider: 'yandex' });
    });
  });

  describe('retry для «подключение не установлено» (design D4)', () => {
    it('requireClient бросает «подключение не установлено» → retry с reconnect, успех на повторе', async () => {
      // Сценарий: первичная search падает с «подключение не установлено» (client=null),
      // retry тратит попытку на reconnect и повторяет → успех.
      const { factory, client } = makeFactory({ usable: true });
      const p = new YandexMailProvider({ account, clientFactory: factory });
      await p.connect();

      // Первая попытка search: имитируем client=null → requireClient бросает
      // ConnectError('подключение не установлено ...').
      // Реализуем через mock, который первый раз бросает ConnectError, второй — возвращает.
      const connErr = new ConnectError(
        `подключение не установлено для ${account.login} (yandex)`,
      );
      // search возвращает UIDs; mailboxOpen/list тоже нужны.
      client.list.mockResolvedValue([INBOX]);
      client.mailboxOpen.mockResolvedValue(undefined);
      let searchCalls = 0;
      client.search.mockImplementation(async () => {
        searchCalls++;
        if (searchCalls === 1) throw connErr;
        return [1, 2, 3];
      });
      client.fetchAll.mockResolvedValue([]);

      const result = await p.search(
        { folder: 'INBOX', limit: 50 },
        { maxRetries: 1, timeoutMs: 5000, fallbackDays: 180 },
      );
      // Retry сработал: search вызван дважды (первичный + повтор после reconnect).
      expect(searchCalls).toBe(2);
      expect(result.messages).toEqual([]);
      // reconnect вызвал logout старого client.
      expect(client.logout).toHaveBeenCalled();
    });
  });
});
