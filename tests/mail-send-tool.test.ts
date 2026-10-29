import { describe, it, expect, vi } from 'vitest';
import { createMailSendTool, type MailSendResult } from '../src/tools/mail/mail-send.tool.js';
import { MailSessionStore } from '../src/tools/mail/session-store.js';
import type { MailAccount } from '../src/tools/mail/types.js';
import type { ComposeMailInput } from '../src/types/email.js';
import type { SmtpTransport, SmtpSendMailOptions } from '../src/tools/mail/smtp-client.js';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const yandexAccount: MailAccount = {
  provider: 'yandex',
  login: 'sender@yandex.com',
  password: 'app-pass-secret',
  authStrategy: 'basic',
};

function buildMail(over: Partial<ComposeMailInput> = {}): ComposeMailInput {
  return {
    to: [{ address: 'to@example.com' }],
    subject: 'Тема',
    text: 'Тело письма',
    ...over,
  };
}

/** Мок-транспорт: записывает вызовы sendMail, опционально падает. */
function mockTransport(opts: { failWith?: Error } = {}): SmtpTransport & { calls: SmtpSendMailOptions[] } {
  const calls: SmtpSendMailOptions[] = [];
  const t = {
    sendMail: opts.failWith
      ? vi.fn().mockRejectedValue(opts.failWith)
      : vi.fn(async (o: SmtpSendMailOptions) => {
          calls.push(o);
          return { messageId: '<test-id@smtp>' };
        }),
    close: vi.fn(async () => undefined),
    name: 'mock',
    version: 'test',
  } as unknown as SmtpTransport & { calls: SmtpSendMailOptions[] };
  t.calls = calls;
  return t;
}

/** Stub sessionStore с активной сессией для yandex-аккаунта. */
function activeSessionStore(account: MailAccount = yandexAccount): MailSessionStore {
  const store = new MailSessionStore();
  store.set(account, {
    connect: async () => ({ connected: true, accountId: account.login, provider: account.provider }),
    listFolders: async () => [],
    search: async () => ({ messages: [], total: 0, hasMore: false }),
    fetch: async () => ({}) as never,
    downloadAttachments: async () => ({ paths: [], folder: '', uid: 0 }),
    dispose: async () => undefined,
  });
  return store;
}

function makeTool(opts: {
  store: MailSessionStore;
  transportFactory?: () => SmtpTransport;
  accounts?: MailAccount[];
}) {
  return createMailSendTool({
    sessionStore: opts.store,
    accounts: opts.accounts ?? [yandexAccount],
    transportFactory: opts.transportFactory,
  });
}

describe('mail.send tool', () => {
  it('confirm:false валидное → ready:false, preview заполнен, sendMail НЕ звался', async () => {
    const transport = mockTransport();
    const tool = makeTool({
      store: activeSessionStore(),
      transportFactory: () => transport,
    });
    const res = (await tool.handler({
      login: 'sender@yandex.com',
      mail: buildMail({ subject: 'Привет', text: 'Тело' }),
      confirm: false,
    })) as MailSendResult;
    expect(res.ready).toBe(false);
    if (!res.ready) {
      expect(res.preview.subject).toBe('Привет');
      expect(res.preview.from).toBe('sender@yandex.com');
      expect(res.preview.textLength).toBe('Тело'.length);
      expect(res.preview.hasHtml).toBe(false);
      expect(res.validation.valid).toBe(true);
    }
    expect(transport.sendMail).not.toHaveBeenCalled();
  });

  it('confirm:false невалидное → ready:false, validation.valid=false, sendMail НЕ звался', async () => {
    const transport = mockTransport();
    const tool = makeTool({
      store: activeSessionStore(),
      transportFactory: () => transport,
    });
    const res = (await tool.handler({
      login: 'sender@yandex.com',
      mail: buildMail({ to: [], subject: '', text: '' }),
      confirm: false,
    })) as MailSendResult;
    expect(res.ready).toBe(false);
    expect(res.validation.valid).toBe(false);
    expect(res.validation.errors.length).toBeGreaterThan(0);
    expect(transport.sendMail).not.toHaveBeenCalled();
  });

  it('confirm:true валидное → sendMail звался, ready:true, messageId, recipients', async () => {
    const transport = mockTransport();
    const tool = makeTool({
      store: activeSessionStore(),
      transportFactory: () => transport,
    });
    const res = (await tool.handler({
      login: 'sender@yandex.com',
      mail: buildMail({ to: [{ address: 'a@example.com' }] }),
      confirm: true,
    })) as MailSendResult;
    expect(res.ready).toBe(true);
    if (res.ready) {
      expect(res.messageId).toBe('<test-id@smtp>');
      expect(res.recipients).toEqual(['a@example.com']);
    }
    expect(transport.sendMail).toHaveBeenCalledTimes(1);
  });

  it('confirm:true невалидное → ready:false, sendMail НЕ звался', async () => {
    const transport = mockTransport();
    const tool = makeTool({
      store: activeSessionStore(),
      transportFactory: () => transport,
    });
    const res = (await tool.handler({
      login: 'sender@yandex.com',
      mail: buildMail({ to: [], subject: '', text: '' }),
      confirm: true,
    })) as MailSendResult;
    expect(res.ready).toBe(false);
    expect(res.validation.valid).toBe(false);
    expect(transport.sendMail).not.toHaveBeenCalled();
  });

  it('нет сессии → throws/ошибка', async () => {
    const store = new MailSessionStore(); // пустой
    const tool = makeTool({ store });
    await expect(
      tool.handler({
        login: 'sender@yandex.com',
        mail: buildMail(),
        confirm: false,
      }),
    ).rejects.toThrow(/подключение не установлено/);
  });

  it('несколько получателей TO/CC/BCC → recipients объединён', async () => {
    const transport = mockTransport();
    const tool = makeTool({
      store: activeSessionStore(),
      transportFactory: () => transport,
    });
    const res = (await tool.handler({
      login: 'sender@yandex.com',
      mail: buildMail({
        to: [{ address: 'to1@example.com' }, { address: 'to2@example.com' }],
        cc: [{ address: 'cc@example.com' }],
        bcc: [{ address: 'bcc@example.com' }],
      }),
      confirm: true,
    })) as MailSendResult;
    expect(res.ready).toBe(true);
    if (res.ready) {
      expect(res.recipients).toEqual([
        'to1@example.com',
        'to2@example.com',
        'cc@example.com',
        'bcc@example.com',
      ]);
    }
  });

  it('вложения → в sendMail opts.attachments', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mail-send-att-'));
    const attPath = join(dir, 'file.pdf');
    await writeFile(attPath, 'pdf-content');
    try {
      const transport = mockTransport();
      const tool = makeTool({
        store: activeSessionStore(),
        transportFactory: () => transport,
      });
      await tool.handler({
        login: 'sender@yandex.com',
        mail: buildMail({ attachments: [{ path: attPath }] }),
        confirm: true,
      });
      expect(transport.calls[0].attachments).toEqual([{ path: attPath }]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('ошибка sendMail → redact (пароль не в сообщении)', async () => {
    const transport = mockTransport({
      failWith: new Error('auth failed password=app-pass-secret'),
    });
    const tool = makeTool({
      store: activeSessionStore(),
      transportFactory: () => transport,
    });
    await expect(
      tool.handler({
        login: 'sender@yandex.com',
        mail: buildMail(),
        confirm: true,
      }),
    ).rejects.toSatisfy((err: Error) => {
      const m = err.message;
      return m.includes('auth failed') && !m.includes('app-pass-secret');
    });
  });

  it('inputSchema: name, required содержит login/mail/confirm', () => {
    const tool = makeTool({ store: new MailSessionStore() });
    expect(tool.name).toBe('mail.send');
    expect(tool.inputSchema.required).toEqual(expect.arrayContaining(['login', 'mail', 'confirm']));
  });
});
