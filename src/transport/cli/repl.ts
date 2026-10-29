/**
 * REPL терминала guided-режима (change guided-commands).
 *
 * Принимает только slash-команды: /find, /analyze, /download, /send, /stats,
 * /quit. Свободный текст отклоняется. Каждая guided-команда маршрутизируется
 * на свой обработчик (src/transport/cli/commands/).
 *
 * Не зависит от реальных потоков: работает через ConsoleIO-абстракцию,
 * что делает REPL тестируемым на MockConsoleIO.
 */
import type { ConsoleIO } from './io.js';
import { formatCommandHelp, formatError, formatSessionReport } from './format.js';
import { SessionStats } from '../../observability/session-stats.js';
import {
  runFindCommand,
  runAnalyzeCommand,
  runDownloadCommand,
  runSendCommand,
} from './commands/index.js';
import type { MailAccount } from '../../tools/mail/types.js';
import type { Subagent } from '../../agents/subagent.js';

/** Признак того, что REPL завершился (для тестов/выхода). */
export interface ReplExit {
  reason: 'quit' | 'eof';
}

/** Зависимости guided-команд (пробрасываются обработчикам). */
export interface GuidedCommandDeps {
  /** Ввод/вывод. */
  io: ConsoleIO;
  /** Настроенные аккаунты. */
  accounts: MailAccount[];
  /** Субагент-анализатор (для /analyze). */
  analyzer: Subagent;
  /** Папка загрузки (для /download). */
  downloadDir?: string;
}

/** Опции конструирования REPL. */
export interface CliReplOptions extends GuidedCommandDeps {
  /** Внешняя статистика сессии (опц.; по умолчанию создаётся внутри). */
  stats?: SessionStats;
}

const PROMPT = '> ';

/**
 * REPL терминала guided-режима: цикл ввода → slash-команда.
 */
export class CliRepl {
  private readonly io: ConsoleIO;
  private readonly accounts: MailAccount[];
  private readonly analyzer: Subagent;
  private readonly downloadDir?: string;
  private readonly stats: SessionStats;
  private running = false;

  constructor(opts: CliReplOptions) {
    this.io = opts.io;
    this.accounts = opts.accounts;
    this.analyzer = opts.analyzer;
    this.downloadDir = opts.downloadDir;
    this.stats = opts.stats ?? new SessionStats();
  }

  /** Запускает REPL-цикл до /quit или EOF. */
  async start(): Promise<ReplExit> {
    this.running = true;
    this.io.write(formatCommandHelp(this.io.isTTY()) + '\n\n');

    let exitReason: ReplExit['reason'] = 'quit';

    while (this.running) {
      this.io.write(PROMPT);
      const line = await this.io.readline();

      // EOF.
      if (line === null) {
        this.running = false;
        exitReason = 'eof';
        break;
      }

      const trimmed = line.trim();

      // Пустой ввод — игнор.
      if (trimmed === '') {
        continue;
      }

      // Не-slash текст — отклоняется.
      if (!trimmed.startsWith('/')) {
        this.io.write(
          'Доступен только slash-командный режим. Введите /find, /analyze, /download, /send, /stats или /quit.\n',
        );
        continue;
      }

      // Slash-команда.
      const shouldExit = await this.handleCommand(trimmed);
      if (shouldExit) {
        this.running = false;
        exitReason = 'quit';
        break;
      }
    }

    // Итоговый отчёт по сессии при выходе (если были прогоны/вызовы).
    const report = this.stats.getReport();
    if (report.runs > 0 || report.toolCalls.ok > 0 || report.toolCalls.error > 0) {
      this.io.write('\n' + formatSessionReport(report, this.io.isTTY()) + '\n');
    }

    return { reason: exitReason };
  }

  /** Маршрутизация slash-команд. true → завершить REPL. */
  private async handleCommand(command: string): Promise<boolean> {
    const cmd = command.toLowerCase();
    switch (cmd) {
      case '/quit':
        this.io.write('До свидания.\n');
        return true;
      case '/stats':
        this.io.write(formatSessionReport(this.stats.getReport(), this.io.isTTY()) + '\n');
        return false;
      case '/find':
        await this.runSafe(() => runFindCommand({ io: this.io, accounts: this.accounts }));
        return false;
      case '/analyze':
        await this.runSafe(() =>
          runAnalyzeCommand({ io: this.io, accounts: this.accounts, analyzer: this.analyzer }),
        );
        return false;
      case '/download':
        await this.runSafe(() =>
          runDownloadCommand({
            io: this.io,
            accounts: this.accounts,
            downloadDir: this.downloadDir,
          }),
        );
        return false;
      case '/send':
        await this.runSafe(() => runSendCommand({ io: this.io, accounts: this.accounts }));
        return false;
      default:
        this.io.write(
          formatError(
            `Неизвестная команда: ${command}. Доступные: /find, /analyze, /download, /send, /stats, /quit.`,
            this.io.isTTY(),
          ) + '\n',
        );
        return false;
    }
  }

  /** Запускает обработчик команды с перехватом непредвиденных ошибок. */
  private async runSafe(fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.io.write(formatError(`Непредвиденная ошибка: ${msg}`, this.io.isTTY()) + '\n');
    }
  }
}
