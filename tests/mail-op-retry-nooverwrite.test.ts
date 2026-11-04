import { describe, it, expect, vi } from 'vitest';
import { mkdtemp, rm, readFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { YandexMailProvider } from '../src/tools/mail/providers/yandex.js';
import type { ImapClientFactory } from '../src/tools/mail/providers/abstract-imap-provider.js';
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

const ROW = {
  uid: 1,
  bodyStructure: {
    type: 'multipart/mixed',
    childNodes: [
      { part: '1', type: 'text/plain', childNodes: [] },
      { part: '2', type: 'application/pdf', disposition: 'attachment', dispositionParameters: { filename: 'Счет.pdf' }, size: 3, childNodes: [] },
    ],
  },
};

describe('downloadAttachments retry: uniqueFilename не затирает уже скачанный файл (task 5.7)', () => {
  it('retry создаёт Счет-1.pdf, не перезаписывая Счет.pdf', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mail-retry-uniq-'));
    try {
      const contentFirst = Buffer.from('first');
      const contentRetry = Buffer.from('retry');
      const stub = {
        connect: vi.fn().mockResolvedValue(undefined),
        list: vi.fn().mockResolvedValue([INBOX]),
        mailboxOpen: vi.fn().mockResolvedValue(undefined),
        // первая попытка fetchAll падает с обрывом, вторая — успех
        fetchAll: vi
          .fn()
          .mockRejectedValueOnce(new Error('Connection not available'))
          .mockResolvedValueOnce([ROW]),
        // downloadMany вызывается после успешного fetchAll → один раз, возвращает контент
        downloadMany: vi.fn().mockResolvedValue({ '2': { content: contentRetry } }),
        logout: vi.fn().mockResolvedValue(undefined),
      } as never;
      const factory: ImapClientFactory = () => stub;

      const p = new YandexMailProvider({ account, clientFactory: factory });
      await p.connect();
      const res = await p.downloadAttachments(1, dir, {
        folder: 'INBOX',
        timeoutMs: 5000,
        maxRetries: 1,
      });
      expect(res.paths).toHaveLength(1);

      // Файл создан с суффиксом или оригинальным именем
      const savedName = res.paths[0]?.split('/').pop() ?? '';
      expect(savedName).toMatch(/Счет(-\d+)?\.pdf/);

      // Содержимое — retry (последняя успешная попытка)
      const saved = await readFile(res.paths[0] ?? '');
      expect(saved.toString()).toBe('retry');

      // Имитируем pre-existing файл и проверяем uniqueFilename через второй запуск:
      // создаём Счет.pdf вручную, затем retry-сценарий должен дать Счет-1.pdf
      const firstPath = join(dir, 'Счет.pdf');
      // удалим то, что создал тест, и положим «исходный» Счет.pdf
      await rm(res.paths[0] ?? '', { force: true });
      const { writeFile } = await import('node:fs/promises');
      await writeFile(firstPath, contentFirst);

      // второй запуск с retry: первый fetchAll падает, второй успех
      const stub2 = {
        connect: vi.fn().mockResolvedValue(undefined),
        list: vi.fn().mockResolvedValue([INBOX]),
        mailboxOpen: vi.fn().mockResolvedValue(undefined),
        fetchAll: vi
          .fn()
          .mockRejectedValueOnce(new Error('Connection not available'))
          .mockResolvedValueOnce([ROW]),
        downloadMany: vi.fn().mockResolvedValue({ '2': { content: contentRetry } }),
        logout: vi.fn().mockResolvedValue(undefined),
      } as never;
      const factory2: ImapClientFactory = () => stub2;
      const p2 = new YandexMailProvider({ account, clientFactory: factory2 });
      await p2.connect();
      const res2 = await p2.downloadAttachments(1, dir, {
        folder: 'INBOX',
        timeoutMs: 5000,
        maxRetries: 1,
      });
      expect(res2.paths).toHaveLength(1);
      const savedName2 = res2.paths[0]?.split('/').pop() ?? '';
      // исходный Счет.pdf на месте, новый — Счет-1.pdf
      expect(savedName2).toBe('Счет-1.pdf');
      const original = await readFile(firstPath);
      expect(original.toString()).toBe('first'); // не перезаписан
      const dup = await readFile(res2.paths[0] ?? '');
      expect(dup.toString()).toBe('retry');
      // оба файла существуют
      await expect(access(firstPath)).resolves.toBeUndefined();
      await expect(access(res2.paths[0] ?? '')).resolves.toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
