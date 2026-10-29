/**
 * Мастер сбора критериев для guided-команд (change guided-commands).
 *
 * Структурированный CLI-мастер: каждое поле вводится отдельной строкой в
 * формате `ключ - значение`. Валидация формата/даты/email, повтор при ошибке.
 * Работает через ConsoleIO — тестируем на MockConsoleIO.
 */
import type { ConsoleIO } from './io.js';
import type { MailAccount } from '../../tools/mail/types.js';
import type { EmailMessage } from '../../types/email.js';

/** Входные критерии поиска (любое подмножество полей). */
export interface SearchCriteriaInput {
  /** Тема (подстрока). */
  subject?: string;
  /** Дата (ISO YYYY-MM-DD). */
  date?: string;
  /** Отправитель (email). */
  from?: string;
}

/** Входные критерии письма для отправки. */
export interface SendCriteriaInput {
  /** Тема письма. */
  subject: string;
  /** Текстовое тело. */
  text: string;
  /** Получатель (email). */
  to: string;
}

/** Допустимые имена полей мастера поиска. */
const SEARCH_FIELDS = ['тема', 'дата', 'отправитель'] as const;
type SearchField = (typeof SEARCH_FIELDS)[number];

/** Разделитель ключ-значение (с пробелами вокруг дефиса). */
const SEPARATOR = ' - ';

/** Результат парсинга строки критерия. */
export interface ParsedLine {
  field: SearchField;
  value: string;
}

/**
 * Парсит строку формата `ключ - значение`.
 * @returns { field, value } при корректном формате, null — иначе.
 */
export function parseCriteriaLine(line: string): ParsedLine | null {
  const trimmed = line.trim();
  if (trimmed === '') return null;
  const sepIdx = trimmed.indexOf(SEPARATOR);
  if (sepIdx === -1) return null;
  const field = trimmed.slice(0, sepIdx).trim().toLowerCase();
  const value = trimmed.slice(sepIdx + SEPARATOR.length).trim();
  if (value === '') return null;
  if (!SEARCH_FIELDS.includes(field as SearchField)) return null;
  return { field: field as SearchField, value };
}

/**
 * Валидирует значение поля.
 * @returns null если значение валидно, иначе строку с описанием ошибки.
 */
export function validateValue(field: SearchField, value: string): string | null {
  switch (field) {
    case 'тема':
      return value.length > 0 ? null : 'тема не должна быть пустой';
    case 'дата':
      return isValidIsoDate(value) ? null : `дата должна быть в формате YYYY-MM-DD, получено: ${value}`;
    case 'отправитель':
      return isValidEmail(value) ? null : `некорректный email: ${value}`;
  }
}

/** Проверка ISO-даты YYYY-MM-DD (с валидацией реальной даты). */
function isValidIsoDate(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12) return false;
  if (d < 1 || d > 31) return false;
  // Проверка реальной даты через Date (отлавливает 31 февраля и т.п.).
  const dt = new Date(y, mo - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d;
}

/** Проверка email (простая, без полной RFC). */
function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

/**
 * Собирает критерии поиска в интерактивном мастере.
 *
 * Читает строки до пустого ввода. Каждая строка парсится через parseCriteriaLine,
 * валидируется; при ошибке просит повторить. Пустой ввод завершает сбор: если
 * введено ≥1 поля — возвращает критерии; если 0 — null (отмена).
 */
export async function promptSearchCriteria(io: ConsoleIO): Promise<SearchCriteriaInput | null> {
  const result: SearchCriteriaInput = {};
  const seen = new Set<SearchField>();
  io.write('Введите критерии поиска (по одному на строку в формате «тема - текст»):\n');
  io.write('Доступные поля: тема, дата (YYYY-MM-DD), отправитель (email). Пустая строка — завершить.\n');

  while (true) {
    io.write('> ');
    const line = await io.readline();
    if (line === null) {
      // EOF — отмена, если ничего не введено; иначе вернуть что есть.
      return Object.keys(result).length > 0 ? result : null;
    }
    if (line.trim() === '') {
      // Пустая строка — завершить сбор.
      return Object.keys(result).length > 0 ? result : null;
    }
    const parsed = parseCriteriaLine(line);
    if (!parsed) {
      io.write('Неверный формат. Используйте «ключ - значение» (напр. «тема - договор»).\n');
      continue;
    }
    if (seen.has(parsed.field)) {
      io.write(`Поле «${parsed.field}» уже введено. Пустая строка — завершить.\n`);
      continue;
    }
    const err = validateValue(parsed.field, parsed.value);
    if (err) {
      io.write(`${err}\n`);
      continue;
    }
    seen.add(parsed.field);
    applySearchField(result, parsed.field, parsed.value);
    io.write(`✓ ${parsed.field}: ${parsed.value}\n`);
  }
}

/** Применяет поле к объекту критериев. */
function applySearchField(result: SearchCriteriaInput, field: SearchField, value: string): void {
  switch (field) {
    case 'тема':
      result.subject = value;
      break;
    case 'дата':
      result.date = value;
      break;
    case 'отправитель':
      result.from = value;
      break;
  }
}

/** Поля мастера отправки (тема/текст/получатель — обязательны). */
const SEND_FIELDS = ['тема', 'текст', 'получатель'] as const;
type SendField = (typeof SEND_FIELDS)[number];

/**
 * Собирает критерии письма для отправки (тема, текст, получатель).
 * Все поля обязательны. Формат тот же: `ключ - значение`.
 */
export async function promptSendCriteria(io: ConsoleIO): Promise<SendCriteriaInput | null> {
  const subject: string[] = [];
  const text: string[] = [];
  const to: string[] = [];
  const seen = new Set<SendField>();
  io.write('Введите данные письма (по одному полю на строку в формате «тема - текст»):\n');
  io.write('Обязательные поля: тема, текст, получатель (email). Пустая строка — завершить.\n');

  while (true) {
    io.write('> ');
    const line = await io.readline();
    if (line === null) {
      return finalizeSend(subject, text, to);
    }
    if (line.trim() === '') {
      return finalizeSend(subject, text, to);
    }
    const parsed = parseSendLine(line);
    if (!parsed) {
      io.write('Неверный формат. Используйте «ключ - значение» (напр. «тема - ответ на договор»).\n');
      continue;
    }
    if (seen.has(parsed.field)) {
      io.write(`Поле «${parsed.field}» уже введено. Пустая строка — завершить.\n`);
      continue;
    }
    const err = validateSendValue(parsed.field, parsed.value);
    if (err) {
      io.write(`${err}\n`);
      continue;
    }
    seen.add(parsed.field);
    pushSendValue(parsed.field, parsed.value, subject, text, to);
    io.write(`✓ ${parsed.field}\n`);
  }
}

/** Парсит строку мастера отправки. */
function parseSendLine(line: string): { field: SendField; value: string } | null {
  const trimmed = line.trim();
  if (trimmed === '') return null;
  const sepIdx = trimmed.indexOf(SEPARATOR);
  if (sepIdx === -1) return null;
  const field = trimmed.slice(0, sepIdx).trim().toLowerCase();
  const value = trimmed.slice(sepIdx + SEPARATOR.length).trim();
  if (value === '') return null;
  if (!SEND_FIELDS.includes(field as SendField)) return null;
  return { field: field as SendField, value };
}

/** Валидирует значение поля отправки. */
function validateSendValue(field: SendField, value: string): string | null {
  switch (field) {
    case 'тема':
      return value.length > 0 ? null : 'тема не должна быть пустой';
    case 'текст':
      return value.length > 0 ? null : 'текст не должен быть пустым';
    case 'получатель':
      return isValidEmail(value) ? null : `некорректный email: ${value}`;
  }
}

/** Записывает значение в соответствующий аккумулятор. */
function pushSendValue(field: SendField, value: string, subject: string[], text: string[], to: string[]): void {
  switch (field) {
    case 'тема':
      subject.push(value);
      break;
    case 'текст':
      text.push(value);
      break;
    case 'получатель':
      to.push(value);
      break;
  }
}

/** Финализирует SendCriteriaInput или возвращает null при неполном наборе. */
function finalizeSend(subject: string[], text: string[], to: string[]): SendCriteriaInput | null {
  const s = subject[0];
  const t = text[0];
  const r = to[0];
  if (!s || !t || !r) {
    return null;
  }
  return { subject: s, text: t, to: r };
}

/**
 * Запрашивает выбор почтового аккаунта.
 * - 0 аккаунтов → null + сообщение.
 * - 1 аккаунт → авто-выбор.
 * - ≥2 аккаунтов → список + выбор по номеру.
 */
export async function promptAccount(io: ConsoleIO, accounts: MailAccount[]): Promise<MailAccount | null> {
  if (accounts.length === 0) {
    io.write('Нет настроенных почтовых аккаунтов. Настройте ACCOUNTS в .env.\n');
    return null;
  }
  if (accounts.length === 1) {
    return accounts[0] ?? null;
  }
  io.write('Выберите аккаунт:\n');
  accounts.forEach((a, i) => {
    io.write(`  ${i + 1}. ${a.login} (${a.provider})\n`);
  });
  while (true) {
    io.write('> ');
    const line = await io.readline();
    if (line === null) return null;
    const n = Number(line.trim());
    if (Number.isInteger(n) && n >= 1 && n <= accounts.length) {
      return accounts[n - 1] ?? null;
    }
    io.write(`Введите число от 1 до ${accounts.length}.\n`);
  }
}

/**
 * Запрашивает UID письма из списка найденных.
 * @returns выбранный UID или null (отмена/EOF).
 */
export async function promptUid(io: ConsoleIO, messages: EmailMessage[]): Promise<number | null> {
  io.write(`Найдено писем: ${messages.length}. Показаны первые 5:\n`);
  messages.slice(0, 5).forEach((m, i) => {
    const from = m.from?.address ?? 'неизвестно';
    io.write(`  ${i + 1}. UID=${m.uid} | ${m.subject} | ${from} | ${formatDate(m.date)}\n`);
  });
  io.write('Введите UID нужного письма (или пустую строку для отмены):\n');
  while (true) {
    io.write('> ');
    const line = await io.readline();
    if (line === null || line.trim() === '') return null;
    const uid = Number(line.trim());
    if (Number.isInteger(uid) && messages.some((m) => m.uid === uid)) {
      return uid;
    }
    io.write(`UID ${line.trim()} не найден в списке. Введите UID из показанных.\n`);
  }
}

/** Форматирует дату для вывода. */
function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Запрашивает подтверждение да/нет.
 */
export async function promptConfirm(io: ConsoleIO, question: string): Promise<boolean> {
  io.write(`${question} (да/нет)\n> `);
  const line = await io.readline();
  if (line === null) return false;
  const answer = line.trim().toLowerCase();
  return answer === 'да' || answer === 'yes' || answer === 'y' || answer === 'д';
}
