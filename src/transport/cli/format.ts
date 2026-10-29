/**
 * Форматтер вывода REPL (Фаза 5, change cli-transport).
 *
 * Чистые функции: ответ, прогресс тулов, ошибки, справка. Минимальный ANSI
 * (cyan для прогресса, красный для ошибок, серый для разделителей) — коды
 * применяются только при isTTY; в не-TTY вывод plain-text.
 */
import type { ToolProgressEvent } from '../../llm/types.js';
import type { OrchestratorResult } from '../../agents/orchestrator.js';

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
 * Текст справки по slash-командам.
 */
export function formatHelp(useColor = true): string {
  const cmd = (name: string, desc: string): string =>
    `  ${color(name, ANSI.cyan, useColor)}  ${desc}`;
  return [
    'Команды:',
    cmd('/help', 'показать эту справку'),
    cmd('/quit', 'завершить сессию'),
    cmd('/clear', 'очистить экран'),
    cmd('/reset', 'сбросить историю диалога агента'),
    '',
    'Любой другой текст отправляется агенту как запрос.',
  ].join('\n');
}
