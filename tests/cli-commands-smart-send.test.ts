import { describe, it, expect, beforeEach } from 'vitest';
import { resetTools, registerTool } from '../src/tools/registry.js';
import { getSharedSessionStore } from '../src/tools/mail/register-tools.js';
import { runSmartSendCommand } from '../src/transport/cli/commands/smart-send.js';
import { MockConsoleIO } from './mock-io.js';
import type { MailAccount } from '../src/tools/mail/types.js';
import type { MailProvider } from '../src/tools/mail/mail-provider.js';
import type { RouterAiClient } from '../src/llm/routerai-client.js';
import type { ChatRequest, ChatResult } from '../src/llm/types.js';

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

/** Scripted LLM: возвращает тела по очереди из массива. */
function scriptedClient(bodies: string[]): RouterAiClient & { calls: ChatRequest[] } {
  const calls: ChatRequest[] = [];
  let i = 0;
  return {
    calls,
    chat: async (request: ChatRequest): Promise<ChatResult> => {
      calls.push(request);
      const body = bodies[Math.min(i, bodies.length - 1)] ?? 'тело';
      i++;
      return { content: body, toolCalls: [] };
    },
  } as unknown as RouterAiClient & { calls: ChatRequest[] };
}

describe('runSmartSendCommand', () => {
  beforeEach(() => {
    resetTools();
    seedSession();
  });

  it('генерация + отправка с первого раза', async () => {
    const sent: unknown[] = [];
    registerTool({
      name: 'mail.send',
      description: 'stub',
      inputSchema: { type: 'object' },
      handler: async (args) => {
        sent.push(args);
        return { ready: true, messageId: 'msg-1', recipients: ['dest@example.com'] };
      },
    });
    const llm = scriptedClient(['Уважаемый коллега, согласен с условиями.']);
    const io = new MockConsoleIO([
      'тема - ответ на договор',
      'получатель - dest@example.com',
      'промпт - вежливо согласиться',
      '',
      'отправить',
    ]);
    await runSmartSendCommand({ io, accounts: [ACCOUNT], llmClient: llm });
    const out = io.output();
    expect(out).toContain('Черновик письма');
    expect(out).toContain('Письмо отправлено');
    expect(sent).toHaveLength(1);
    // Проверим, что отправлено с confirm:true и темой.
    const s = sent[0] as { mail: { subject: string; text: string; to: { address: string }[] }; confirm: boolean };
    expect(s.confirm).toBe(true);
    expect(s.mail.subject).toBe('ответ на договор');
    expect(s.mail.to[0]?.address).toBe('dest@example.com');
  });

  it('цикл правки (redo) → новое тело, тема/получатель неизменны', async () => {
    const sent: unknown[] = [];
    registerTool({
      name: 'mail.send',
      description: 'stub',
      inputSchema: { type: 'object' },
      handler: async (args) => {
        sent.push(args);
        return { ready: true, messageId: 'msg-2', recipients: ['dest@example.com'] };
      },
    });
    const llm = scriptedClient(['Неформальный текст.', 'Формальный текст.']);
    const io = new MockConsoleIO([
      'тема - ответ',
      'получатель - dest@example.com',
      'промпт - согласиться',
      '',
      'сделай более формальным',
      'отправить',
    ]);
    await runSmartSendCommand({ io, accounts: [ACCOUNT], llmClient: llm });
    const out = io.output();
    expect(out).toContain('Письмо отправлено');
    expect(sent).toHaveLength(1);
    // Отправлено второе тело (после правки).
    const s = sent[0] as { mail: { subject: string; text: string } };
    expect(s.mail.text).toBe('Формальный текст.');
    expect(s.mail.subject).toBe('ответ');
    // LLM вызвана дважды (первичная генерация + правка).
    expect(llm.calls).toHaveLength(2);
  });

  it('отказ от отправки → без отправки', async () => {
    const sent: unknown[] = [];
    registerTool({
      name: 'mail.send',
      description: 'stub',
      inputSchema: { type: 'object' },
      handler: async (args) => {
        sent.push(args);
        return { ready: true, messageId: 'msg-3', recipients: [] };
      },
    });
    const llm = scriptedClient(['тело']);
    const io = new MockConsoleIO([
      'тема - ответ',
      'получатель - dest@example.com',
      'промпт - согласиться',
      '',
      'отмена',
    ]);
    await runSmartSendCommand({ io, accounts: [ACCOUNT], llmClient: llm });
    expect(io.output()).toContain('Отправка отменена');
    expect(sent).toHaveLength(0);
  });

  it('неполный набор полей → отмена', async () => {
    const llm = scriptedClient(['тело']);
    const io = new MockConsoleIO(['тема - ответ', '']);
    await runSmartSendCommand({ io, accounts: [ACCOUNT], llmClient: llm });
    expect(io.output()).toContain('Отправка отменена');
  });

  it('тул mail.send не зарегистрирован → сообщение', async () => {
    const llm = scriptedClient(['тело']);
    const io = new MockConsoleIO([
      'тема - ответ',
      'получатель - dest@example.com',
      'промпт - согласиться',
      '',
      'отправить',
    ]);
    await runSmartSendCommand({ io, accounts: [ACCOUNT], llmClient: llm });
    expect(io.output()).toContain('mail.send не зарегистрирован');
  });
});
