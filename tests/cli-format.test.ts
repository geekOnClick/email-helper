import { describe, it, expect } from 'vitest';
import {
  formatAnswer,
  formatToolProgress,
  formatError,
  formatHelp,
} from '../src/transport/cli/format.js';
import type { OrchestratorResult } from '../src/agents/orchestrator.js';
import type { ToolProgressEvent } from '../src/llm/types.js';

function makeResult(overrides: Partial<OrchestratorResult> = {}): OrchestratorResult {
  return {
    content: 'ответ агента',
    toolCalls: [],
    iterations: 1,
    truncated: false,
    ...overrides,
  };
}

describe('formatAnswer', () => {
  it('обычный ответ без предупреждения', () => {
    const out = formatAnswer(makeResult(), false);
    expect(out).toBe('ответ агента');
    expect(out).not.toContain('усечён');
  });

  it('усечённый ответ добавляет предупреждение', () => {
    const out = formatAnswer(
      makeResult({ truncated: true, iterations: 10 }),
      false,
    );
    expect(out).toContain('ответ агента');
    expect(out).toContain('усечён по лимиту итераций');
    expect(out).toContain('10');
  });

  it('при useColor добавляет ANSI-код в предупреждении', () => {
    const out = formatAnswer(makeResult({ truncated: true, iterations: 5 }), true);
    expect(out).toContain('\x1B[31m');
    expect(out).toContain('\x1B[0m');
  });
});

describe('formatToolProgress', () => {
  it('toolCall → стрелка и имя тулa', () => {
    const event: ToolProgressEvent = {
      type: 'toolCall',
      iteration: 0,
      toolCall: { id: '1', name: 'mail.search', arguments: '{}', args: {} },
    };
    const out = formatToolProgress(event, false);
    expect(out).toBe('→ mail.search');
  });

  it('toolResult ok=true → зелёная галка и summary', () => {
    const event: ToolProgressEvent = {
      type: 'toolResult',
      iteration: 0,
      toolCallId: '1',
      toolName: 'mail.search',
      ok: true,
      summary: '3 письма',
    };
    const out = formatToolProgress(event, false);
    expect(out).toBe('✓ mail.search: 3 письма');
  });

  it('toolResult ok=false → красный крест и summary', () => {
    const event: ToolProgressEvent = {
      type: 'toolResult',
      iteration: 0,
      toolCallId: '1',
      toolName: 'mail.connect',
      ok: false,
      summary: 'Ошибка: нет подключения',
    };
    const out = formatToolProgress(event, false);
    expect(out).toBe('✗ mail.connect: Ошибка: нет подключения');
  });

  it('truncated → предупреждение с числом итераций', () => {
    const event: ToolProgressEvent = {
      type: 'truncated',
      iterations: 10,
    };
    const out = formatToolProgress(event, false);
    expect(out).toContain('лимит итераций');
    expect(out).toContain('10');
  });
});

describe('formatError', () => {
  it('обособленный блок с баннером и сообщением', () => {
    const out = formatError('что-то сломалось', false);
    expect(out).toContain('⚠ Ошибка');
    expect(out).toContain('что-то сломалось');
    // Разделители (должны быть хотя бы один блок сверху и снизу).
    const seps = out.split('─'.repeat(40)).length - 1;
    expect(seps).toBeGreaterThanOrEqual(2);
  });

  it('не содержит ANSI при useColor=false', () => {
    const out = formatError('err', false);
    expect(out).not.toContain('\x1B[');
  });
});

describe('formatHelp', () => {
  it('содержит все slash-команды', () => {
    const out = formatHelp(false);
    expect(out).toContain('/help');
    expect(out).toContain('/quit');
    expect(out).toContain('/clear');
    expect(out).toContain('/reset');
  });

  it('упоминает отправку текста агенту', () => {
    const out = formatHelp(false);
    expect(out).toContain('агенту');
  });
});
