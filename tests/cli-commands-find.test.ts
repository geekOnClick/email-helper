import { describe, it, expect, beforeEach } from 'vitest';
import { resetTools, registerTool } from '../src/tools/registry.js';
import { runFindCommand } from '../src/transport/cli/commands/find.js';
import { MockConsoleIO } from './mock-io.js';
import type { MailAccount } from '../src/tools/mail/types.js';
import type { SearchResult } from '../src/types/email.js';

const ACCOUNT: MailAccount = {
  provider: 'yandex',
  login: 'test@yandex.com',
  password: 'stub',
  authStrategy: 'basic',
};

function makeMessages(): SearchResult['messages'] {
  return [
    {
      uid: 1,
      subject: 'договор N 1',
      from: { address: 'a@example.com' },
      to: [{ address: 'test@yandex.com' }],
      date: new Date('2026-10-01'),
      flags: [],
      folder: 'INBOX',
    },
    {
      uid: 2,
      subject: 'договор N 2',
      from: { address: 'b@example.com' },
      to: [{ address: 'test@yandex.com' }],
      date: new Date('2026-10-02'),
      flags: [],
      folder: 'INBOX',
    },
  ];
}

describe('runFindCommand', () => {
  beforeEach(() => resetTools());

  it('находит письма → вывод списка', async () => {
    registerTool({
      name: 'mail.search',
      description: 'stub',
      inputSchema: { type: 'object' },
      handler: async () => ({ messages: makeMessages(), total: 2, hasMore: false }) as SearchResult,
    });
    const io = new MockConsoleIO([
      'тема - договор',
      '',
      '', // 1 аккаунт → авто-выбор (но readline вернёт '' 2-й раз только если запросится)
    ]);
    await runFindCommand({ io, accounts: [ACCOUNT] });
    const out = io.output();
    expect(out).toContain('Найдено писем: 2');
    expect(out).toContain('UID=1');
    expect(out).toContain('UID=2');
    expect(out).toContain('договор N 1');
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
