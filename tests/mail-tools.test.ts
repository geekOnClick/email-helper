import { describe, it, expect, vi } from 'vitest';
import { createMailConnectTool } from '../src/tools/mail/mail-connect.tool.js';
import { createMailListFoldersTool } from '../src/tools/mail/mail-list-folders.tool.js';
import { MailSessionStore } from '../src/tools/mail/session-store.js';
import type { MailAccount } from '../src/tools/mail/types.js';

// Мокаем factory, чтобы не поднимать реальные провайдеры.
const accounts: MailAccount[] = [
  { provider: 'yandex', login: 'a@yandex.com', password: 'p', authStrategy: 'basic' },
  { provider: 'outlook', login: 'b@outlook.com', password: 'p', authStrategy: 'oauth2' },
];

vi.mock('../src/tools/mail/providers/factory.js', () => ({
  createMailProvider: vi.fn().mockImplementation((account: MailAccount) => {
    if (account.provider === 'missing') throw new Error('no provider');
    return {
      connect: vi.fn().mockResolvedValue({ connected: true, accountId: account.login, provider: account.provider }),
      listFolders: vi
        .fn()
        .mockResolvedValue([{ name: 'INBOX', path: 'INBOX', delimiter: '/', flags: ['\\Inbox'] }]),
      dispose: vi.fn().mockResolvedValue(undefined),
    };
  }),
}));

describe('mail.connect tool', () => {
  it('успешный connect для известного аккаунта', async () => {
    const store = new MailSessionStore();
    const tool = createMailConnectTool({ accounts, sessionStore: store });
    const res = await tool.handler({ login: 'a@yandex.com' });
    expect(res).toEqual({ connected: true, accountId: 'a@yandex.com', provider: 'yandex' });
    expect(store.has('a@yandex.com')).toBe(true);
  });

  it('ошибка для неизвестного аккаунта', async () => {
    const store = new MailSessionStore();
    const tool = createMailConnectTool({ accounts, sessionStore: store });
    await expect(tool.handler({ login: 'nope@nope.com' })).rejects.toThrow(/аккаунт не найден/);
    expect(store.has('nope@nope.com')).toBe(false);
  });
});

describe('mail.listFolders tool', () => {
  it('со активной сессией возвращает папки', async () => {
    const store = new MailSessionStore();
    const connectTool = createMailConnectTool({ accounts, sessionStore: store });
    await connectTool.handler({ login: 'b@outlook.com' });
    const listTool = createMailListFoldersTool({ sessionStore: store });
    const folders = await listTool.handler({ login: 'b@outlook.com' });
    expect(Array.isArray(folders)).toBe(true);
    expect((folders as Array<{ flags: string[] }>)[0]?.flags).toContain('\\Inbox');
  });

  it('без активной сессии — ошибка "подключение не установлено"', async () => {
    const store = new MailSessionStore();
    const listTool = createMailListFoldersTool({ sessionStore: store });
    await expect(listTool.handler({ login: 'a@yandex.com' })).rejects.toThrow(/подключение не установлено/);
  });
});