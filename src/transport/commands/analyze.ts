/**
 * Чистая доменная функция команды /analyze (change web-interface, design D1).
 *
 * Выделена из `src/transport/cli/commands/analyze.ts`. Принимает DTO (login,
 * uid, folder?), фетчит письмо через `mail.fetch` и анализирует через
 * субагента-анализатора (LLM). Возвращает отчёт анализа. Не зависит от ConsoleIO.
 */
import type { ToolDef } from '../../tools/registry.js';
import type { Subagent } from '../../agents/subagent.js';
import type { EmailFull } from '../../types/email.js';

/** DTO команды /analyze (без ConsoleIO). */
export interface AnalyzeDeps {
  /** Логин аккаунта. */
  accountLogin: string;
  /** UID письма для анализа. */
  uid: number;
  /** Папка письма (опц.; по умолчанию — входящие). */
  folder?: string;
  /** Тул `mail.fetch`. */
  fetchTool: ToolDef;
  /** Субагент-анализатор (LLM). */
  analyzer: Subagent;
}

/** Результат анализа письма. */
export interface AnalyzeResult {
  /** Отчёт анализа (текст от анализатора). */
  analysis: string;
  /** Проанализированное письмо (метаданные + тело). */
  email: EmailFull;
}

/**
 * Фетчит письмо и анализирует его содержимое через субагента-анализатора.
 *
 * @throws Error при ошибке фетча или анализа.
 */
export async function runAnalyze(deps: AnalyzeDeps): Promise<AnalyzeResult> {
  const { accountLogin, uid, fetchTool, analyzer } = deps;

  const email = (await fetchTool.handler({
    login: accountLogin,
    uid,
    ...(deps.folder ? { folder: deps.folder } : {}),
  })) as EmailFull;

  const from = email.from?.address ?? 'неизвестно';
  const date = email.date.toISOString().slice(0, 10);
  const instruction = [
    'Проанализируй письмо.',
    `Тема: ${email.subject}`,
    `Отправитель: ${from}`,
    `Дата: ${date}`,
    'Тело письма:',
    email.body,
  ].join('\n');

  const analysis = await analyzer.run(instruction);
  return { analysis, email };
}
