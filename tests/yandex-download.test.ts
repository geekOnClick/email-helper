import { describe, it, expect, vi } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { YandexMailProvider } from '../src/tools/mail/providers/yandex.js';
import type { ImapClientFactory } from '../src/tools/mail/providers/abstract-imap-provider.js';
import type { MailAccount } from '../src/tools/mail/types.js';
import type { FetchMessageObject } from 'imapflow';

const account: MailAccount = {
  provider: 'yandex',
  login: 'agentemailtest@yandex.com',
  password: 'super-secret',
  authStrategy: 'basic',
};

const FOLDERS = [
  { path: 'INBOX', name: 'INBOX', delimiter: '/', flags: new Set(['\\Inbox']), specialUse: '\\Inbox', pathAsListed: 'INBOX', parent: '', parentPath: '', listed: true, subscribed: true },
] as const;

function makeRow(uid: number, atts: Array<{ part: string; filename: string; contentType: string }>): FetchMessageObject {
  const childNodes = atts.map((a) => ({
    part: a.part,
    type: a.contentType,
    disposition: 'attachment',
    dispositionParameters: { filename: a.filename },
    size: 100,
    childNodes: [],
  }));
  return {
    seq: uid,
    uid,
    bodyStructure: { type: 'multipart/mixed', childNodes: [{ part: '1', type: 'text/plain', childNodes: [] }, ...childNodes] } as never,
    envelope: { subject: 'С вложением', from: [{ name: '', address: 'b@example.com' }], to: [], date: new Date(0) },
    internalDate: new Date(0),
    flags: new Set(['\\Seen']),
    size: 500,
  } as unknown as FetchMessageObject;
}

function makeFactory(opts: { rows?: FetchMessageObject[]; downloaded?: Record<string, Buffer> }): ImapClientFactory {
  const rows = opts.rows ?? [];
  const downloaded = opts.downloaded ?? {};
  return () => ({
    connect: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockResolvedValue(FOLDERS),
    mailboxOpen: vi.fn().mockResolvedValue({ path: 'INBOX' }),
    search: vi.fn().mockResolvedValue([]),
    fetchAll: vi.fn().mockResolvedValue(rows),
    download: vi.fn(),
    downloadMany: vi.fn().mockResolvedValue(downloaded),
    logout: vi.fn().mockResolvedValue(undefined),
  });
}

describe('YandexMailProvider.downloadAttachments', () => {
  it('скачивает одно вложение в targetDir', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dl-'));
    const factory = makeFactory({
      rows: [makeRow(10, [{ part: '2', filename: 'report.pdf', contentType: 'application/pdf' }])],
      downloaded: { '2': { content: Buffer.from('PDF-DATA'), meta: {} } as never },
    });
    const p = new YandexMailProvider({ account, clientFactory: factory });
    await p.connect();
    const res = await p.downloadAttachments(10, dir);
    expect(res.paths).toHaveLength(1);
    const content = await readFile(join(dir, 'report.pdf'), 'utf8');
    expect(content).toBe('PDF-DATA');
    expect(res.folder).toBe('INBOX');
    expect(res.uid).toBe(10);
    await rm(dir, { recursive: true, force: true });
  });

  it('скачивает все вложения', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dl-'));
    const factory = makeFactory({
      rows: [makeRow(11, [
        { part: '2', filename: 'a.png', contentType: 'image/png' },
        { part: '3', filename: 'b.jpg', contentType: 'image/jpeg' },
      ])],
      downloaded: {
        '2': { content: Buffer.from('PNG'), meta: {} } as never,
        '3': { content: Buffer.from('JPG'), meta: {} } as never,
      },
    });
    const p = new YandexMailProvider({ account, clientFactory: factory });
    await p.connect();
    const res = await p.downloadAttachments(11, dir);
    expect(res.paths).toHaveLength(2);
    expect(res.paths.map((p2) => p2.split('/').pop())).toEqual(['a.png', 'b.jpg']);
    await rm(dir, { recursive: true, force: true });
  });

  it('коллизия имён → суффикс -1', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dl-'));
    // предварительно создаём report.pdf
    const { writeFile } = await import('node:fs/promises');
    await writeFile(join(dir, 'report.pdf'), 'exists');
    const factory = makeFactory({
      rows: [makeRow(12, [{ part: '2', filename: 'report.pdf', contentType: 'application/pdf' }])],
      downloaded: { '2': { content: Buffer.from('NEW'), meta: {} } as never },
    });
    const p = new YandexMailProvider({ account, clientFactory: factory });
    await p.connect();
    const res = await p.downloadAttachments(12, dir);
    expect(res.paths).toHaveLength(1);
    expect(res.paths[0]?.split('/').pop()).toBe('report-1.pdf');
    // старый файл не перезаписан
    expect(await readFile(join(dir, 'report.pdf'), 'utf8')).toBe('exists');
    expect(await readFile(join(dir, 'report-1.pdf'), 'utf8')).toBe('NEW');
    await rm(dir, { recursive: true, force: true });
  });

  it('path traversal в имени обеззаражен', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dl-'));
    const factory = makeFactory({
      rows: [makeRow(13, [{ part: '2', filename: '../../etc/passwd', contentType: 'application/octet-stream' }])],
      downloaded: { '2': { content: Buffer.from('X'), meta: {} } as never },
    });
    const p = new YandexMailProvider({ account, clientFactory: factory });
    await p.connect();
    const res = await p.downloadAttachments(13, dir);
    expect(res.paths).toHaveLength(1);
    const savedName = res.paths[0]?.split('/').pop();
    expect(savedName).toBe('passwd');
    // путь внутри targetDir
    expect(res.paths[0]?.startsWith(dir)).toBe(true);
    await rm(dir, { recursive: true, force: true });
  });

  it('создаёт несуществующий каталог', async () => {
    const base = await mkdtemp(join(tmpdir(), 'dl-'));
    const dir = join(base, 'sub', '42');
    const factory = makeFactory({
      rows: [makeRow(14, [{ part: '2', filename: 'x.txt', contentType: 'text/plain' }])],
      downloaded: { '2': { content: Buffer.from('X'), meta: {} } as never },
    });
    const p = new YandexMailProvider({ account, clientFactory: factory });
    await p.connect();
    const res = await p.downloadAttachments(14, dir);
    expect(res.paths).toHaveLength(1);
    const p0 = res.paths[0];
    if (!p0) { expect.fail('должен быть путь'); return; }
    expect(await readFile(p0, 'utf8')).toBe('X');
    await rm(base, { recursive: true, force: true });
  });

  it('фильтр по names', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dl-'));
    const factory = makeFactory({
      rows: [makeRow(15, [
        { part: '2', filename: 'a.png', contentType: 'image/png' },
        { part: '3', filename: 'b.jpg', contentType: 'image/jpeg' },
      ])],
      downloaded: { '3': { content: Buffer.from('JPG'), meta: {} } as never },
    });
    const p = new YandexMailProvider({ account, clientFactory: factory });
    await p.connect();
    const res = await p.downloadAttachments(15, dir, { names: ['b.jpg'] });
    expect(res.paths).toHaveLength(1);
    expect(res.paths[0]?.split('/').pop()).toBe('b.jpg');
    await rm(dir, { recursive: true, force: true });
  });

  it('ошибка не раскрывает пароль', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dl-'));
    const factory: ImapClientFactory = () => ({
      connect: vi.fn().mockResolvedValue(undefined),
      list: vi.fn().mockResolvedValue(FOLDERS),
      mailboxOpen: vi.fn().mockResolvedValue({ path: 'INBOX' }),
      search: vi.fn().mockResolvedValue([]),
      fetchAll: vi.fn().mockRejectedValue(new Error(`fail pass=${account.password}`)),
      download: vi.fn(),
      downloadMany: vi.fn().mockResolvedValue({}),
      logout: vi.fn().mockResolvedValue(undefined),
    });
    const p = new YandexMailProvider({ account, clientFactory: factory });
    await p.connect();
    try {
      await p.downloadAttachments(1, dir);
      expect.fail('должен бросить');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      expect(msg).not.toContain(account.password);
    }
    await rm(dir, { recursive: true, force: true });
  });
});