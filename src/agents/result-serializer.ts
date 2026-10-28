/**
 * Сериализация и усечение результата тулa (Фаза 2, change orchestrator).
 * Результат тулa превращается в строку для сообщения role:"tool"; большие
 * результаты усекаются, чтобы не переполнять контекст диалога.
 */

/**
 * Сериализует результат тулa в строку, при необходимости усекая.
 * @param value результат тулa (любой)
 * @param maxChars лимит символов; при превышении строка усекается с маркером
 * @returns строковое представление для role:"tool"
 */
export function serializeToolResult(value: unknown, maxChars: number): string {
  const serialized = serialize(value);
  if (serialized.length <= maxChars) {
    return serialized;
  }
  return (
    serialized.slice(0, maxChars) +
    `\n...[результат усечён: ${maxChars} символов из ${serialized.length}]`
  );
}

function serialize(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}