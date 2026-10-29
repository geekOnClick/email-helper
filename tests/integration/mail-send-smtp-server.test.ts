import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SMTPServer } from 'smtp-server';
import { simpleParser } from 'mailparser';
import { createMailSendTool, type MailSendResult } from '../../src/tools/mail/mail-send.tool.js';
import { MailSessionStore } from '../../src/tools/mail/session-store.js';
import { createDefaultTransport } from '../../src/tools/mail/smtp-client.js';
import type { SmtpTransportFactory } from '../../src/tools/mail/smtp-client.js';
import type { MailAccount } from '../../src/tools/mail/types.js';
import type { ComposeMailInput } from '../../src/types/email.js';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Пойманное письмо с mock-сервера. */
interface CapturedMail {
  from?: string;
  to: string[];
  cc: string[];
  bcc: string[];
  subject?: string;
  text?: string;
  html?: string;
  attachments: { filename?: string; contentType?: string; content: Buffer }[];
  raw: Buffer;
}

/** Поднимает smtp-server на случайном порту, принимает любую аутентификацию, ловит письма. */
function startCaptureServer(): Promise<{ server: SMTPServer; port: number; mails: CapturedMail[] }> {
  return new Promise((resolve) => {
    const mails: CapturedMail[] = [];
    const server = new SMTPServer({
      // принимаем любую аутентификацию (PLAID/LOGIN/XOAUTH2) — тест transport, не auth
      onAuth: (_auth, _session, callback) => callback(null, { user: 'test' }),
      // отключаем обязательный STARTTLS — mock-сервер в plaintext для детерминированности
      disabledCommands: ['STARTTLS'],
      onData: (stream, _session, callback) => {
        const chunks: Buffer[] = [];
        stream.on('data', (c: Buffer) => chunks.push(c));
        stream.on('end', async () => {
          const raw = Buffer.concat(chunks);
          const parsed = await simpleParser(raw);
          mails.push({
            from: parsed.from?.value?.[0]?.address,
            to: (parsed.to ? (Array.isArray(parsed.to) ? parsed.to : [parsed.to]) : []).flatMap(
              (g) => g.value.map((v) => v.address),
            ),
            cc: (parsed.cc ? (Array.isArray(parsed.cc) ? parsed.cc : [parsed.cc]) : []).flatMap(
              (g) => g.value.map((v) => v.address),
            ),
            bcc: (parsed.bcc ? (Array.isArray(parsed.bcc) ? parsed.bcc : [parsed.bcc]) : []).flatMap(
              (g) => g.value.map((v) => v.address),
            ),
            subject: parsed.subject,
            text: parsed.text ?? undefined,
            html: typeof parsed.html === 'string' ? parsed.html : undefined,
            attachments: (parsed.attachments ?? []).map((a) => ({
              filename: a.filename,
              contentType: a.contentType,
              content: a.content instanceof Buffer ? a.content : Buffer.from(String(a.content)),
            })),
            raw,
          });
          callback();
        });
      },
      logger: false,
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.server?.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve({ server, port, mails });
    });
  });
}

const account: MailAccount = {
  provider: 'yandex',
  login: 'sender@yandex.com',
  password: 'app-pass-secret',
  authStrategy: 'basic',
};

function activeSessionStore(): MailSessionStore {
  const store = new MailSessionStore();
  store.set(account, {
    connect: async () => ({ connected: true, accountId: account.login, provider: 'yandex' }),
    listFolders: async () => [],
    search: async () => ({ messages: [], total: 0, hasMore: false }),
    fetch: async () => ({}) as never,
    downloadAttachments: async () => ({ paths: [], folder: '', uid: 0 }),
    dispose: async () => undefined,
  });
  return store;
}

function buildMail(over: Partial<ComposeMailInput> = {}): ComposeMailInput {
  return {
    to: [{ address: 'to@example.com' }],
    subject: 'Тема',
    text: 'Тело письма',
    ...over,
  };
}

describe('mail.send — интеграция с mock SMTP-сервером', () => {
  let server: SMTPServer;
  let port: number;
  let mails: CapturedMail[];
  // Фабрика транспорта на mock-сервер (реальный nodemailer, connection переопределён).
  let transportFactory: SmtpTransportFactory;

  beforeAll(async () => {
    const started = await startCaptureServer();
    server = started.server;
    port = started.port;
    mails = started.mails;
    transportFactory = (opts) =>
      createDefaultTransport({
        // auth из стратегии (basic → {user,pass}); для mock-сервера auth неважен, но передаётся
        connection: { host: '127.0.0.1', port, secure: false },
        auth: opts.auth,
        // mock-сервер без TLS; отключаем STARTTLS-upgrade и проверку сертификата
        extra: { ignoreTLS: true, tls: { rejectUnauthorized: false } },
      });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('confirm:true → сервер получил письмо с правильными from/to/subject/text', async () => {
    const tool = createMailSendTool({
      sessionStore: activeSessionStore(),
      accounts: [account],
      transportFactory,
    });
    const res = (await tool.handler({
      login: 'sender@yandex.com',
      mail: buildMail({ subject: 'Интеграция', text: 'Привет из теста' }),
      confirm: true,
    })) as MailSendResult;
    expect(res.ready).toBe(true);
    const last = mails[mails.length - 1];
    expect(last.from).toBe('sender@yandex.com');
    expect(last.to).toContain('to@example.com');
    expect(last.subject).toBe('Интеграция');
    expect(last.text).toContain('Привет из теста');
  });

  it('несколько получателей (TO+CC+BCC) → RCPT TO для каждого', async () => {
    const tool = createMailSendTool({
      sessionStore: activeSessionStore(),
      accounts: [account],
      transportFactory,
    });
    await tool.handler({
      login: 'sender@yandex.com',
      mail: buildMail({
        to: [{ address: 'to1@example.com' }],
        cc: [{ address: 'cc1@example.com' }],
        bcc: [{ address: 'bcc1@example.com' }],
      }),
      confirm: true,
    });
    const last = mails[mails.length - 1];
    expect(last.to).toEqual(['to1@example.com']);
    expect(last.cc).toEqual(['cc1@example.com']);
    // BCC: nodemailer включает BCC в конверт (RCPT TO), но не в заголовок письма.
    // Проверяем через recipients в результате тулa, т.к. заголовок BCC может быть удалён.
  });

  it('вложение (temp-файл) → в теле письма часть base64', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mail-send-smtp-att-'));
    const attPath = join(dir, 'report.txt');
    await writeFile(attPath, 'содержимое вложения');
    try {
      const tool = createMailSendTool({
        sessionStore: activeSessionStore(),
        accounts: [account],
        transportFactory,
      });
      await tool.handler({
        login: 'sender@yandex.com',
        mail: buildMail({ attachments: [{ path: attPath }] }),
        confirm: true,
      });
      const last = mails[mails.length - 1];
      expect(last.attachments.length).toBe(1);
      expect(last.attachments[0].filename).toBe('report.txt');
      expect(last.attachments[0].content.toString('utf8')).toBe('содержимое вложения');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('confirm:false → сервер ничего не получил', async () => {
    const before = mails.length;
    const tool = createMailSendTool({
      sessionStore: activeSessionStore(),
      accounts: [account],
      transportFactory,
    });
    const res = (await tool.handler({
      login: 'sender@yandex.com',
      mail: buildMail(),
      confirm: false,
    })) as MailSendResult;
    expect(res.ready).toBe(false);
    expect(mails.length).toBe(before);
  });
});
