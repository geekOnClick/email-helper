import { describe, it, expect, vi } from 'vitest';
import { SmtpClient, type SmtpTransport, type SmtpSendMailOptions } from '../src/tools/mail/smtp-client.js';
import { BasicAuthStrategy } from '../src/tools/mail/providers/basic-auth.js';
import { OAuth2MsalStrategy } from '../src/tools/mail/providers/oauth2-msal.js';
import type { SmtpConnectionOptions } from '../src/tools/mail/mail-provider.js';
import type { MailAccount } from '../src/tools/mail/types.js';
import type { ComposeMailInput } from '../src/types/email.js';

const yandexAccount: MailAccount = {
  provider: 'yandex',
  login: 'sender@yandex.com',
  password: 'app-pass-secret',
  authStrategy: 'basic',
};

const connection: SmtpConnectionOptions = { host: 'smtp.yandex.ru', port: 465, secure: true };

function mockTransport(opts: {
  sendMail?: (o: SmtpSendMailOptions) => Promise<{ messageId: string }>;
  close?: () => Promise<void>;
  failWith?: Error;
} = {}): SmtpTransport & { calls: SmtpSendMailOptions[] } {
  const calls: SmtpSendMailOptions[] = [];
  const t = {
    sendMail: opts.failWith
      ? vi.fn().mockRejectedValue(opts.failWith)
      : vi.fn(async (o: SmtpSendMailOptions) => {
          calls.push(o);
          return { messageId: '<test-id@smtp>' };
        }),
    close: opts.close ?? vi.fn(async () => undefined),
    // Transport marker fields — не используются в тестах, но тип требует.
    name: 'mock',
    version: 'test',
  } as unknown as SmtpTransport & { calls: SmtpSendMailOptions[] };
  t.calls = calls;
  return t;
}

function buildMail(over: Partial<ComposeMailInput> = {}): ComposeMailInput {
  return {
    to: [{ address: 'to@example.com' }],
    subject: 'Тема',
    text: 'Тело письма',
    ...over,
  };
}

describe('SmtpClient.send', () => {
  it('валидное письмо → sendMail с корректными opts, messageId возвращён', async () => {
    const transport = mockTransport();
    const client = new SmtpClient({
      account: yandexAccount,
      strategy: new BasicAuthStrategy(),
      connection,
      transportFactory: () => transport,
    });
    const result = await client.send(buildMail({ subject: 'Привет', text: 'Тело' }));
    expect(result).toEqual({ messageId: '<test-id@smtp>' });
    expect(transport.sendMail).toHaveBeenCalledTimes(1);
    const opts = transport.calls[0];
    expect(opts.from).toBe('sender@yandex.com');
    expect(opts.subject).toBe('Привет');
    expect(opts.text).toBe('Тело');
  });

  it('несколько получателей TO/CC/BCC → все в opts', async () => {
    const transport = mockTransport();
    const client = new SmtpClient({
      account: yandexAccount,
      strategy: new BasicAuthStrategy(),
      connection,
      transportFactory: () => transport,
    });
    await client.send(
      buildMail({
        to: [{ name: 'Аня', address: 'anya@example.com' }, { address: 'bob@example.com' }],
        cc: [{ address: 'cc@example.com' }],
        bcc: [{ address: 'bcc@example.com' }],
      }),
    );
    const opts = transport.calls[0];
    expect(opts.to).toEqual([{ name: 'Аня', address: 'anya@example.com' }, 'bob@example.com']);
    expect(opts.cc).toEqual(['cc@example.com']);
    expect(opts.bcc).toEqual(['bcc@example.com']);
  });

  it('вложения → в opts.attachments', async () => {
    const transport = mockTransport();
    const client = new SmtpClient({
      account: yandexAccount,
      strategy: new BasicAuthStrategy(),
      connection,
      transportFactory: () => transport,
    });
    await client.send(buildMail({ attachments: [{ path: '/tmp/file1.pdf' }, { path: '/tmp/file2.png' }] }));
    expect(transport.calls[0].attachments).toEqual([{ path: '/tmp/file1.pdf' }, { path: '/tmp/file2.png' }]);
  });

  it('html + encoding → в opts', async () => {
    const transport = mockTransport();
    const client = new SmtpClient({
      account: yandexAccount,
      strategy: new BasicAuthStrategy(),
      connection,
      transportFactory: () => transport,
    });
    await client.send(buildMail({ html: '<p>html</p>', encoding: 'utf-8' }));
    expect(transport.calls[0].html).toBe('<p>html</p>');
    expect(transport.calls[0].encoding).toBe('utf-8');
  });

  it('ошибка sendMail → redact (пароль не в сообщении)', async () => {
    const transport = mockTransport({
      failWith: new Error('auth failed for sender@yandex.com password=app-pass-secret'),
    });
    const client = new SmtpClient({
      account: yandexAccount,
      strategy: new BasicAuthStrategy(),
      connection,
      transportFactory: () => transport,
    });
    await expect(client.send(buildMail())).rejects.toSatisfy((err: Error) => {
      const m = err.message;
      return m.includes('auth failed') && !m.includes('app-pass-secret');
    });
  });

  it('ошибка sendMail → redact accessToken для oauth2', async () => {
    const transport = mockTransport({
      failWith: new Error('reject: token=AT-secret-123 login=sender@yandex.com'),
    });
    // oauth2-стратегия с прямым access token
    const strategy = {
      kind: 'oauth2' as const,
      getImapAuth: vi.fn(),
      getSmtpAuth: vi.fn().mockResolvedValue({ user: 'sender@outlook.com', accessToken: 'AT-secret-123' }),
    };
    const client = new SmtpClient({
      account: { ...yandexAccount, provider: 'outlook', login: 'sender@outlook.com', authStrategy: 'oauth2' },
      strategy: strategy as unknown as OAuth2MsalStrategy,
      connection: { host: 'smtp-mail.outlook.com', port: 587, secure: false },
      transportFactory: () => transport,
    });
    await expect(client.send(buildMail())).rejects.toSatisfy((err: Error) => {
      const m = err.message;
      return m.includes('reject') && !m.includes('AT-secret-123') && !m.includes('sender@outlook.com');
    });
  });

  it('transport.close() зовётся после отправки (short-lived)', async () => {
    const close = vi.fn(async () => undefined);
    const transport = mockTransport({ close });
    const client = new SmtpClient({
      account: yandexAccount,
      strategy: new BasicAuthStrategy(),
      connection,
      transportFactory: () => transport,
    });
    await client.send(buildMail());
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('transport.close() зовётся даже при ошибке', async () => {
    const close = vi.fn(async () => undefined);
    const transport = mockTransport({
      failWith: new Error('boom'),
      close,
    });
    const client = new SmtpClient({
      account: yandexAccount,
      strategy: new BasicAuthStrategy(),
      connection,
      transportFactory: () => transport,
    });
    await expect(client.send(buildMail())).rejects.toThrow('boom');
    expect(close).toHaveBeenCalledTimes(1);
  });
});
