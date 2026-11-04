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
  return {
    name: 'analyzer',
    description: 'stub',
    run: async () => 'саммари',
  };
}

/** Стаб RouterAiClient для /smart-send (one-shot chat, роль helper). */
function stubLlmClient(): RouterAiClient {
  return {
    chat: async (_request: ChatRequest): Promise<ChatResult> => ({
      content: 'Сгенерированное тело письма.',
      toolCalls: [],
    }),
  } as unknown as RouterAiClient;
}

/** Создаёт REPL со стаб-зависимостями guided-команд. */
function makeRepl(inputs: string[], accounts: MailAccount[] = [ACCOUNT]) {
  const io = new MockConsoleIO(inputs);
  const analyzer = stubAnalyzer();
  const repl = new CliRepl({
    io,
    accounts,
    registry: new AccountRegistry(accounts),
    envPath: '.env.test-not-written',
    analyzer,
    llmClient: stubLlmClient(),
  });
  return { io, repl, analyzer };
}

describe('CliRepl: guided-режим', () => {
  beforeEach(() => resetTools());

  describe('slash-командный режим', () => {
    it('свободный текст отклоняется', async () => {
      const { io, repl } = makeRepl(['найди письма', '/quit']);
      await repl.start();
      const out = io.output();
      expect(out).toContain('только slash-командный режим');
      expect(out).toContain('/analyze');
    });

    it('пустой ввод игнорируется', async () => {
      const { io, repl } = makeRepl(['', '  ', '/quit']);
      await repl.start();
      const out = io.output();
      expect(out).toContain('До свидания');
    });

    it('/quit завершает сессию', async () => {
      const { io, repl } = makeRepl(['/quit']);
      const exit = await repl.start();
      expect(exit.reason).toBe('quit');
      expect(io.output()).toContain('До свидания');
    });

    it('EOF завершает сессию', async () => {
      const { repl } = makeRepl([]);
      const exit = await repl.start();
      expect(exit.reason).toBe('eof');
    });

    it('/unknown → подсказка о доступных командах', async () => {
      const { io, repl } = makeRepl(['/unknown', '/quit']);
      await repl.start();
      const out = io.output();
      expect(out).toContain('Неизвестная команда');
      expect(out).toContain('/analyze');
      expect(out).toContain('/add-account');
    });
  });

  describe('/add-account', () => {
    it('запускает мастер заведения аккаунта', async () => {
      // Пустой ввод в мастере → отмена (без записи), затем /quit.
      const { io, repl } = makeRepl(['/add-account', '', '/quit']);
      await repl.start();
      const out = io.output();
      expect(out).toContain('Введите данные аккаунта');
      expect(out).toContain('provider');
    });
  });

  describe('/stats', () => {
    it('выводит статистику сессии', async () => {
      const { io, repl } = makeRepl(['/stats', '/quit']);
      await repl.start();
      const out = io.output();
      expect(out).toContain('Статистика сессии');
      expect(out).toContain('Прогонов: 0');
    });
  });

  describe('справка при старте', () => {
    it('выводит список доступных команд', async () => {
      const { io, repl } = makeRepl(['/quit']);
      await repl.start();
      const out = io.output();
      expect(out).toContain('/analyze');
      expect(out).toContain('/analyze-many');
      expect(out).toContain('/analyze-attachments');
      expect(out).toContain('/smart-send');
      expect(out).toContain('/stats');
      expect(out).toContain('/add-account');
    });
  });
});
