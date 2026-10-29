import { describe, it, expect } from 'vitest';
import { CliRepl } from '../src/transport/cli/repl.js';
import { MockConsoleIO } from './mock-io.js';
import type { Orchestrator, OrchestratorResult } from '../src/agents/orchestrator.js';
import type { ToolProgressEvent } from '../src/llm/types.js';

/** Stub-оркестратор: записывает вызовы run, возвращает заданные результаты. */
class StubOrchestrator {
  public runCalls: string[] = [];
  public events: ToolProgressEvent[] = [];
  public resetCalls = 0;
  private nextResult: OrchestratorResult;

  constructor(nextResult: OrchestratorResult) {
    this.nextResult = nextResult;
  }

  async run(
    text: string,
    opts?: { onToolEvent?: (event: ToolProgressEvent) => void },
  ): Promise<OrchestratorResult> {
    this.runCalls.push(text);
    for (const e of this.events) opts?.onToolEvent?.(e);
    return this.nextResult;
  }

  resetHistory(): void {
    this.resetCalls++;
  }
}

function makeResult(overrides: Partial<OrchestratorResult> = {}): OrchestratorResult {
  return {
    content: 'ответ',
    toolCalls: [],
    iterations: 1,
    truncated: false,
    ...overrides,
  };
}

/** Обёртка создания REPL со stub-оркестратором. */
function makeRepl(
  inputs: string[],
  orchestrator: StubOrchestrator,
): { io: MockConsoleIO; repl: CliRepl } {
  const io = new MockConsoleIO(inputs);
  const repl = new CliRepl({
    io,
    orchestrator: orchestrator as unknown as Orchestrator,
  });
  return { io, repl };
}

async function runRepl(inputs: string[], result = makeResult()): Promise<{
  io: MockConsoleIO;
  exit: { reason: string };
  orchestrator: StubOrchestrator;
}> {
  const orchestrator = new StubOrchestrator(result);
  const { io, repl } = makeRepl(inputs, orchestrator);
  const exit = await repl.start();
  return { io, exit: exit as { reason: string }, orchestrator };
}

describe('CliRepl: slash-команды и ввод', () => {
  describe('запрос агенту', () => {
    it('текст → ответ агента', async () => {
      const { io, orchestrator } = await runRepl(
        ['найди письма', '/quit'],
        makeResult({ content: '3 письма найдено' }),
      );
      expect(orchestrator.runCalls).toEqual(['найди письма']);
      expect(io.output()).toContain('3 письма найдено');
    });

    it('пустой ввод игнорируется (не отправляется агенту)', async () => {
      const { orchestrator } = await runRepl(['', '  ', '/quit']);
      expect(orchestrator.runCalls).toHaveLength(0);
    });
  });

  describe('/help', () => {
    it('выводит справку', async () => {
      const { io } = await runRepl(['/help', '/quit']);
      const out = io.output();
      expect(out).toContain('/help');
      expect(out).toContain('/quit');
      expect(out).toContain('/reset');
    });
  });

  describe('/quit', () => {
    it('завершает сессию', async () => {
      const { exit } = await runRepl(['/quit']);
      expect(exit.reason).toBe('quit');
    });
  });

  describe('/clear', () => {
    it('вызывает clear на io', async () => {
      const { io } = await runRepl(['/clear', '/quit']);
      expect(io.cleared).toBe(true);
    });
  });

  describe('/reset', () => {
    it('вызывает resetHistory и сообщает о сбросе', async () => {
      const orchestrator = new StubOrchestrator(makeResult());
      const { io, repl } = makeRepl(['/reset', '/quit'], orchestrator);
      await repl.start();
      expect(orchestrator.resetCalls).toBe(1);
      expect(io.output()).toContain('сброшена');
    });
  });

  describe('неизвестная команда', () => {
    it('выводит ошибку и подсказку, не отправляя агенту', async () => {
      const { io, orchestrator } = await runRepl(['/unknown', '/quit']);
      expect(orchestrator.runCalls).toHaveLength(0);
      expect(io.output()).toContain('Неизвестная команда');
      expect(io.output()).toContain('/help');
    });
  });

  describe('EOF', () => {
    it('завершает сессию по EOF', async () => {
      const { exit } = await runRepl([]);
      expect(exit.reason).toBe('eof');
    });
  });

  describe('/stats', () => {
    it('выводит статистику сессии по команде', async () => {
      const { io } = await runRepl(
        ['найди письма', '/stats', '/quit'],
        makeResult({
          content: 'готово',
          usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
        }),
      );
      const out = io.output();
      expect(out).toContain('Статистика сессии');
      expect(out).toContain('Прогонов: 1');
      expect(out).toContain('промпт 100');
    });

    it('/stats без прогонов — нулевая статистика', async () => {
      const { io } = await runRepl(['/stats', '/quit']);
      const out = io.output();
      expect(out).toContain('Прогонов: 0');
    });
  });

  describe('отчёт при выходе', () => {
    it('выводит итоговый отчёт при /quit (если были прогоны)', async () => {
      const { io } = await runRepl(
        ['найди письма', '/quit'],
        makeResult({
          content: 'готово',
          usage: { promptTokens: 200, completionTokens: 80, totalTokens: 280 },
        }),
      );
      const out = io.output();
      expect(out).toContain('Статистика сессии');
      expect(out).toContain('Прогонов: 1');
      expect(out).toContain('всего 280');
    });

    it('выводит итоговый отчёт при EOF (если были прогоны)', async () => {
      const { io } = await runRepl(
        ['найди письма'],
        makeResult({
          content: 'готово',
          usage: { promptTokens: 50, completionTokens: 20, totalTokens: 70 },
        }),
      );
      const out = io.output();
      expect(out).toContain('Статистика сессии');
      expect(out).toContain('Прогонов: 1');
    });

    it('без прогонов отчёт не выводится', async () => {
      const { io } = await runRepl(['/quit']);
      const out = io.output();
      expect(out).not.toContain('Статистика сессии');
    });
  });
});
