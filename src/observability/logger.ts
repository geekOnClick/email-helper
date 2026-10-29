/**
 * Логгер вызовов тулов (Фаза 8, change observability).
 *
 * Аудиторский канал: фиксирует каждый исполненный тул (имя, статус, длительность,
 * summary без секретов). Отделён от UI-канала прогресса (onToolEvent) — отвечает
 * за аудит, не за real-time вывод в терминал.
 */
import { redact } from '../tools/mail/redact.js';

/** Событие лога вызова тулa. */
export interface ToolLogEvent {
  /** Имя исполненного тулa. */
  toolName: string;
  /** Статус завершения: успех / ошибка. */
  status: 'ok' | 'error';
  /** Длительность исполнения в миллисекундах. */
  durationMs: number;
  /** Краткое описание результата или ошибки (без секретов). */
  summary: string;
}

/** Интерфейс логгера вызовов тулов. */
export interface ToolLogger {
  logToolCall(event: ToolLogEvent): void;
}

/** No-op логгер: ничего не делает (по умолчанию, для тестов/без логирования). */
export function noopToolLogger(): ToolLogger {
  return { logToolCall: () => {} };
}

/** Опции консольного логгера. */
export interface ConsoleToolLoggerOptions {
  /** Поток вывода (по умолчанию `process.stderr`). */
  stream?: NodeJS.WritableStream;
  /** Известные секреты для маскирования в summary (пароли, токены). */
  secrets?: Array<string | undefined>;
}

/** Префикс строки лога. */
const LOG_PREFIX = '[tool]';

/**
 * Консольный логгер: пишет структурированную строку в поток (по умолчанию stderr).
 * Секреты в summary маскируются через `redact()`.
 */
export function consoleToolLogger(opts: ConsoleToolLoggerOptions = {}): ToolLogger {
  const stream = opts.stream ?? process.stderr;
  const secrets = opts.secrets ?? [];
  return {
    logToolCall(event: ToolLogEvent): void {
      const safeSummary = secrets.length > 0 ? redact(event.summary, ...secrets) : event.summary;
      const line = `${LOG_PREFIX} ${event.toolName} ${event.status} ${event.durationMs}ms ${safeSummary}`;
      stream.write(line + '\n');
    },
  };
}
