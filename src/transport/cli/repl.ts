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
  runAnalyzeCommand,
  runAnalyzeManyCommand,
  runAnalyzeAttachmentsCommand,
  runSmartSendCommand,
  runSmartSearchCommand,
} from './commands/index.js';
import { runAddAccountCommand } from './commands/add-account.js';
import type { RouterAiClient } from '../../llm/routerai-client.js';
import type { MailAccount } from '../../tools/mail/types.js';
import type { AccountRegistry } from '../../config/account-registry.js';
import type { Subagent } from '../../agents/subagent.js';

/** Признак того, что REPL завершился (для тестов/выхода). */
export interface ReplExit {
  reason: 'quit' | 'eof';
}

/** Зависимости guided-команд (пробрасываются обработчикам). */
export interface GuidedCommandDeps {
  /** Ввод/вывод. */
  io: ConsoleIO;
  /** Настроенные аккаунты (для выбора в guided-командах). */
  accounts: MailAccount[];
  /** In-memory реестр аккаунтов (источник правды для /add-account и выбора аккаунта). */
  registry: AccountRegistry;
  /** Путь к .env (для /add-account). */
  envPath: string;
  /** Субагент-анализатор (для /analyze, /analyze-many, /analyze-attachments). */
  analyzer: Subagent;
  /** LLM-клиент для /smart-send (прямой one-shot completion, роль helper). */
  llmClient: RouterAiClient;
  /** Потолок числа писем для /analyze-many (ANALYZE_MANY_MAX_EMAILS). */
  analyzeManyMaxEmails?: number;
  /** Окно bounded-поиска (дней) для /smart-search без явной даты (MAIL_SEARCH_FALLBACK_DAYS). */
  fallbackDays?: number;
  /** Потолок глубины поиска (дней назад от сегодня) для старых dateFrom (MAIL_SEARCH_MAX_HISTORY_DAYS). */
  maxHistoryDays?: number;
  /** Размер страницы (limit) пакетного поиска (MAIL_SEARCH_PAGE_SIZE). */
  searchPageSize?: number;
  /** Папка для временных файлов /analyze-attachments (по умолчанию os.tmpdir()). */
  tmpDir?: string;
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
  private readonly registry: AccountRegistry;
  private readonly envPath: string;
  private readonly analyzer: Subagent;
  private readonly llmClient: RouterAiClient;
  private readonly analyzeManyMaxEmails?: number;
  private readonly fallbackDays?: number;
  private readonly maxHistoryDays?: number;
  private readonly searchPageSize?: number;
  private readonly tmpDir?: string;
  private readonly stats: SessionStats;
  private running = false;

  constructor(opts: CliReplOptions) {
    this.io = opts.io;
    this.accounts = opts.accounts;
    this.registry = opts.registry;
    this.envPath = opts.envPath;
    this.analyzer = opts.analyzer;
    this.llmClient = opts.llmClient;
    this.analyzeManyMaxEmails = opts.analyzeManyMaxEmails;
    this.fallbackDays = opts.fallbackDays;
    this.maxHistoryDays = opts.maxHistoryDays;
    this.searchPageSize = opts.searchPageSize;
    this.tmpDir = opts.tmpDir;
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
          'Доступен только slash-командный режим. Введите /analyze, /analyze-many, /analyze-attachments, /smart-send, /smart-search, /stats или /quit.\n',
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
      case '/find-all':
      case '/download':
      case '/send':
        await this.runSafe(() =>
          Promise.resolve().then(() => {
            this.io.write(formatError(
              `Команда ${command} убрана. Используйте /analyze-many, /analyze-attachments или /smart-send.`,
              this.io.isTTY(),
            ) + '\n');
          }),
        );
        return false;
      case '/analyze':
        await this.runSafe(() =>
          runAnalyzeCommand({
            io: this.io,
            accounts: this.registry.list(),
            analyzer: this.analyzer,
          }),
        );
        return false;
      case '/analyze-many':
        await this.runSafe(() =>
          runAnalyzeManyCommand({
            io: this.io,
            accounts: this.registry.list(),
            analyzer: this.analyzer,
            maxEmails: this.analyzeManyMaxEmails,
            maxHistoryDays: this.maxHistoryDays,
            pageSize: this.searchPageSize,
          }),
        );
        return false;
      case '/analyze-attachments':
        await this.runSafe(() =>
          runAnalyzeAttachmentsCommand({
            io: this.io,
            accounts: this.registry.list(),
            analyzer: this.analyzer,
            tmpDir: this.tmpDir,
          }),
        );
        return false;
      case '/smart-send':
        await this.runSafe(() =>
          runSmartSendCommand({
            io: this.io,
            accounts: this.registry.list(),
            llmClient: this.llmClient,
          }),
        );
        return false;
      case '/smart-search':
        await this.runSafe(() =>
          runSmartSearchCommand({
            io: this.io,
            accounts: this.registry.list(),
            llmClient: this.llmClient,
            maxEmails: this.analyzeManyMaxEmails,
            fallbackDays: this.fallbackDays,
            maxHistoryDays: this.maxHistoryDays,
            pageSize: this.searchPageSize,
          }),
        );
        return false;
      case '/add-account':
        await this.runSafe(() =>
          runAddAccountCommand({
            io: this.io,
            registry: this.registry,
            envPath: this.envPath,
          }),
        );
        return false;
      default:
        this.io.write(
          formatError(
            `Неизвестная команда: ${command}. Доступные: /analyze, /analyze-many, /analyze-attachments, /smart-send, /smart-search, /add-account, /stats, /quit.`,
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
