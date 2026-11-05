import { describe, it, expect, beforeEach } from 'vitest';
import { CliRepl } from '../src/transport/cli/repl.js';
import { MockConsoleIO } from './mock-io.js';
import { resetTools } from '../src/tools/registry.js';
import { AccountRegistry } from '../src/config/account-registry.js';
import type { RouterAiClient } from '../src/llm/routerai-client.js';
import type { ChatRequest, ChatResult } from '../src/llm/types.js';
import type { MailAccount } from '../src/tools/mail/types.js';
import type { Subagent } from '../src/agents/subagent.js';

const ACCOUNT: MailAccount = {
  provider: 'yandex',
  login: 'test@yandex.com',
  password: 'stub',
  authStrategy: 'basic',
};

function stubAnalyzer(): Subagent {
  return { name: 'analyzer', description: 'stub', run: async () => 'саммари' };
}

function stubLlmClient(): RouterAiClient {
  return {
    chat: async (_request: ChatRequest): Promise<ChatResult> => ({ content: 'тело', toolCalls: [] }),
  } as unknown as RouterAiClient;
}

function makeRepl(inputs: string[]) {
  const io = new MockConsoleIO(inputs);
  const repl = new CliRepl({
    io,
    accounts: [ACCOUNT],
    registry: new AccountRegistry([ACCOUNT]),
    envPath: '.env.test',
    analyzer: stubAnalyzer(),
    llmClient: stubLlmClient(),
  });
  return { io, repl };
}

describe('CliRepl: маршруты новых команд', () => {
  beforeEach(() => resetTools());

  it('/analyze-many → запуск мастера (отмена пустым вводом)', async () => {
    const { io, repl } = makeRepl(['/analyze-many', '', '/quit']);
    await repl.start();
    expect(io.output()).toContain('Анализ отменён');
  });

  it('/analyze-attachments → запуск мастера (отмена пустым вводом)', async () => {
    const { io, repl } = makeRepl(['/analyze-attachments', '', '/quit']);
    await repl.start();
    expect(io.output()).toContain('отменён');
  });

  it('/smart-send → запуск мастера (отмена неполным вводом)', async () => {
    const { io, repl } = makeRepl(['/smart-send', 'тема - x', '', '/quit']);
    await repl.start();
    expect(io.output()).toContain('Отправка отменена');
  });

  it('/smart-search → запуск мастера (отмена пустым промптом)', async () => {
    const { io, repl } = makeRepl(['/smart-search', '', '/quit']);
    await repl.start();
    expect(io.output()).toContain('Поиск отменён');
  });

  it('убранные команды /find, /find-all, /download, /send → сообщение об уборке', async () => {
    for (const cmd of ['/find', '/find-all', '/download', '/send']) {
      const { io, repl } = makeRepl([cmd, '/quit']);
      await repl.start();
      expect(io.output()).toContain('убрана');
    }
  });

  it('справка содержит новые команды', async () => {
    const { io, repl } = makeRepl(['/quit']);
    await repl.start();
    const out = io.output();
    expect(out).toContain('/analyze-many');
    expect(out).toContain('/analyze-attachments');
    expect(out).toContain('/smart-send');
    expect(out).toContain('/smart-search');
    // убранные команды не упоминаются в справке.
    expect(out).not.toContain('/find-all');
  });
});
