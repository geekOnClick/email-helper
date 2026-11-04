/**
 * Форматтер вывода REPL (Фаза 5, change cli-transport).
 *
 * Чистые функции: ответ, прогресс тулов, ошибки, справка. Минимальный ANSI
 * (cyan для прогресса, красный для ошибок, серый для разделителей) — коды
 * применяются только при isTTY; в не-TTY вывод plain-text.
 */
import type { ToolProgressEvent } from '../../llm/types.js';
import type { OrchestratorResult } from '../../agents/orchestrator.js';
import type { SessionReport } from '../../observability/session-stats.js';
import type { EmailMessage } from '../../types/email.js';

/** ANSI-коды. */
const ANSI = {
  reset: '\x1B[0m',
  cyan: '\x1B[36m',
  red: '\x1B[31m',
  dim: '\x1B[2m',
  green: '\x1B[32m',
} as const;

/** Оборачивает текст в цвет, если поддерживается (TTY). */
function color(text: string, code: string, useColor: boolean): string {
  return useColor ? `${code}${text}${ANSI.reset}` : text;
}

/** Разделитель блока ошибки. */
const ERROR_BANNER = '⚠ Ошибка';

/**
 * Форматирует финальный ответ агента с опц. предупреждением об усечении.
 */
export function formatAnswer(result: OrchestratorResult, useColor = true): string {
  let out = result.content;
  if (result.truncated) {
    const warn = color(
      `\n[ответ усечён по лимиту итераций (${result.iterations})]`,
      ANSI.red,
      useColor,
    );
    out += `\n${warn}`;
  }
  return out;
}

/**
 * Форматирует событие прогресса тулa в одну строку.
 * toolCall → `→ name`; toolResult → `✓ name: summary` или `✗ name: summary`.
 */
export function formatToolProgress(event: ToolProgressEvent, useColor = true): string {
  switch (event.type) {
    case 'toolCall': {
      const arrow = color('→', ANSI.cyan, useColor);
      return `${arrow} ${event.toolCall.name}`;
    }
    case 'toolResult': {
      const mark = event.ok
        ? color('✓', ANSI.green, useColor)
        : color('✗', ANSI.red, useColor);
      return `${mark} ${event.toolName}: ${event.summary}`;
    }
    case 'truncated': {
      return color(
        `[достигнут лимит итераций (${event.iterations})]`,
        ANSI.red,
        useColor,
      );
    }
  }
}

/**
 * Форматирует сообщение об ошибке в обособленный блок.
 */
export function formatError(message: string, useColor = true): string {
  const banner = color(ERROR_BANNER, ANSI.red, useColor);
  const sep = color('─'.repeat(40), ANSI.dim, useColor);
  return `${sep}\n${banner}\n${message}\n${sep}`;
}

/**
 * Форматирует сводный отчёт по сессии: прогоны, вызовы тулов, токены.
 */
export function formatSessionReport(report: SessionReport, useColor = true): string {
  const label = color('Статистика сессии', ANSI.cyan, useColor);
  const sep = color('─'.repeat(40), ANSI.dim, useColor);
  const lines: string[] = [sep, label, sep];
  lines.push(`Прогонов: ${report.runs}`);
  const okStr = color(`${report.toolCalls.ok} ок`, ANSI.green, useColor);
  const errStr = color(`${report.toolCalls.error} ошибок`, ANSI.red, useColor);
  lines.push(`Вызовы тулов: ${okStr}, ${errStr}`);
  if (report.tokens.available) {
    lines.push(
      `Токены LLM: промпт ${report.tokens.prompt}, генерация ${report.tokens.completion}, всего ${report.tokens.total}`,
    );
  } else {
    lines.push('Токены LLM: данные недоступны (провайдер не вернул)');
  }
  return lines.join('\n');
}

/**
 * Текст справки по slash-командам guided-режима.
 */
export function formatCommandHelp(useColor = true): string {
  const cmd = (name: string, desc: string): string =>
    `  ${color(name, ANSI.cyan, useColor)}  ${desc}`;
  return [
    'Команды:',
    cmd('/find', 'поиск писем по теме/дате/отправителю'),
    cmd('/find-all', 'поиск всех писем по теме/отправителю и датам'),
    cmd('/analyze', 'найти и проанализировать письмо'),
    cmd('/download', 'найти и скачать вложения письма'),
    cmd('/send', 'отправить письмо с подтверждением'),
    cmd('/add-account', 'завести/обновить почтовый аккаунт в .env'),
    cmd('/stats', 'статистика сессии (прогоны, тулы, токены)'),
    cmd('/quit', 'завершить сессию'),
    '',
    'Доступен только slash-командный режим.',
  ].join('\n');
}

/**
 * Форматирует список найденных писем (для /find и выбора в /analyze, /download).
 */
export function formatMessageList(messages: EmailMessage[], useColor = true): string {
  const sep = color('─'.repeat(40), ANSI.dim, useColor);
  const lines: string[] = [`Найдено писем: ${messages.length}`, sep];
  messages.forEach((m, i) => {
    const from = m.from?.address ?? 'неизвестно';
    const date = m.date.toISOString().slice(0, 10);
    lines.push(`${i + 1}. UID=${m.uid} | ${m.subject} | ${from} | ${date}`);
  });
  return lines.join('\n');
}

/** Черновик письма для подтверждения перед отправкой. */
export interface DraftEmail {
  to: string;
  subject: string;
  text: string;
  from: string;
}

/**
 * Форматирует черновик письма для предпросмотра перед отправкой.
 */
export function formatDraft(draft: DraftEmail, useColor = true): string {
  const label = color('Черновик письма', ANSI.cyan, useColor);
  const sep = color('─'.repeat(40), ANSI.dim, useColor);
  const lines: string[] = [sep, label, sep];
  lines.push(`От: ${draft.from}`);
  lines.push(`Кому: ${draft.to}`);
  lines.push(`Тема: ${draft.subject}`);
  lines.push('');
  lines.push(draft.text);
  lines.push(sep);
  return lines.join('\n');
}

// === Таблица /find-all (change cli-find-all-command) ===

/** Максимум строк в таблице /find-all; сверх — «найдено ещё N писем». */
const FIND_ALL_MAX_ROWS = 10;

/** Нормализует ячейку таблицы: схлопывает переводы строк/табы в пробел, обрезает края. */
function normalizeCell(text: string | undefined): string {
  if (!text) return '';
  return text.replace(/[\r\n\t]+/g, ' ').trim();
}

/** Форматирует отправителя как «Name <email>» при наличии имени, иначе email. */
function formatSender(from: { name?: string; address: string } | undefined): string {
  const addr = from?.address ?? '';
  const name = from?.name;
  if (name && addr) return `${name} <${addr}>`;
  return addr || 'неизвестно';
}

/** Дополняет строку пробелами до ширины колонки. */
function padCell(text: string, width: number): string {
  return text + ' '.repeat(Math.max(0, width - text.length));
}

/**
 * Форматирует результат /find-all таблицей: заголовки «Дата письма | Тема письма |
 * Отправитель», ниже строки данных (дата + полная тема + отправитель). Ширина
 * колонок вычисляется по данным (тема — полностью, без усечения). Если строк
 * больше 10 — выводит первые 10 и строку «найдено ещё N писем». При пустом
 * массиве возвращает пустую строку (обработчик сам выведет «Ничего не найдено.»).
 *
 * Порядок строк — как передан (тул возвращает UID-порядок папки); сортировка не
 * вводится (Non-Goal change cli-find-all-command).
 */
export function formatFindAllTable(messages: EmailMessage[], useColor = true): string {
  if (messages.length === 0) return '';

  const shown = messages.slice(0, FIND_ALL_MAX_ROWS);
  const dateStrs = shown.map((m) => formatIsoDate(m.date));
  const subjStrs = shown.map((m) => normalizeCell(m.subject));
  const fromStrs = shown.map((m) => formatSender(m.from));

  const HEADER_DATE = 'Дата письма';
  const HEADER_SUBJECT = 'Тема письма';
  const HEADER_FROM = 'Отправитель';
  const SEP = ' | ';

  const wDate = Math.max(HEADER_DATE.length, ...dateStrs.map((s) => s.length));
  const wSubject = Math.max(HEADER_SUBJECT.length, ...subjStrs.map((s) => s.length));
  const wFrom = Math.max(HEADER_FROM.length, ...fromStrs.map((s) => s.length));

  const totalWidth = wDate + wSubject + wFrom + SEP.length * 2;
  const border = color('─'.repeat(totalWidth), ANSI.dim, useColor);

  const lines: string[] = [`Найдено писем: ${messages.length}`, border];
  lines.push(`${padCell(HEADER_DATE, wDate)}${SEP}${padCell(HEADER_SUBJECT, wSubject)}${SEP}${padCell(HEADER_FROM, wFrom)}`);
  lines.push(border);
  for (let i = 0; i < shown.length; i++) {
    lines.push(`${padCell(dateStrs[i] ?? '', wDate)}${SEP}${padCell(subjStrs[i] ?? '', wSubject)}${SEP}${padCell(fromStrs[i] ?? '', wFrom)}`);
  }
  lines.push(border);

  const rest = messages.length - shown.length;
  if (rest > 0) {
    lines.push(`найдено ещё ${rest} писем`);
  }
  return lines.join('\n');
}

/** Форматирует Date как `YYYY-MM-DD` (по локальным компонентам даты). */
function formatIsoDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
