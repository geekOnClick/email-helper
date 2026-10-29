import { describe, it, expect, vi } from 'vitest';
import {
  consoleToolLogger,
  noopToolLogger,
  type ToolLogEvent,
} from '../src/observability/logger.js';

function makeEvent(overrides: Partial<ToolLogEvent> = {}): ToolLogEvent {
  return {
    toolName: 'mail.search',
    status: 'ok',
    durationMs: 42,
    summary: 'найдено 3 письма',
    ...overrides,
  };
}

describe('ToolLogger', () => {
  it('noopToolLogger не вызывает побочных эффектов', () => {
    const logger = noopToolLogger();
    const write = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    logger.logToolCall(makeEvent());
    expect(write).not.toHaveBeenCalled();
    write.mockRestore();
  });

  it('consoleToolLogger пишет структурированную строку в поток', () => {
    const chunks: string[] = [];
    const stream = { write: (s: string) => (chunks.push(s), true) } as unknown as NodeJS.WritableStream;
    const logger = consoleToolLogger({ stream });
    logger.logToolCall(makeEvent());
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toContain('[tool]');
    expect(chunks[0]).toContain('mail.search');
    expect(chunks[0]).toContain('ok');
    expect(chunks[0]).toContain('42ms');
    expect(chunks[0]).toContain('найдено 3 письма');
  });

  it('логирует статус ошибки', () => {
    const chunks: string[] = [];
    const stream = { write: (s: string) => (chunks.push(s), true) } as unknown as NodeJS.WritableStream;
    const logger = consoleToolLogger({ stream });
    logger.logToolCall(makeEvent({ status: 'error', summary: 'Ошибка тулa mail.search: timeout' }));
    expect(chunks[0]).toContain('error');
    expect(chunks[0]).toContain('timeout');
  });

  it('маскирует известные секреты в summary', () => {
    const chunks: string[] = [];
    const stream = { write: (s: string) => (chunks.push(s), true) } as unknown as NodeJS.WritableStream;
    const logger = consoleToolLogger({
      stream,
      secrets: ['super-secret-password'],
    });
    logger.logToolCall(
      makeEvent({ summary: 'подключение с паролем super-secret-password установлено' }),
    );
    expect(chunks[0]).not.toContain('super-secret-password');
    expect(chunks[0]).toContain('[REDACTED]');
  });

  it('без секретов summary передаётся как есть', () => {
    const chunks: string[] = [];
    const stream = { write: (s: string) => (chunks.push(s), true) } as unknown as NodeJS.WritableStream;
    const logger = consoleToolLogger({ stream });
    logger.logToolCall(makeEvent({ summary: 'user@example.com' }));
    expect(chunks[0]).toContain('user@example.com');
  });

  it('durationMs фиксируется в строке лога', () => {
    const chunks: string[] = [];
    const stream = { write: (s: string) => (chunks.push(s), true) } as unknown as NodeJS.WritableStream;
    const logger = consoleToolLogger({ stream });
    logger.logToolCall(makeEvent({ durationMs: 1234 }));
    expect(chunks[0]).toContain('1234ms');
  });
});
