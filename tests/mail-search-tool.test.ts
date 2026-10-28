import { describe, it, expect, vi } from 'vitest';
import { createMailSearchTool } from '../src/tools/mail/mail-search.tool.js';
import { MailSessionStore } from '../src/tools/mail/session-store.js';
import type { MailProvider } from '../src/tools/mail/mail-provider.js';

vi.mock('../src/tools/mail/providers/factory.js', () => ({
  createMailProvider: vi.fn().mockImplementation((account: { login: string }) => ({
    connect: vi.fn().mockResolvedValue({ connected: true, accountId: account.login, provider: 'yandex' }),
    search: vi.fn().mockResolvedValue({
      messages: [{ uid: 1, subject: 'Тест', folder: 'INBOX', date: new Date(0), flags: [] }],
      total: 1,
      hasMore: false,
    }),
    listFolders: vi.fn().mockResolvedValue([]),
    dispose: vi.fn().mockResolvedValue(undefined),
  }) as unknown as MailProvider),
}));

describe('mail.search tool', () => {
  it('со сессией возвращает SearchResult', async () => {
    const store = new MailSessionStore();
    // подготовим провайдер в store
    const fakeProvider: MailProvider = {
      connect: vi.fn(),
      listFolders: vi.fn(),
      search: vi
        .fn()
        .mockResolvedValue({ messages: [{ uid: 1, subject: 'X', folder: 'INBOX', date: new Date(0), flags: [] }], total: 1, hasMore: false }),
      dispose: vi.fn(),
    };
    store.set({ provider: 'yandex', login: 'a@yandex.com', password: 'p', authStrategy: 'basic' }, fakeProvider);

    const tool = createMailSearchTool({ sessionStore: store });
    const res = await tool.handler({ login: 'a@yandex.com', criteria: { subject: 'X' } });
    expect(res).toHaveProperty('messages');
    expect(res.total).toBe(1);
    expect(fakeProvider.search).toHaveBeenCalledWith(expect.objectContaining({ subject: 'X' }));
  });

  it('без сессии — ошибка "подключение не установлено"', async () => {
    const store = new MailSessionStore();
    const tool = createMailSearchTool({ sessionStore: store });
    await expect(
      tool.handler({ login: 'nope@yandex.com', criteria: { subject: 'X' } }),
    ).rejects.toThrow(/подключение не установлено/);
  });

  it('нормализует ISO-даты в Date', async () => {
    const store = new MailSessionStore();
    const fakeProvider: MailProvider = {
      connect: vi.fn(),
      listFolders: vi.fn(),
      search: vi.fn().mockResolvedValue({ messages: [], total: 0, hasMore: false }),
      dispose: vi.fn(),
    };
    store.set({ provider: 'yandex', login: 'a@yandex.com', password: 'p', authStrategy: 'basic' }, fakeProvider);
    const tool = createMailSearchTool({ sessionStore: store });
    await tool.handler({ login: 'a@yandex.com', criteria: { since: '2026-10-01T00:00:00Z', before: '2026-10-31T00:00:00Z' } });
    const callArg = (fakeProvider.search as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as { since: unknown; before: unknown };
    expect(callArg.since).toBeInstanceOf(Date);
    expect(callArg.before).toBeInstanceOf(Date);
  });
});