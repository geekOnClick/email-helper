import { describe, it, expect, vi } from 'vitest';
import { GraphMailTransport, type GraphFetch } from '../src/tools/mail/graph-mail-transport.js';
import type { MailAccount } from '../src/tools/mail/types.js';
import type { AuthStrategy } from '../src/tools/mail/mail-provider.js';
import type { ComposeMailInput } from '../src/types/email.js';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const account: MailAccount = {
  provider: 'outlook',
  login: 'sender@outlook.com',
  password: 'unused',
  authStrategy: 'oauth2',
};

/** Стратегия-стаб: getGraphAccessToken возвращает заданный токен. */
function mockStrategy(graphToken: string | undefined): AuthStrategy {
  return {
    kind: 'oauth2',
    getImapAuth: vi.fn(),
    getSmtpAuth: vi.fn(),
    getGraphAccessToken: vi.fn().mockResolvedValue(graphToken),
  };
}

function buildMail(over: Partial<ComposeMailInput> = {}): ComposeMailInput {
  return {
    to: [{ address: 'to@example.com' }],
    subject: 'Тема',
    text: 'Тело письма',
    ...over,
  };
}

describe('GraphMailTransport.send', () => {
  it('успех 202 → messageId, POST /me/sendMail с Bearer token', async () => {
    const calls: { url: string; method: string; auth?: string; body: unknown }[] = [];
    const fetchFn: GraphFetch = async (url, init) => {
      const auth = init.headers['Authorization'];
      let body: unknown = init.body;
      try {
        body = JSON.parse(init.body);
      } catch {
        // не JSON — оставляем как есть
      }
      calls.push({ url, method: init.method, auth, body });
      return { status: 202, text: async () => '' };
    };
    const t = new GraphMailTransport({
      account,
      strategy: mockStrategy('graph-token-xyz'),
      fetchFn,
    });
    const result = await t.send(buildMail({ subject: 'Тест', text: 'Привет' }));
    expect(result.messageId).toContain('graph-');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://graph.microsoft.com/v1.0/me/sendMail');
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.auth).toBe('Bearer graph-token-xyz');
    const body = calls[0]?.body as { message: Record<string, unknown>; saveToSentItems: boolean };
    expect(body.saveToSentItems).toBe(true);
    expect(body.message.subject).toBe('Тест');
    expect(body.message.body).toEqual({ contentType: 'Text', content: 'Привет' });
    expect(body.message.from).toEqual({ emailAddress: { address: 'sender@outlook.com' } });
    expect(body.message.toRecipients).toEqual([{ emailAddress: { address: 'to@example.com' } }]);
  });

  it('html → contentType HTML', async () => {
    let receivedBody: Record<string, unknown> = {};
    const fetchFn: GraphFetch = async (_url, init) => {
      receivedBody = JSON.parse(init.body) as Record<string, unknown>;
      return { status: 202, text: async () => '' };
    };
    const t = new GraphMailTransport({ account, strategy: mockStrategy('tok'), fetchFn });
    await t.send(buildMail({ html: '<p>html</p>' }));
    const message = receivedBody.message as Record<string, unknown>;
    expect(message.body).toEqual({ contentType: 'HTML', content: '<p>html</p>' });
  });

  it('cc + bcc → ccRecipients + bccRecipients', async () => {
    let receivedBody: Record<string, unknown> = {};
    const fetchFn: GraphFetch = async (_url, init) => {
      receivedBody = JSON.parse(init.body) as Record<string, unknown>;
      return { status: 202, text: async () => '' };
    };
    const t = new GraphMailTransport({ account, strategy: mockStrategy('tok'), fetchFn });
    await t.send(
      buildMail({
        to: [{ name: 'Аня', address: 'anya@example.com' }],
        cc: [{ address: 'cc@example.com' }],
        bcc: [{ address: 'bcc@example.com' }],
      }),
    );
    const message = receivedBody.message as Record<string, unknown>;
    expect(message.toRecipients).toEqual([{ emailAddress: { name: 'Аня', address: 'anya@example.com' } }]);
    expect(message.ccRecipients).toEqual([{ emailAddress: { address: 'cc@example.com' } }]);
    expect(message.bccRecipients).toEqual([{ emailAddress: { address: 'bcc@example.com' } }]);
  });

  it('вложение (temp-файл) → attachments с contentBytes base64 + contentType', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'graph-att-'));
    const attPath = join(dir, 'report.pdf');
    await writeFile(attPath, Buffer.from('fake-pdf-content'));
    try {
      let receivedBody: Record<string, unknown> = {};
      const fetchFn: GraphFetch = async (_url, init) => {
        receivedBody = JSON.parse(init.body) as Record<string, unknown>;
        return { status: 202, text: async () => '' };
      };
      const t = new GraphMailTransport({ account, strategy: mockStrategy('tok'), fetchFn });
      await t.send(buildMail({ attachments: [{ path: attPath }] }));
      const message = receivedBody.message as Record<string, unknown>;
      const atts = message.attachments as Array<Record<string, unknown>>;
      expect(atts).toHaveLength(1);
      expect(atts[0]?.name).toBe('report.pdf');
      expect(atts[0]?.contentType).toBe('application/pdf');
      expect(atts[0]?.contentBytes).toBe(Buffer.from('fake-pdf-content').toString('base64'));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('ошибка: нет Graph access token (стратегия без getGraphAccessToken) → throw', async () => {
    const strat: AuthStrategy = {
      kind: 'basic',
      getImapAuth: vi.fn(),
      getSmtpAuth: vi.fn(),
      // getGraphAccessToken отсутствует — basic-стратегия
    };
    const t = new GraphMailTransport({ account, strategy: strat, fetchFn: vi.fn() });
    await expect(t.send(buildMail())).rejects.toThrow(/нет access token/);
  });

  it('ошибка: getGraphAccessToken вернул undefined → throw', async () => {
    const t = new GraphMailTransport({
      account,
      strategy: mockStrategy(undefined),
      fetchFn: vi.fn(),
    });
    await expect(t.send(buildMail())).rejects.toThrow(/нет access token/);
  });

  it('HTTP 4xx → throw с кодом и телом (без токена в сообщении)', async () => {
    const fetchFn: GraphFetch = async () => ({
      status: 403,
      text: async () => 'Insufficient privileges (token=graph-token-xyz)',
    });
    const t = new GraphMailTransport({ account, strategy: mockStrategy('graph-token-xyz'), fetchFn });
    await expect(t.send(buildMail())).rejects.toSatisfy((err: Error) => {
      const m = err.message;
      return m.includes('HTTP 403') && !m.includes('graph-token-xyz');
    });
  });
});
