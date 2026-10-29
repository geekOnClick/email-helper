import { stat } from 'node:fs/promises';
import type { ComposeMailInput, ValidationResult, EmailAddress } from '../../types/email.js';

/**
 * Регулярное выражение для проверки формата email-адреса.
 * Упрощённая версия RFC 5322: локальная часть (печатные символы без пробелов),
 * '@', домен с точкой. Достаточно для валидации получателей.
 */
const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]+$/;

/**
 * Валидирует критерии письма перед отправкой.
 * Проверки:
 *  - хотя бы один получатель суммарно (TO + CC + BCC);
 *  - каждый адрес валидного email-формата;
 *  - subject непустое;
 *  - text непустое;
 *  - пути вложений существуют (fs.stat).
 *
 * Возвращает { valid, errors }. При множественных нарушениях собирает все ошибки.
 */
export async function validateComposeMail(input: ComposeMailInput): Promise<ValidationResult> {
  const errors: string[] = [];

  // 1. получатели
  const to = input.to ?? [];
  const cc = input.cc ?? [];
  const bcc = input.bcc ?? [];
  const total = to.length + cc.length + bcc.length;
  if (total === 0) {
    errors.push('требуется хотя бы один получатель (TO/CC/BCC)');
  }

  // 2. формат адресов
  checkAddresses(to, 'TO', errors);
  checkAddresses(cc, 'CC', errors);
  checkAddresses(bcc, 'BCC', errors);

  // 3. тема
  if (typeof input.subject !== 'string' || input.subject.trim().length === 0) {
    errors.push('тема письма обязательна и не должна быть пустой');
  }

  // 4. тело
  if (typeof input.text !== 'string' || input.text.trim().length === 0) {
    errors.push('текстовое тело письма обязательно и не должно быть пустым');
  }

  // 5. вложения — пути существуют
  if (input.attachments && input.attachments.length > 0) {
    for (const att of input.attachments) {
      if (typeof att.path !== 'string' || att.path.length === 0) {
        errors.push(`вложение с пустым путём`);
        continue;
      }
      try {
        const s = await stat(att.path);
        if (!s.isFile()) {
          errors.push(`вложение не является файлом: ${att.path}`);
        }
      } catch {
        errors.push(`вложение не найдено: ${att.path}`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/** Проверяет массив адресов на формат, добавляя ошибки в массив. */
function checkAddresses(addrs: EmailAddress[] | undefined, field: string, errors: string[]): void {
  if (!addrs) return;
  for (const a of addrs) {
    if (!a || typeof a.address !== 'string' || !EMAIL_RE.test(a.address)) {
      errors.push(`некорректный адрес ${field}: ${a?.address ?? '(пусто)'}`);
    }
  }
}
