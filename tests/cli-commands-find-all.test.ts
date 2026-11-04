import { describe, it, expect, beforeEach } from 'vitest';
import { resetTools, registerTool } from '../src/tools/registry.js';
import { getSharedSessionStore } from '../src/tools/mail/register-tools.js';
import { runFindAllCommand } from '../src/transport/cli/commands/find-all.js';
import { MockConsoleIO } from './mock-io.js';
import type { MailAccount } from '../src/tools/mail/types.js';
import type { MailProvider } from '../src/tools/mail/mail-provider.js';
import type { SearchResult, EmailMessage } from '../src/types/email.js';

const ACCOUNT: MailAccount = {
  provider: 'yandex',
  login: 'test@yandex.com',
  password: 'stub',
  authStrategy: 'basic',
};

/** Pre-seed IMAP-сессии (подключение не вызывается). */
function seedSession(account: MailAccount = ACCOUNT): void {
  getSharedSessionStore().set(account, {
    connect: async () => ({ ok: true, login: account.login }),
    listFolders: async () => [],
    search: async () => ({ messages: [], total: 0, hasMore: false }),
    fetch: async () => ({}),
    downloadAttachments: async () => ({ paths: [], folder: 'INBOX', uid: 0 }),
    dispose: async () => {},
  } as unknown as MailProvider);
}

/** Строит EmailMessage с датой/темой/отправителем. */
function msg(uid: number, iso: string, subject = 's', fromAddr = 'a@b.com'): EmailMessage {
  const [y, m, d] = iso.split('-').map(Number);
  return {
    uid,
    subject,
    from: { address: fromAddr },
    to: [{ address: 'me@t.com' }],
    date: new Date(y, m - 1, d),
    flags: [],
    folder: 'INBOX',
  };
}

/** Строит stub mail.search, возвращающий страницы. */
function searchToolReturning(pages: { messages: EmailMessage[]; total: number; hasMore: boolean }[]) {
  let call = 0;
  registerTool({
    name: 'mail.search',
    description: 'stub',
    inputSchema: { type: 'object' },
    handler: async () => {
      const page = pages[Math.min(call, pages.length - 1)];
      call++;
      return page as SearchResult;
    },
  });
}

describe('runFindAllCommand', () => {
  beforeEach(() => {
    resetTools();
    seedSession();
  });

  it('3 письма → таблица с датой/темой/отправителем', async () => {
    searchToolReturning([
      {
        messages: [
          msg(1, '2024-03-01', 'Уроки истории', 'teacher@school.ru'),
          msg(2, '2024-03-15', 'Re: Уроки истории', 'ivan@yandex.ru'),
          msg(3, '2024-04-02', 'Уроки истории 2', 'teacher@school.ru'),
        ],
        total: 3,
        hasMore: false,
      },
    ]);
    const io = new MockConsoleIO(['тема - уроки истории', '']);
    await runFindAllCommand({ io, accounts: [ACCOUNT] });
    const out = io.output();
    expect(out).toContain('Найдено писем: 3');
    // заголовки таблицы
    expect(out).toContain('Дата письма');
    expect(out).toContain('Тема письма');
    expect(out).toContain('Отправитель');
    // данные строк
    expect(out).toContain('2024-03-01');
    expect(out).toContain('Уроки истории');
    expect(out).toContain('teacher@school.ru');
    expect(out).toContain('Re: Уроки истории');
    expect(out).toContain('ivan@yandex.ru');
    expect(out).not.toContain('найдено ещё');
  });

  it('>10 писем → 10 строк таблицы + «найдено ещё N»', async () => {
    const messages = Array.from({ length: 15 }, (_, i) => msg(i + 1, `2024-03-${String(i + 1).padStart(2, '0')}`, `договор ${i + 1}`));
    searchToolReturning([{ messages, total: 15, hasMore: false }]);
    const io = new MockConsoleIO(['тема - договор', '']);
    await runFindAllCommand({ io, accounts: [ACCOUNT] });
    const out = io.output();
    expect(out).toContain('Найдено писем: 15');
    expect(out).toContain('найдено ещё 5 писем');
    expect(out).toContain('договор 1');
    expect(out).toContain('договор 10');
  });

  it('ничего не найдено', async () => {
    searchToolReturning([{ messages: [], total: 0, hasMore: false }]);
    const io = new MockConsoleIO(['тема - несуществующее', '']);
    await runFindAllCommand({ io, accounts: [ACCOUNT] });
    expect(io.output()).toContain('Ничего не найдено');
  });

  it('отмена мастера (пустой ввод сразу)', async () => {
    searchToolReturning([{ messages: [], total: 0, hasMore: false }]);
    const io = new MockConsoleIO(['']);
    await runFindAllCommand({ io, accounts: [ACCOUNT] });
    expect(io.output()).toContain('Поиск отменён');
  });

  it('нет аккаунтов → сообщение', async () => {
    searchToolReturning([{ messages: [], total: 0, hasMore: false }]);
    const io = new MockConsoleIO(['тема - договор', '']);
    await runFindAllCommand({ io, accounts: [] });
    expect(io.output()).toContain('Нет настроенных');
  });

  it('тул mail.search не зарегистрирован', async () => {
    // не регистрируем mail.search
    const io = new MockConsoleIO(['тема - договор', '']);
    await runFindAllCommand({ io, accounts: [ACCOUNT] });
    expect(io.output()).toContain('не зарегистрирован');
  });

  it('ошибка тулa → сообщение', async () => {
    registerTool({
      name: 'mail.search',
      description: 'stub',
      inputSchema: { type: 'object' },
      handler: async () => {
        throw new Error('IMAP timeout');
      },
    });
    const io = new MockConsoleIO(['тема - договор', '']);
    await runFindAllCommand({ io, accounts: [ACCOUNT] });
    expect(io.output()).toContain('Ошибка поиска');
    expect(io.output()).toContain('IMAP timeout');
  });

  it('truncated → предупреждение о лимите пагинации', async () => {
    // Каждая страница полная (50) и hasMore true — упрётся в maxPages=200.
    const fullPage = Array.from({ length: 50 }, (_, i) => msg(i + 1, '2024-03-01', `договор ${i + 1}`));
    let call = 0;
    registerTool({
      name: 'mail.search',
      description: 'stub',
      inputSchema: { type: 'object' },
      handler: async () => {
        call++;
        return { messages: fullPage, total: 1000, hasMore: true } as SearchResult;
      },
    });
    const io = new MockConsoleIO(['тема - договор', '']);
    // runFindAllCommand использует дефолт maxPages=200. 200 страниц по 50 =
    // 10000 сообщений, но mock-быстро. Проверяем признак усечения.
    await runFindAllCommand({ io, accounts: [ACCOUNT] });
    const out = io.output();
    expect(out).toContain('Достигнут лимит пагинации');
    expect(call).toBe(200); // упёрлись в потолок
  });
});
