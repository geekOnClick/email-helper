import { describe, it, expect, beforeEach } from 'vitest';
import { resetTools, registerTool } from '../src/tools/registry.js';
import { getSharedSessionStore } from '../src/tools/mail/register-tools.js';
import { runFindCommand } from '../src/transport/cli/commands/find.js';
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

/** Pre-seed IMAP-сессии для guided-команд (подключение не вызывается). */
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

function msg(uid: number, subject: string, fromAddr: string, iso = '2026-10-01'): EmailMessage {
  const [y, m, d] = iso.split('-').map(Number);
  return {
    uid,
    subject,
    from: { address: fromAddr },
    to: [{ address: 'test@yandex.com' }],
    date: new Date(y, m - 1, d),
    flags: [],
    folder: 'INBOX',
  };
}

function makeMessages(): EmailMessage[] {
  return [
    msg(1, 'договор N 1', 'a@example.com', '2026-10-01'),
    msg(2, 'договор N 2', 'b@example.com', '2026-10-02'),
  ];
}

describe('runFindCommand', () => {
  beforeEach(() => {
    resetTools();
    seedSession();
  });

  it('находит письма → вывод списка', async () => {
    registerTool({
      name: 'mail.search',
      description: 'stub',
      inputSchema: { type: 'object' },
      handler: async () => ({ messages: makeMessages(), total: 2, hasMore: false }) as SearchResult,
    });
    const io = new MockConsoleIO(['тема - договор', '']);
    await runFindCommand({ io, accounts: [ACCOUNT] });
    const out = io.output();
    expect(out).toContain('Найдено писем: 2');
    expect(out).toContain('UID=1');
    expect(out).toContain('UID=2');
    expect(out).toContain('договор N 1');
  });

  it('тема+отправитель фильтруются локально — находятся письма, которые сервер бы не нашёл', async () => {
    // Ключевой сценарий: сервер ненадёжен по subject/from, но /find передаёт
    // на сервер только даты, а тему/отправителя фильтрует локально. Возвращаем
    // «все письма окна» — локальный фильтр оставит только целевое.
    const allWindow: EmailMessage[] = [
      msg(10, 'Успешная оплата', 'no-reply@igm.gg', '2026-11-03'),
      msg(11, 'Реклама', 'spam@ads.ru', '2026-11-03'),
      msg(12, 'Успешная оплата', 'other@seller.com', '2026-11-02'),
    ];
    registerTool({
      name: 'mail.search',
      description: 'stub',
      inputSchema: { type: 'object' },
      handler: async () => ({ messages: allWindow, total: 3, hasMore: false }) as SearchResult,
    });
    const io = new MockConsoleIO(['тема - Успешная оплата', 'отправитель - no-reply@igm.gg', '']);
    await runFindCommand({ io, accounts: [ACCOUNT] });
    const out = io.output();
    expect(out).toContain('Найдено писем: 1');
    expect(out).toContain('UID=10');
    expect(out).toContain('no-reply@igm.gg');
    expect(out).not.toContain('UID=11');
    expect(out).not.toContain('UID=12');
  });

  it('на сервер идут только даты (без subject/from) — regression', async () => {
    let receivedCriteria: Record<string, unknown> = {};
    registerTool({
      name: 'mail.search',
      description: 'stub',
      inputSchema: { type: 'object' },
      handler: async (raw) => {
        receivedCriteria = (raw as { criteria: Record<string, unknown> }).criteria;
        return { messages: [], total: 0, hasMore: false } as SearchResult;
      },
    });
    const io = new MockConsoleIO(['тема - договор', 'отправитель - a@example.com', '']);
    await runFindCommand({ io, accounts: [ACCOUNT] });
    expect(receivedCriteria).not.toHaveProperty('subject');
    expect(receivedCriteria).not.toHaveProperty('from');
    expect(receivedCriteria).toHaveProperty('since');
    expect(receivedCriteria).toHaveProperty('limit');
  });

  it('явная дата → since+before одного дня включительно', async () => {
    let receivedCriteria: Record<string, unknown> = {};
    registerTool({
      name: 'mail.search',
      description: 'stub',
      inputSchema: { type: 'object' },
      handler: async (raw) => {
        receivedCriteria = (raw as { criteria: Record<string, unknown> }).criteria;
        return { messages: [], total: 0, hasMore: false } as SearchResult;
      },
    });
    const io = new MockConsoleIO(['тема - договор', 'дата - 2026-11-03', '']);
    await runFindCommand({ io, accounts: [ACCOUNT] });
    const since = receivedCriteria.since as Date;
    const before = receivedCriteria.before as Date;
    // since = локальная полночь указанного дня; before = следующий день (включительно).
    // Сравниваем через локальные компоненты, чтобы не зависеть от часового пояса.
    expect(since.getFullYear()).toBe(2026);
    expect(since.getMonth()).toBe(10); // ноябрь (0-based)
    expect(since.getDate()).toBe(3);
    expect(before.getFullYear()).toBe(2026);
    expect(before.getMonth()).toBe(10);
    expect(before.getDate()).toBe(4);
    expect(receivedCriteria).not.toHaveProperty('subject');
    expect(receivedCriteria).not.toHaveProperty('from');
  });

  it('ничего не найдено', async () => {
    registerTool({
      name: 'mail.search',
      description: 'stub',
      inputSchema: { type: 'object' },
      handler: async () => ({ messages: [], total: 0, hasMore: false }) as SearchResult,
    });
    const io = new MockConsoleIO(['тема - несуществующее', '']);
    await runFindCommand({ io, accounts: [ACCOUNT] });
    expect(io.output()).toContain('Ничего не найдено');
  });

  it('отмена поиска (пустой ввод сразу)', async () => {
    registerTool({
      name: 'mail.search',
      description: 'stub',
      inputSchema: { type: 'object' },
      handler: async () => ({ messages: [], total: 0, hasMore: false }),
    });
    const io = new MockConsoleIO(['']);
    await runFindCommand({ io, accounts: [ACCOUNT] });
    expect(io.output()).toContain('Поиск отменён');
  });

  it('нет аккаунтов → сообщение', async () => {
    registerTool({
      name: 'mail.search',
      description: 'stub',
      inputSchema: { type: 'object' },
      handler: async () => ({ messages: [], total: 0, hasMore: false }),
    });
    const io = new MockConsoleIO(['тема - договор', '']);
    await runFindCommand({ io, accounts: [] });
    expect(io.output()).toContain('Нет настроенных');
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
    await runFindCommand({ io, accounts: [ACCOUNT] });
    expect(io.output()).toContain('Ошибка поиска');
    expect(io.output()).toContain('IMAP timeout');
  });

  it('тул не зарегистрирован', async () => {
    const io = new MockConsoleIO(['тема - договор', '']);
    await runFindCommand({ io, accounts: [ACCOUNT] });
    expect(io.output()).toContain('не зарегистрирован');
  });
});
