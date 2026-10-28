/**
 * Маскирование секретов в сообщениях об ошибках.
 * Вырезает пароль, access token, refresh token и логин (если он выглядит как email)
 * из текста, чтобы они не попадали в логи/сообщения пользователю.
 */

const REDACTED = '[REDACTED]';

/**
 * Возвращает копию `text`, в которой все вхождения секретов заменены на `[REDACTED]`.
 * Перебор альтернатив через массив позволяет безопасно редуцировать несколько секретов сразу.
 */
export function redact(text: string, ...secrets: Array<string | undefined>): string {
  let result = text;
  for (const secret of secrets) {
    if (!secret || secret.length === 0) continue;
    // escape regex special chars, затем глобальная замена через RegExp
    const escaped = secret.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    result = result.replace(new RegExp(escaped, 'g'), REDACTED);
  }
  return result;
}