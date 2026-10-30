import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { resetTools, registerTool } from '../src/tools/registry.js';
import { getSharedSessionStore } from '../src/tools/mail/register-tools.js';
import { runDownloadCommand, getDefaultDownloadDir } from '../src/transport/cli/commands/download.js';
import { MockConsoleIO } from './mock-io.js';
import type { MailAccount } from '../src/tools/mail/types.js';
import type { MailProvider } from '../src/tools/mail/mail-provider.js';
import type { SearchResult, DownloadResult } from '../src/types/email.js';

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

describe('runDownloadCommand', () => {
  beforeEach(() => {
    resetTools();
    seedSession();
  });

  it('скачивание вложений → вывод путей', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eh-dl-'));
    try {
      registerTool({
        name: 'mail.search',
        description: 'stub',
        inputSchema: { type: 'object' },
        handler: async () => ({
          messages: [{ uid: 5, subject: 'с вложением', from: { address: 'a@b.com' }, to: [], date: new Date(), flags: [], folder: 'INBOX' }],
          total: 1,
          hasMore: false,
        }) as SearchResult,
      });
      registerTool({
        name: 'mail.downloadAttachments',
        description: 'stub',
        inputSchema: { type: 'object' },
        handler: async () => ({ paths: [`${tmpDir}/file1.pdf`, `${tmpDir}/file2.txt`], folder: 'INBOX', uid: 5 }) as DownloadResult,
      });
      const io = new MockConsoleIO(['тема - с вложением', '']);
      await runDownloadCommand({ io, accounts: [ACCOUNT], downloadDir: tmpDir });
      const out = io.output();
      expect(out).toContain('Скачано файлов: 2');
      expect(out).toContain('file1.pdf');
      expect(out).toContain('file2.txt');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('письмо без вложений → сообщение', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eh-dl-'));
    try {
      registerTool({
        name: 'mail.search',
        description: 'stub',
        inputSchema: { type: 'object' },
        handler: async () => ({
          messages: [{ uid: 5, subject: 'без вложений', from: { address: 'a@b.com' }, to: [], date: new Date(), flags: [], folder: 'INBOX' }],
          total: 1,
          hasMore: false,
        }) as SearchResult,
      });
      registerTool({
        name: 'mail.downloadAttachments',
        description: 'stub',
        inputSchema: { type: 'object' },
        handler: async () => ({ paths: [], folder: 'INBOX', uid: 5 }) as DownloadResult,
      });
      const io = new MockConsoleIO(['тема - без вложений', '']);
      await runDownloadCommand({ io, accounts: [ACCOUNT], downloadDir: tmpDir });
      expect(io.output()).toContain('не содержит вложений');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('несколько совпадений → выбор UID', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eh-dl-'));
    try {
      registerTool({
        name: 'mail.search',
        description: 'stub',
        inputSchema: { type: 'object' },
        handler: async () => ({
          messages: [1, 2].map((i) => ({ uid: i, subject: `письмо ${i}`, from: { address: 'a@b.com' }, to: [], date: new Date(), flags: [], folder: 'INBOX' })),
          total: 2,
          hasMore: false,
        }) as SearchResult,
      });
      registerTool({
        name: 'mail.downloadAttachments',
        description: 'stub',
        inputSchema: { type: 'object' },
        handler: async () => ({ paths: [`${tmpDir}/out.pdf`], folder: 'INBOX', uid: 2 }) as DownloadResult,
      });
      const io = new MockConsoleIO(['тема - письмо', '', '2']);
      await runDownloadCommand({ io, accounts: [ACCOUNT], downloadDir: tmpDir });
      expect(io.output()).toContain('Скачано файлов: 1');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('отмена выбора UID', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eh-dl-'));
    try {
      registerTool({
        name: 'mail.search',
        description: 'stub',
        inputSchema: { type: 'object' },
        handler: async () => ({
          messages: [1, 2].map((i) => ({ uid: i, subject: `письмо ${i}`, from: { address: 'a@b.com' }, to: [], date: new Date(), flags: [], folder: 'INBOX' })),
          total: 2,
          hasMore: false,
        }) as SearchResult,
      });
      registerTool({
        name: 'mail.downloadAttachments',
        description: 'stub',
        inputSchema: { type: 'object' },
        handler: async () => ({ paths: [], folder: 'INBOX', uid: 0 }) as DownloadResult,
      });
      const io = new MockConsoleIO(['тема - письмо', '', '']);
      await runDownloadCommand({ io, accounts: [ACCOUNT], downloadDir: tmpDir });
      expect(io.output()).toContain('Скачивание отменено');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('ничего не найдено', async () => {
    registerTool({
      name: 'mail.search',
      description: 'stub',
      inputSchema: { type: 'object' },
      handler: async () => ({ messages: [], total: 0, hasMore: false }) as SearchResult,
    });
    registerTool({
      name: 'mail.downloadAttachments',
      description: 'stub',
      inputSchema: { type: 'object' },
      handler: async () => ({ paths: [], folder: 'INBOX', uid: 0 }),
    });
    const io = new MockConsoleIO(['тема - нет', '']);
    await runDownloadCommand({ io, accounts: [ACCOUNT], downloadDir: '/tmp' });
    expect(io.output()).toContain('Ничего не найдено');
  });
});

describe('getDefaultDownloadDir', () => {
  it('возвращает существующую папку (Загрузки или Downloads)', () => {
    const dir = getDefaultDownloadDir();
    const home = os.homedir();
    expect(dir === path.join(home, 'Загрузки') || dir === path.join(home, 'Downloads')).toBe(true);
  });
});
