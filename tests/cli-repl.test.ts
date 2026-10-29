import { describe, it, expect, beforeEach } from 'vitest';
import { CliRepl } from '../src/transport/cli/repl.js';
import { MockConsoleIO } from './mock-io.js';
import { resetTools } from '../src/tools/registry.js';
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

/** Создаёт REPL со стаб-зависимостями guided-команд. */
function makeRepl(inputs: string[], accounts: MailAccount[] = [ACCOUNT]) {
  const io = new MockConsoleIO(inputs);
  const analyzer = stubAnalyzer();
  const repl = new CliRepl({ io, accounts, analyzer, downloadDir: '/tmp' });
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
      expect(out).toContain('/find');
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
      expect(out).toContain('/find');
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
      expect(out).toContain('/find');
      expect(out).toContain('/analyze');
      expect(out).toContain('/download');
      expect(out).toContain('/send');
      expect(out).toContain('/stats');
    });
  });
});
