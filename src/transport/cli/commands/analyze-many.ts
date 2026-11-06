/**
 * Команда /analyze-many:批量-поиск писем и анализ каждого + общий смысл
 * (change cli-smart-commands).
 *
 * Тонкий CLI-адаптер (change web-interface, design D1): собирает критерии,
 * вызывает чистую функцию `runAnalyzeMany` (из transport/commands) и рендерит
 * сводный отчёт. Доменная логика (поиск + фетч тел + анализ) переиспользуется
 * вебом без дублирования.
 */
import type { ConsoleIO } from '../io.js';
import { promptFindAllCriteria } from '../prompts.js';
import { promptAccount } from '../prompts.js';
import { getTool } from '../../../tools/registry.js';
import { ensureMailConnected } from './connect.js';
import { runAnalyzeMany } from '../../commands/analyze-many.js';
import type { MailAccount } from '../../../tools/mail/types.js';
import type { Subagent } from '../../../agents/subagent.js';

/** Зависимости команды /analyze-many. */
export interface AnalyzeManyCommandDeps {
  /** Ввод/вывод. */
  io: ConsoleIO;
  /** Настроенные аккаунты. */
  accounts: MailAccount[];
  /** Субагент-анализатор (LLM). */
  analyzer: Subagent;
  /** Окно bounded-поиска (дней) без явной даты (MAIL_SEARCH_FALLBACK_DAYS). */
  fallbackDays?: number;
  /** Потолок числа писем для анализа (ANALYZE_MANY_MAX_EMAILS). По умолчанию 10. */
  maxEmails?: number;
}

/** Выполняет команду /analyze-many. */
export async function runAnalyzeManyCommand(deps: AnalyzeManyCommandDeps): Promise<void> {
  const { io, accounts, analyzer } = deps;

  const criteria = await promptFindAllCriteria(io);
  if (!criteria) {
    io.write('Анализ отменён.\n');
    return;
  }

  const account = await promptAccount(io, accounts);
  if (!account) {
    return; // сообщение уже выведено в promptAccount
  }

  if (!(await ensureMailConnected(io, account))) {
    return; // ошибка подключения уже выведена
  }

  const searchTool = getTool('mail.search');
  const fetchTool = getTool('mail.fetch');
  if (!searchTool || !fetchTool) {
    io.write('Тулы mail.search/mail.fetch не зарегистрированы.\n');
    return;
  }

  // Чистая функция:批量-поиск + фетч тел + анализ (переиспользуется вебом).
  io.write('Анализирую письма...\n');
  try {
    const result = await runAnalyzeMany({
      accountLogin: account.login,
      criteria,
      searchTool,
      fetchTool,
      analyzer,
      maxEmails: deps.maxEmails,
    });

    if (result.totalFound === 0) {
      io.write('Ничего не найдено.\n');
      return;
    }
    if (result.truncatedByEmails) {
      io.write(
        `⚠ Найдено ${result.totalFound} писем; анализируются первые ${result.messages.length} (остальные пропущены).\n`,
      );
    }
    if (result.truncatedByPagination) {
      io.write('⚠ Достигнут лимит пагинации: показаны не все найденные письма.\n');
    }
    io.write(result.analysis + '\n');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    io.write(`Ошибка анализа: ${msg}\n`);
  }
}
