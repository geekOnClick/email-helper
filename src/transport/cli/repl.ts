/**
 * REPL терминала (Фаза 5, change cli-transport).
 *
 * Интерактивный цикл: readline → маршрутизация slash-команд или отправка
 * запроса оркестратору. Вывод прогресса tool-вызовов в реальном времени через
 * onToolEvent-хук оркестратора. /reset пересоздаёт агента через фабрику.
 *
 * Не зависит от реальных потоков: работает через ConsoleIO-абстракцию,
 * что делает REPL тестируемым на MockConsoleIO.
 */
import type { ConsoleIO } from './io.js';
import {
  formatAnswer,
  formatToolProgress,
  formatError,
  formatHelp,
} from './format.js';
import type { Orchestrator } from '../../agents/orchestrator.js';
import type { ToolProgressEvent } from '../../llm/types.js';

/** Признак того, что REPL завершился (для тестов/выхода). */
export interface ReplExit {
  reason: 'quit' | 'eof';
}

/** Опции конструирования REPL. */
export interface CliReplOptions {
  /** Ввод/вывод. */
  io: ConsoleIO;
  /** Оркестратор (история сбрасывается через resetHistory). */
  orchestrator: Orchestrator;
}

const PROMPT = '> ';

/**
 * REPL терминала: цикл ввода → ответ агента.
 */
export class CliRepl {
  private readonly io: ConsoleIO;
  private readonly orchestrator: Orchestrator;
  private running = false;

  constructor(opts: CliReplOptions) {
    this.io = opts.io;
    this.orchestrator = opts.orchestrator;
  }

  /** Запускает REPL-цикл до /quit или EOF. */
  async start(): Promise<ReplExit> {
    this.running = true;
    this.io.write(formatHelp(this.io.isTTY()) + '\n\n');

    while (this.running) {
      this.io.write(PROMPT);
      const line = await this.io.readline();

      // EOF.
      if (line === null) {
        this.running = false;
        return { reason: 'eof' };
      }

      const trimmed = line.trim();

      // Пустой ввод — игнор.
      if (trimmed === '') {
        continue;
      }

      // Slash-команда.
      if (trimmed.startsWith('/')) {
        const exit = await this.handleCommand(trimmed);
        if (exit) {
          this.running = false;
          return { reason: 'quit' };
        }
        continue;
      }

      // Запрос агенту.
      await this.runQuery(trimmed);
    }

    return { reason: 'quit' };
  }

  /** Маршрутизация slash-команд. true → завершить REPL. */
  private async handleCommand(command: string): Promise<boolean> {
    const cmd = command.toLowerCase();
    switch (cmd) {
      case '/help':
        this.io.write(formatHelp(this.io.isTTY()) + '\n');
        return false;
      case '/quit':
        this.io.write('До свидания.\n');
        return true;
      case '/clear':
        this.io.clear();
        return false;
      case '/reset':
        this.resetAgent();
        return false;
      default:
        this.io.write(
          formatError(
            `Неизвестная команда: ${command}. Введите /help для справки.`,
            this.io.isTTY(),
          ) + '\n',
        );
        return false;
    }
  }

  /** Сброс истории диалога: обнуляет историю, тулы/субагенты остаются. */
  private resetAgent(): void {
    this.orchestrator.resetHistory();
    this.io.write('История диалога сброшена.\n');
  }

  /** Прогон запроса через оркестратора с выводом прогресса. */
  private async runQuery(text: string): Promise<void> {
    const useColor = this.io.isTTY();
    try {
      const result = await this.orchestrator.run(text, {
        onToolEvent: (event: ToolProgressEvent) => {
          this.io.write(formatToolProgress(event, useColor) + '\n');
        },
      });
      this.io.write(formatAnswer(result, useColor) + '\n');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.io.write(formatError(msg, useColor) + '\n');
    }
  }
}
