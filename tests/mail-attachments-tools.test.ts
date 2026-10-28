import { describe, it, expect, vi } from 'vitest';
import { createMailFetchTool } from '../src/tools/mail/mail-fetch.tool.js';
import {
  createMailDownloadAttachmentsTool,
} from '../src/tools/mail/mail-download-attachments.tool.js';
import { MailSessionStore } from '../src/tools/mail/session-store.js';
import type { MailProvider } from '../src/tools/mail/mail-provider.js';

const ACCOUNT = { provider: 'yandex' as const, login: 'a@yandex.com', password: 'p', authStrategy: 'basic' as const };

function fakeProvider(opts: {
  fetch?: (uid: number, folder?: string) => Promise<unknown>;
  download?: (uid: number, dir: string, o?: { folder?: string; names?: string[] }) => Promise<unknown>;
}): MailProvider {
  return {
    connect: vi.fn(),
    listFolders: vi.fn(),
    search: vi.fn(),
    fetch: (opts.fetch ?? vi.fn().mockResolvedValue({ uid: 1, body: 'txt', hasBody: true, attachments: [], folder: 'INBOX', date: new Date(0), flags: [], subject: 'S' })) as MailProvider['fetch'],
    downloadAttachments: (opts.download ?? vi.fn().mockResolvedValue({ paths: ['/x/a.txt'], folder: 'INBOX', uid: 1 })) as MailProvider['downloadAttachments'],
    dispose: vi.fn(),
  };
}

describe('mail.fetch tool', () => {
  it('со сессией возвращает EmailFull', async () => {
    const store = new MailSessionStore();
    const fp = fakeProvider({});
    store.set(ACCOUNT, fp);
    const tool = createMailFetchTool({ sessionStore: store });
    const res = await tool.handler({ login: 'a@yandex.com', uid: 5 });
    expect(res).toHaveProperty('body');
    expect(fp.fetch).toHaveBeenCalledWith(5, undefined);
  });

  it('явная папка передаётся', async () => {
    const store = new MailSessionStore();
    const fp = fakeProvider({ fetch: vi.fn().mockResolvedValue({ uid: 5, body: '', hasBody: false, attachments: [], folder: 'Archive', date: new Date(0), flags: [], subject: '' }) });
    store.set(ACCOUNT, fp);
    const tool = createMailFetchTool({ sessionStore: store });
    await tool.handler({ login: 'a@yandex.com', uid: 5, folder: 'Archive' });
    expect(fp.fetch).toHaveBeenCalledWith(5, 'Archive');
  });

  it('без сессии — ошибка', async () => {
    const store = new MailSessionStore();
    const tool = createMailFetchTool({ sessionStore: store });
    await expect(tool.handler({ login: 'nope', uid: 1 })).rejects.toThrow(/подключение не установлено/);
  });
});

describe('mail.downloadAttachments tool', () => {
  it('со сессией возвращает DownloadResult', async () => {
    const store = new MailSessionStore();
    const fp = fakeProvider({});
    store.set(ACCOUNT, fp);
    const tool = createMailDownloadAttachmentsTool({ sessionStore: store, defaultDownloadDir: './downloads' });
    const res = await tool.handler({ login: 'a@yandex.com', uid: 5 });
    expect(res).toHaveProperty('paths');
    expect(fp.downloadAttachments).toHaveBeenCalledWith(5, './downloads', { folder: undefined, names: undefined });
  });

  it('default targetDir из deps', async () => {
    const store = new MailSessionStore();
    const fp = fakeProvider({});
    store.set(ACCOUNT, fp);
    const tool = createMailDownloadAttachmentsTool({ sessionStore: store, defaultDownloadDir: '/tmp/dl' });
    await tool.handler({ login: 'a@yandex.com', uid: 7 });
    expect(fp.downloadAttachments).toHaveBeenCalledWith(7, '/tmp/dl', expect.anything());
  });

  it('без сессии — ошибка', async () => {
    const store = new MailSessionStore();
    const tool = createMailDownloadAttachmentsTool({ sessionStore: store, defaultDownloadDir: './downloads' });
    await expect(tool.handler({ login: 'nope', uid: 1 })).rejects.toThrow(/подключение не установлено/);
  });
});