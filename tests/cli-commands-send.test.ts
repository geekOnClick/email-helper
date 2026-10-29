import { describe, it, expect, beforeEach } from 'vitest';
import { resetTools, registerTool } from '../src/tools/registry.js';
import { runSendCommand } from '../src/transport/cli/commands/send.js';
import { MockConsoleIO } from './mock-io.js';
import type { MailAccount } from '../src/tools/mail/types.js';

const ACCOUNT: MailAccount = {
  provider: 'yandex',
  login: 'test@yandex.com',
  password: 'stub',
  authStrategy: 'basic',
};

describe('runSendCommand', () => {
  beforeEach(() => resetTools());

  it('подтверждение «да» → вызов mail.send', async () => {
    const calls: unknown[] = [];
    registerTool({
      name: 'mail.send',
      description: 'stub',
      inputSchema: { type: 'object' },
      handler: async (args) => {
        calls.push(args);
        return { ok: true };
      },
    });
    const io = new MockConsoleIO([
      'тема - ответ',
      'текст - тело письма',
      'получатель - dest@example.com',
      '',
      'да',
    ]);
    await runSendCommand({ io, accounts: [ACCOUNT] });
    const out = io.output();
    expect(out).toContain('Черновик письма');
    expect(out).toContain('dest@example.com');
    expect(out).toContain('Письмо отправлено');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      login: 'test@yandex.com',
      mail: {
        to: [{ address: 'dest@example.com' }],
        subject: 'ответ',
        text: 'тело письма',
      },
      confirm: true,
    });
  });

  it('подтверждение «нет» → без вызова mail.send', async () => {
    const calls: unknown[] = [];
    registerTool({
      name: 'mail.send',
      description: 'stub',
      inputSchema: { type: 'object' },
      handler: async (args) => {
        calls.push(args);
        return { ok: true };
      },
    });
    const io = new MockConsoleIO([
      'тема - ответ',
      'текст - тело',
      'получатель - dest@example.com',
      '',
      'нет',
    ]);
    await runSendCommand({ io, accounts: [ACCOUNT] });
    const out = io.output();
    expect(out).toContain('Отправка отменена');
    expect(calls).toHaveLength(0);
  });

  it('неполный набор (нет получателя) → отмена', async () => {
    const io = new MockConsoleIO(['тема - ответ', 'текст - тело', '']);
    await runSendCommand({ io, accounts: [ACCOUNT] });
    expect(io.output()).toContain('Отправка отменена');
  });

  it('ошибка mail.send → сообщение', async () => {
    registerTool({
      name: 'mail.send',
      description: 'stub',
      inputSchema: { type: 'object' },
      handler: async () => {
        throw new Error('SMTP refused');
      },
    });
    const io = new MockConsoleIO([
      'тема - ответ',
      'текст - тело',
      'получатель - dest@example.com',
      '',
      'да',
    ]);
    await runSendCommand({ io, accounts: [ACCOUNT] });
    const out = io.output();
    expect(out).toContain('Ошибка отправки');
    expect(out).toContain('SMTP refused');
  });
});
