import { describe, it, expect } from 'vitest';
import {
  formatAnswer,
  formatToolProgress,
  formatError,
  formatSessionReport,
  formatCommandHelp,
  formatMessageList,
  formatDraft,
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

describe('formatCommandHelp', () => {
  it('содержит все slash-команды guided-режима', () => {
    const out = formatCommandHelp(false);
    expect(out).toContain('/find');
    expect(out).toContain('/analyze');
    expect(out).toContain('/download');
    expect(out).toContain('/send');
    expect(out).toContain('/stats');
    expect(out).toContain('/quit');
  });

  it('упоминает slash-командный режим', () => {
    const out = formatCommandHelp(false);
    expect(out).toContain('slash-командный режим');
  });
});

describe('formatMessageList', () => {
  it('выводит список писем с UID/темой/отправителем/датой', () => {
    const messages = [
      { uid: 1, subject: 'тест', from: { address: 'a@b.com' }, to: [], date: new Date('2026-10-01'), flags: [], folder: 'INBOX' },
      { uid: 2, subject: 'второй', from: { address: 'c@d.com' }, to: [], date: new Date('2026-10-02'), flags: [], folder: 'INBOX' },
    ];
    const out = formatMessageList(messages, false);
    expect(out).toContain('Найдено писем: 2');
    expect(out).toContain('UID=1');
    expect(out).toContain('тест');
    expect(out).toContain('a@b.com');
    expect(out).toContain('UID=2');
  });
});

describe('formatDraft', () => {
  it('выводит черновик с from/to/тема/текст', () => {
    const out = formatDraft({ from: 'me@yandex.com', to: 'dest@example.com', subject: 'тема', text: 'тело' }, false);
    expect(out).toContain('Черновик письма');
    expect(out).toContain('me@yandex.com');
    expect(out).toContain('dest@example.com');
    expect(out).toContain('тема');
    expect(out).toContain('тело');
  });
});

describe('formatSessionReport', () => {
  it('содержит число прогонов, вызовы тулов и токены', () => {
    const report = {
      runs: 3,
      toolCalls: { ok: 5, error: 1 },
      tokens: { prompt: 300, completion: 150, total: 450, available: true },
    };
    const out = formatSessionReport(report, false);
    expect(out).toContain('Прогонов: 3');
    expect(out).toContain('5 ок');
    expect(out).toContain('1 ошибок');
    expect(out).toContain('промпт 300');
    expect(out).toContain('генерация 150');
    expect(out).toContain('всего 450');
  });

  it('без данных о токенах — сообщение о недоступности', () => {
    const report = {
      runs: 1,
      toolCalls: { ok: 0, error: 0 },
      tokens: { prompt: 0, completion: 0, total: 0, available: false },
    };
    const out = formatSessionReport(report, false);
    expect(out).toContain('недоступны');
  });
});
