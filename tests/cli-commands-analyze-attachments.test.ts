import { describe, it, expect, beforeEach } from 'vitest';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as fs from 'node:fs';
import { resetTools, registerTool } from '../src/tools/registry.js';
import { getSharedSessionStore } from '../src/tools/mail/register-tools.js';
import { runAnalyzeAttachmentsCommand } from '../src/transport/cli/commands/analyze-attachments.js';
import { MockConsoleIO } from './mock-io.js';
import type { MailAccount } from '../src/tools/mail/types.js';
import type { MailProvider } from '../src/tools/mail/mail-provider.js';
import type { Subagent } from '../src/agents/subagent.js';
import type { SearchResult, DownloadResult } from '../src/types/email.js';

const ACCOUNT: MailAccount = {
  provider: 'yandex',
  login: 'test@yandex.com',
  password: 'stub',
  authStrategy: 'basic',
};

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

/** Анализатор, который всегда падает — проверяем, что tmp-файлы удаляются в finally. */
function stubAnalyzer(): Subagent & { calls: string[] } {
  const calls: string[] = [];
  return {
    name: 'analyzer',
    description: 'stub',
    calls,
    run: async (input: string) => {
      calls.push(input);
      throw new Error('ошибка анализа');
    },
  };
}

describe('runAnalyzeAttachmentsCommand', () => {
  beforeEach(() => {
    resetTools();
    seedSession();
  });

  it('письмо с вложениями → анализ + удаление tmp-файлов', async () => {
    const tmpBase = fs.mkdtempSync(join(tmpdir(), 'aat-'));
    const createdPaths: string[] = [];
    registerTool({
      name: 'mail.search',
      description: 'stub',
      inputSchema: { type: 'object' },
      handler: async () => ({
        messages: [{ uid: 7, subject: 'письмо', from: { address: 'a@b.com' }, to: [], date: new Date(), flags: [], folder: 'INBOX' }],
        total: 1,
        hasMore: false,
      }) as SearchResult,
    });
    registerTool({
      name: 'mail.downloadAttachments',
      description: 'stub',
      inputSchema: { type: 'object' },
      handler: async (args) => {
        const a = args as { targetDir?: string };
        const td = a.targetDir ?? tmpBase;
        const fileA = join(td, 'note.txt');
        const fileB = join(td, 'image.png');
        fs.writeFileSync(fileA, 'Текст вложения про договор.');
        fs.writeFileSync(fileB, Buffer.from([0x89, 0x50]));
        createdPaths.push(fileA, fileB);
        return { paths: [fileA, fileB], folder: 'INBOX', uid: 7 } as DownloadResult;
      },
    });
    const analyzer = stubAnalyzer();
    const io = new MockConsoleIO(['тема - письмо', '', '']);
    await runAnalyzeAttachmentsCommand({ io, accounts: [ACCOUNT], analyzer, tmpDir: tmpBase });
    const out = io.output();
    expect(out).toContain('Скачано вложений: 2');
    expect(analyzer.calls.length).toBeGreaterThanOrEqual(1);
    expect(out).toContain('image.png');
    // tmp-файлы удалены (команда удалила свой поддиректорий).
    expect(createdPaths.every((p) => !existsSync(p))).toBe(true);
  });

  it('письмо без вложений → сообщение', async () => {
    registerTool({
      name: 'mail.search',
      description: 'stub',
      inputSchema: { type: 'object' },
      handler: async () => ({
        messages: [{ uid: 8, subject: 'без вложений', from: { address: 'a@b.com' }, to: [], date: new Date(), flags: [], folder: 'INBOX' }],
        total: 1,
        hasMore: false,
      }) as SearchResult,
    });
    registerTool({
      name: 'mail.downloadAttachments',
      description: 'stub',
      inputSchema: { type: 'object' },
      handler: async () => ({ paths: [], folder: 'INBOX', uid: 8 }) as DownloadResult,
    });
    const analyzer = stubAnalyzer();
    const io = new MockConsoleIO(['тема - без вложений', '', '']);
    await runAnalyzeAttachmentsCommand({ io, accounts: [ACCOUNT], analyzer });
    expect(io.output()).toContain('не содержит вложений');
  });

  it('ошибка анализа → файлы всё равно удаляются', async () => {
    const tmpBase = fs.mkdtempSync(join(tmpdir(), 'aat-err-'));
    const createdPaths: string[] = [];
    registerTool({
      name: 'mail.search',
      description: 'stub',
      inputSchema: { type: 'object' },
      handler: async () => ({
        messages: [{ uid: 9, subject: 'письмо', from: { address: 'a@b.com' }, to: [], date: new Date(), flags: [], folder: 'INBOX' }],
        total: 1,
        hasMore: false,
      }) as SearchResult,
    });
    registerTool({
      name: 'mail.downloadAttachments',
      description: 'stub',
      inputSchema: { type: 'object' },
      handler: async (args) => {
        const a = args as { targetDir?: string };
        const td = a.targetDir ?? tmpBase;
        const fileA = join(td, 'note.txt');
        fs.writeFileSync(fileA, 'текст');
        createdPaths.push(fileA);
        return { paths: [fileA], folder: 'INBOX', uid: 9 } as DownloadResult;
      },
    });
    const analyzer = stubAnalyzer();
    const io = new MockConsoleIO(['тема - письмо', '', '']);
    await runAnalyzeAttachmentsCommand({ io, accounts: [ACCOUNT], analyzer, tmpDir: tmpBase });
    expect(io.output()).toContain('Ошибка анализа');
    expect(createdPaths.every((p) => !existsSync(p))).toBe(true);
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
      handler: async () => ({ paths: [] }),
    });
    const analyzer = stubAnalyzer();
    const io = new MockConsoleIO(['тема - нет', '', '']);
    await runAnalyzeAttachmentsCommand({ io, accounts: [ACCOUNT], analyzer });
    expect(io.output()).toContain('Ничего не найдено');
  });

  it('отмена мастера → отмена', async () => {
    const analyzer = stubAnalyzer();
    const io = new MockConsoleIO(['']);
    await runAnalyzeAttachmentsCommand({ io, accounts: [ACCOUNT], analyzer });
    expect(io.output()).toContain('отменён');
  });
});
