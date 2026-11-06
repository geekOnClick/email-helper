/**
 * Чистая доменная функция команды /analyze-many (change web-interface, design D1).
 *
 * Выделена из `src/transport/cli/commands/analyze-many.ts`. Принимает DTO
 * (критерии поиска + login), выполняет批量-поиск (сервер — только даты, тема/
 * отправитель локально), фетчит тела с потолком `maxEmails` и передаёт их одним
 * вызовом анализатора. Возвращает сводный анализ + список найденных писем.
 */
import type { ToolDef } from '../../tools/registry.js';
import type { Subagent } from '../../agents/subagent.js';
import type { EmailMessage, EmailFull } from '../../types/email.js';
import { collectAllMessages } from '../cli/commands/search-aggregator.js';
import type { FindAllCriteriaInput } from '../cli/prompts.js';
import { buildSearchArgsFromFindAll } from '../cli/prompts.js';

/** Дефолт потолка числа писем, если не задан. */
const DEFAULT_MAX_EMAILS = 10;

/** DTO команды /analyze-many (без ConsoleIO). */
export interface AnalyzeManyDeps {
  /** Логин аккаунта. */
  accountLogin: string;
  /** Критерии поиска (тема/отправитель/диапазон дат). */
  criteria: FindAllCriteriaInput;
  /** Тул `mail.search`. */
  searchTool: ToolDef;
  /** Тул `mail.fetch`. */
  fetchTool: ToolDef;
  /** Субагент-анализатор (LLM). */
  analyzer: Subagent;
  /** Потолок числа писем для анализа. По умолчанию 10. */
  maxEmails?: number;
}

/** Результат批量-анализа писем. */
export interface AnalyzeManyResult {
  /** Сводный отчёт анализатора (саммари каждого + общий смысл). */
  analysis: string;
  /** Найденные письма (метаданные), которые анализировались. */
  messages: EmailMessage[];
  /** Всего найдено писем (до усечения потолком). */
  totalFound: number;
  /** Усечено ли число писем потолком maxEmails. */
  truncatedByEmails: boolean;
  /** Достигнут ли потолок пагинации при批量-поиске. */
  truncatedByPagination: boolean;
}

/**
 * Выполняет批量-анализ: поиск писем → фетч тел (с потолком) → анализ.
 *
 * @throws Error при ошибке поиска/анализа.
 */
export async function runAnalyzeMany(deps: AnalyzeManyDeps): Promise<AnalyzeManyResult> {
  const { accountLogin, searchTool, fetchTool, analyzer } = deps;
  const maxEmails = deps.maxEmails ?? DEFAULT_MAX_EMAILS;

  const args = buildSearchArgsFromFindAll(deps.criteria);
  const collected = await collectAllMessages(searchTool, accountLogin, args);

  if (collected.messages.length === 0) {
    return {
      analysis: '',
      messages: [],
      totalFound: 0,
      truncatedByEmails: false,
      truncatedByPagination: collected.truncated,
    };
  }

  const all = collected.messages;
  const truncatedByEmails = all.length > maxEmails;
  const toAnalyze = truncatedByEmails ? all.slice(0, maxEmails) : all;

  // Фетч тел писем (последовательно).
  const emails: EmailFull[] = [];
  for (const m of toAnalyze) {
    try {
      const raw = await fetchTool.handler({ login: accountLogin, uid: m.uid });
      emails.push(raw as EmailFull);
    } catch {
      // Пропускаем письма, которые не удалось прочитать.
    }
  }

  if (emails.length === 0) {
    return {
      analysis: '',
      messages: toAnalyze,
      totalFound: all.length,
      truncatedByEmails,
      truncatedByPagination: collected.truncated,
    };
  }

  const parts: string[] = ['Проанализируй следующие письма. Для каждого дай краткое саммари.'];
  parts.push('После саммари всех писем напиши общий смысл всех писем (если он есть);');
  parts.push('если письма не связаны и общего смысла нет — так и укажи.');
  parts.push('');
  emails.forEach((email, i) => {
    const from = email.from?.address ?? 'неизвестно';
    const date = email.date.toISOString().slice(0, 10);
    parts.push(`--- Письмо ${i + 1} ---`);
    parts.push(`UID: ${email.uid}`);
    parts.push(`Тема: ${email.subject}`);
    parts.push(`Отправитель: ${from}`);
    parts.push(`Дата: ${date}`);
    parts.push('Тело:');
    parts.push(email.body ?? '(тело недоступно)');
    parts.push('');
  });

  const analysis = await analyzer.run(parts.join('\n'));
  return {
    analysis,
    messages: toAnalyze,
    totalFound: all.length,
    truncatedByEmails,
    truncatedByPagination: collected.truncated,
  };
}
