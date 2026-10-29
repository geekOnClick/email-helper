import { describe, it, expect } from 'vitest';
import { CliRepl } from '../src/transport/cli/repl.js';
import { MockConsoleIO } from './mock-io.js';
import type { Orchestrator, OrchestratorResult } from '../src/agents/orchestrator.js';
import type { ToolProgressEvent } from '../src/llm/types.js';

/** Stub-оркестратор: испускает заданные события, возвращает результат. */
class ProgressOrchestrator {
  constructor(
    private readonly events: ToolProgressEvent[],
    private readonly result: OrchestratorResult,
  ) {}

  async run(
    _text: string,
    opts?: { onToolEvent?: (event: ToolProgressEvent) => void },
  ): Promise<OrchestratorResult> {
    for (const e of this.events) opts?.onToolEvent?.(e);
    return this.result;
  }
}

function makeResult(overrides: Partial<OrchestratorResult> = {}): OrchestratorResult {
  return {
    content: 'итог',
    toolCalls: [],
    iterations: 1,
    truncated: false,
    ...overrides,
  };
}

describe('CliRepl: вывод прогресса tool-вызовов', () => {
  it('события toolCall+toolResult выводятся до финального ответа', async () => {
    const events: ToolProgressEvent[] = [
      {
        type: 'toolCall',
        iteration: 0,
        toolCall: { id: '1', name: 'mail.search', arguments: '{}', args: {} },
      },
      {
        type: 'toolResult',
        iteration: 0,
        toolCallId: '1',
        toolName: 'mail.search',
        ok: true,
        summary: '3 письма',
      },
    ];
    const io = new MockConsoleIO(['найди', '/quit']);
    const orchestrator = new ProgressOrchestrator(events, makeResult());
    const repl = new CliRepl({
      io,
      orchestrator: orchestrator as unknown as Orchestrator,
    });

    await repl.start();
    const out = io.output();

    // Прогресс присутствует.
    expect(out).toContain('→ mail.search');
    expect(out).toContain('✓ mail.search: 3 письма');
    // Финальный ответ тоже есть.
    expect(out).toContain('итог');

    // Порядок: прогресс раньше финального ответа.
    const progressIdx = out.indexOf('→ mail.search');
    const answerIdx = out.indexOf('итог');
    expect(progressIdx).toBeLessThan(answerIdx);
  });

  it('truncated → предупреждение об усечении рядом с ответом', async () => {
    const events: ToolProgressEvent[] = [
      { type: 'truncated', iterations: 10 },
    ];
    const io = new MockConsoleIO(['запрос', '/quit']);
    const orchestrator = new ProgressOrchestrator(
      events,
      makeResult({ truncated: true, iterations: 10 }),
    );
    const repl = new CliRepl({
      io,
      orchestrator: orchestrator as unknown as Orchestrator,
    });

    await repl.start();
    const out = io.output();

    // Предупреждение прогресса.
    expect(out).toContain('лимит итераций');
    // Предупреждение в финальном ответе.
    expect(out).toContain('усечён по лимиту');
  });

  it('ошибка тулa отображается с красным крестом', async () => {
    const events: ToolProgressEvent[] = [
      {
        type: 'toolResult',
        iteration: 0,
        toolCallId: '1',
        toolName: 'mail.connect',
        ok: false,
        summary: 'нет подключения',
      },
    ];
    const io = new MockConsoleIO(['подключи', '/quit']);
    const orchestrator = new ProgressOrchestrator(events, makeResult());
    const repl = new CliRepl({
      io,
      orchestrator: orchestrator as unknown as Orchestrator,
    });

    await repl.start();
    const out = io.output();
    expect(out).toContain('✗ mail.connect: нет подключения');
  });

  it('ошибка run() → обособленный блок, без прогресса', async () => {
    const io = new MockConsoleIO(['запрос', '/quit']);
    const failingOrchestrator = {
      run: async (): Promise<OrchestratorResult> => {
        throw new Error('LLM недоступен');
      },
    };
    const repl = new CliRepl({
      io,
      orchestrator: failingOrchestrator as unknown as Orchestrator,
    });

    await repl.start();
    const out = io.output();
    expect(out).toContain('⚠ Ошибка');
    expect(out).toContain('LLM недоступен');
  });
});
