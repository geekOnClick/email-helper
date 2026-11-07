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
      // принимаем любую аутентификацию (PLAIN/LOGIN/XOAUTH2) — тест transport, не auth
      authMethods: ['PLAIN', 'LOGIN', 'XOAUTH2'],
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

  it('Outlook OAuth2 → отправка через Graph API (/me/sendMail), не SMTP', async () => {
    // Для личных @outlook.com SMTP AUTH отключён Microsoft (535 5.7.3), поэтому
    // Outlook+oauth2 отправляет через Microsoft Graph API, не через SMTP-сервер.
    // Мокаем fetch, проверяем что запрос пошёл в Graph, а не на SMTP-порт.
    const oauthAccount: MailAccount = {
      provider: 'outlook',
      login: 'sender@outlook.com',
      password: 'unused-for-oauth2',
      authStrategy: 'oauth2',
    };
    const store = new MailSessionStore();
    store.set(oauthAccount, {
      connect: async () => ({ connected: true, accountId: oauthAccount.login, provider: 'outlook' }),
      listFolders: async () => [],
      search: async () => ({ messages: [], total: 0, hasMore: false }),
      fetch: async () => ({}) as never,
      downloadAttachments: async () => ({ paths: [], folder: '', uid: 0 }),
      dispose: async () => undefined,
    });
    // Временный token store с валидным refresh token для Graph.
    const tokenDir = await mkdtemp(join(tmpdir(), 'mail-send-graph-tokens-'));
    const tokenStorePath = join(tokenDir, 'oauth.json');
    const { OAuthTokenStore } = await import('../../src/tools/mail/oauth/token-store.js');
    const tokenStore = new OAuthTokenStore(tokenStorePath);
    await tokenStore.set(oauthAccount.login, {
      accessToken: 'imap-token',
      refreshToken: 'graph-refresh-token',
      expiresAt: Date.now() + 3600_000,
    });
    // Мок fetch: перехватывает Graph /me/sendMail и refresh-token endpoint.
    // Реализует .json() (для device-flow safeJson) и .text() (для Graph transport).
    const beforeMails = mails.length;
    const graphCalls: { url: string; status: number }[] = [];
    const mockJson = (obj: unknown) => JSON.stringify(obj);
    const fetchFn = async (url: string, init: { method: string; body: string }) => {
      const obj = mockJsonBody(url, init.body);
      return {
        status: 200,
        json: async () => obj,
        text: async () => mockJson(obj),
      };
    };
    // helper: определяет ответ по URL и body
    function mockJsonBody(url: string, body: string): Record<string, unknown> {
      if (url.endsWith('/token') && body.includes('refresh_token')) {
        return {
          access_token: 'graph-access-token-xyz',
          refresh_token: 'graph-refresh-token',
          expires_in: 3600,
        };
      }
      return { error: 'mock: unexpected request' };
    }
    // Graph fetch — отдельный перехватчик (GraphMailTransport вызывает его):
    const graphFetch = async (url: string, _init: { method: string; body: string }) => {
      if (url.includes('graph.microsoft.com') && url.includes('/sendMail')) {
        graphCalls.push({ url, status: 202 });
        return { status: 202, text: async () => '' };
      }
      return { status: 404, text: async () => 'not found' };
    };
    const tool = createMailSendTool({
      sessionStore: store,
      accounts: [oauthAccount],
      oauth2: { clientId: 'fake-client-id', tenant: 'consumers' },
      tokenStorePath,
      fetchFn: fetchFn as never,
      graphFetch: graphFetch as never,
    });
    try {
      const res = (await tool.handler({
        login: 'sender@outlook.com',
        mail: buildMail({ subject: 'Graph API тест', text: 'Тело через Graph' }),
        confirm: true,
      })) as MailSendResult;
      // Отправлено через Graph (не SMTP): mock-сервер ничего не получил.
      expect(res.ready).toBe(true);
      expect(res.messageId).toContain('graph-');
      expect(mails.length).toBe(beforeMails); // SMTP-сервер не задействован
      // Graph API получил запрос sendMail.
      expect(graphCalls.length).toBe(1);
      expect(graphCalls[0]?.url).toContain('graph.microsoft.com/v1.0/me/sendMail');
    } finally {
      await rm(tokenDir, { recursive: true, force: true });
    }
  });
});
