/**
 * Мастер сбора критериев для guided-команд (change guided-commands).
 *
 * Структурированный CLI-мастер: каждое поле вводится отдельной строкой в
 * формате `ключ - значение`. Валидация формата/даты/email, повтор при ошибке.
 * Работает через ConsoleIO — тестируем на MockConsoleIO.
 */
import type { ConsoleIO } from './io.js';
import type { MailAccount, MailProviderKind, AuthStrategyKind } from '../../tools/mail/types.js';
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

// === Мастер /smart-send (change cli-smart-commands) ===

/** Входные критерии /smart-send: тема, получатель, промпт для генерации тела. */
export interface SmartSendCriteriaInput {
  /** Тема письма (обязательна). */
  subject: string;
  /** Получатель (email, обязателен). */
  to: string;
  /** Произвольный промпт для генерации тела письма (обязателен). */
  prompt: string;
}

/** Поля мастера /smart-send. */
const SMART_SEND_FIELDS = ['тема', 'получатель', 'промпт'] as const;
type SmartSendField = (typeof SMART_SEND_FIELDS)[number];

/** Парсит строку мастера /smart-send. */
export function parseSmartSendLine(line: string): { field: SmartSendField; value: string } | null {
  const trimmed = line.trim();
  if (trimmed === '') return null;
  const sepIdx = trimmed.indexOf(SEPARATOR);
  if (sepIdx === -1) return null;
  const field = trimmed.slice(0, sepIdx).trim().toLowerCase();
  const value = trimmed.slice(sepIdx + SEPARATOR.length).trim();
  if (value === '') return null;
  if (!SMART_SEND_FIELDS.includes(field as SmartSendField)) return null;
  return { field: field as SmartSendField, value };
}

/** Валидирует значение поля /smart-send. Возвращает null или сообщение об ошибке. */
export function validateSmartSendValue(field: SmartSendField, value: string): string | null {
  switch (field) {
    case 'тема':
      return value.length > 0 ? null : 'тема не должна быть пустой';
    case 'получатель':
      return isValidEmail(value) ? null : `некорректный email: ${value}`;
    case 'промпт':
      return value.length > 0 ? null : 'промпт не должен быть пустым';
  }
}

/** Применяет поле к критериям /smart-send. */
function applySmartSendField(result: Partial<Record<SmartSendField, string>>, field: SmartSendField, value: string): void {
  switch (field) {
    case 'тема':
      result['тема'] = value;
      break;
    case 'получатель':
      result['получатель'] = value;
      break;
    case 'промпт':
      result['промпт'] = value;
      break;
  }
}

/**
 * Собирает критерии /smart-send в интерактивном мастере.
 *
 * Поля вводятся построчно в формате `ключ - значение` (как другие guided-команды).
 * Обязательные: тема, получатель (email), промпт (произвольный текст). Пустая
 * строка завершает сбор: все поля → генерация, иначе отмена.
 */
export async function promptSmartSendCriteria(io: ConsoleIO): Promise<SmartSendCriteriaInput | null> {
  const fields: Partial<Record<SmartSendField, string>> = {};
  const seen = new Set<SmartSendField>();
  io.write('Введите данные письма (по одному полю на строку в формате «ключ - значение»):\n');
  io.write('Обязательные поля: тема, получатель (email), промпт (инструкция для генерации тела). Пустая строка — завершить.\n');

  while (true) {
    io.write('> ');
    const line = await io.readline();
    if (line === null || line.trim() === '') return finalizeSmartSend(fields);

    const parsed = parseSmartSendLine(line);
    if (!parsed) {
      io.write('Неверный формат. Используйте «ключ - значение» (напр. «тема - ответ на договор»).\n');
      continue;
    }
    if (seen.has(parsed.field)) {
      io.write(`Поле «${parsed.field}» уже введено. Пустая строка — завершить.\n`);
      continue;
    }
    const err = validateSmartSendValue(parsed.field, parsed.value);
    if (err) {
      io.write(`${err}\n`);
      continue;
    }
    seen.add(parsed.field);
    applySmartSendField(fields, parsed.field, parsed.value);
    io.write(`✓ ${parsed.field}\n`);
  }
}

/** Финализирует SmartSendCriteriaInput или возвращает null при неполном наборе. */
function finalizeSmartSend(fields: Partial<Record<SmartSendField, string>>): SmartSendCriteriaInput | null {
  const subject = fields['тема'];
  const to = fields['получатель'];
  const prompt = fields['промпт'];
  if (!subject || !to || !prompt) {
    return null;
  }
  return { subject, to, prompt };
}

/** Действие пользователя в цикле подтверждения/правки /smart-send. */
export type SendAction =
  | { action: 'send' }
  | { action: 'cancel' }
  | { action: 'redo'; feedback: string };

/** Ключевые слова-действия (нижний регистр). */
const ACTION_SEND = ['отправить', 'да', 'yes', 'y', 'д'];
const ACTION_CANCEL = ['отмена', 'нет', 'no', 'n', 'cancel'];

/**
 * Запрашивает действие после показа черновика /smart-send.
 *
 * - `отправить`/`да` → { action: 'send' }
 * - `отмена`/`нет` → { action: 'cancel' }
 * - любой непустой текст (не совпавший с отправить/отмена) → { action: 'redo', feedback }
 * - пустой ввод → повтор запроса (EOF → cancel)
 */
export async function promptSendAction(io: ConsoleIO): Promise<SendAction> {
  io.write('Действие: «отправить» / «отмена» / либо введите промпт-правку для перегенерации тела:\n> ');
  while (true) {
    const line = await io.readline();
    if (line === null) return { action: 'cancel' };
    const trimmed = line.trim();
    if (trimmed === '') {
      io.write('Введите «отправить», «отмена» или промпт-правку:\n> ');
      continue;
    }
    const lower = trimmed.toLowerCase();
    if (ACTION_SEND.includes(lower)) return { action: 'send' };
    if (ACTION_CANCEL.includes(lower)) return { action: 'cancel' };
    return { action: 'redo', feedback: trimmed };
  }
}

// === Мастер заведения аккаунта /add-account (change mcp-env-account-credentials) ===

/** Поля мастера заведения аккаунта. */
const ADD_ACCOUNT_FIELDS = ['provider', 'login', 'password', 'authStrategy'] as const;
type AddAccountField = (typeof ADD_ACCOUNT_FIELDS)[number];

/** Допустимые значения provider. */
const PROVIDERS: readonly MailProviderKind[] = ['yandex', 'outlook'];
/** Допустимые значения authStrategy. */
const AUTH_STRATEGIES: readonly AuthStrategyKind[] = ['basic', 'oauth2'];

/** Результат сбора полей аккаунта: валидный MailAccount или null (отмена). */
export interface AddAccountInput {
  provider: MailProviderKind;
  login: string;
  password: string;
  authStrategy: AuthStrategyKind;
}

/** Парсит строку мастера заведения аккаунта. */
function parseAddAccountLine(line: string): { field: AddAccountField; value: string } | null {
  const trimmed = line.trim();
  if (trimmed === '') return null;
  const sepIdx = trimmed.indexOf(SEPARATOR);
  if (sepIdx === -1) return null;
  // НЕ приводим к нижнему регистру: имена полей ASCII camelCase (provider/authStrategy).
  const field = trimmed.slice(0, sepIdx).trim();
  const value = trimmed.slice(sepIdx + SEPARATOR.length).trim();
  if (!ADD_ACCOUNT_FIELDS.includes(field as AddAccountField)) return null;
  return { field: field as AddAccountField, value };
}

/** Валидирует значение поля аккаунта. Возвращает null или сообщение об ошибке. */
function validateAccountField(field: AddAccountField, value: string): string | null {
  switch (field) {
    case 'provider': {
      const v = value.toLowerCase();
      return PROVIDERS.includes(v as MailProviderKind)
        ? null
        : `provider должен быть yandex или outlook, получено: ${value}`;
    }
    case 'login':
      return value.length > 0 ? null : 'login не должен быть пустым';
    case 'password':
      return value.length > 0 ? null : 'password не должен быть пустым';
    case 'authStrategy': {
      const v = value.toLowerCase();
      return AUTH_STRATEGIES.includes(v as AuthStrategyKind)
        ? null
        : `authStrategy должен быть basic или oauth2, получено: ${value}`;
    }
  }
}

/**
 * Собирает поля аккаунта в интерактивном мастере /add-account.
 *
 * Поля вводятся построчно в формате `ключ - значение` (как остальные guided-команды).
 * Обязательные: provider, login, password. Опциональный: authStrategy (по умолчанию basic).
 * Пароль вводится обычным эхо-вводом (без скрытия). Пустая строка завершает сбор:
 * если введены все обязательные поля — возвращает AddAccountInput, иначе null (отмена).
 */
export async function promptAccountFields(io: ConsoleIO): Promise<AddAccountInput | null> {
  const fields: Partial<Record<AddAccountField, string>> = {};
  const seen = new Set<AddAccountField>();
  io.write('Введите данные аккаунта (по одному полю на строку в формате «ключ - значение»):\n');
  io.write('Обязательные поля: provider (yandex|outlook), login (email), password. Опц.: authStrategy (basic|oauth2). Пустая строка — завершить.\n');

  while (true) {
    io.write('> ');
    const line = await io.readline();
    if (line === null) return finalizeAccount(fields);
    if (line.trim() === '') return finalizeAccount(fields);

    const parsed = parseAddAccountLine(line);
    if (!parsed) {
      io.write('Неверный формат. Используйте «ключ - значение» (напр. «provider - yandex»).\n');
      continue;
    }
    if (seen.has(parsed.field)) {
      io.write(`Поле «${parsed.field}» уже введено. Пустая строка — завершить.\n`);
      continue;
    }
    const err = validateAccountField(parsed.field, parsed.value);
    if (err) {
      io.write(`${err}\n`);
      continue;
    }
    seen.add(parsed.field);
    // Нормализуем provider/authStrategy к нижнему регистру (пользователь мог ввести Yandex/OAuth2).
    const normalized =
      parsed.field === 'provider' || parsed.field === 'authStrategy'
        ? parsed.value.toLowerCase()
        : parsed.value;
    fields[parsed.field] = normalized;
    io.write(`✓ ${parsed.field}\n`);
  }
}

/** Финализирует AddAccountInput или возвращает null при неполном наборе. */
function finalizeAccount(fields: Partial<Record<AddAccountField, string>>): AddAccountInput | null {
  const provider = fields.provider as MailProviderKind | undefined;
  const login = fields.login;
  const password = fields.password;
  const authStrategy = (fields.authStrategy as AuthStrategyKind | undefined) ?? 'basic';
  if (!provider || !login || !password) {
    return null;
  }
  return { provider, login, password, authStrategy };
}

// === Мастер критериев /find-all (change cli-find-all-command) ===

/**
 * Входные критерии /find-all: тема и/или отправитель + опциональный диапазон
 * дат (даты — ISO `YYYY-MM-DD`, включительно с обеих сторон).
 */
export interface FindAllCriteriaInput {
  /** Тема (подстрока). Опциональна. */
  subject?: string;
  /** Отправитель (email или подстрока). Опционален. */
  from?: string;
  /** Дата «с» (ISO YYYY-MM-DD, включительно). Опц. */
  dateFrom?: string;
  /** Дата «по» (ISO YYYY-MM-DD, включительно). Опц. */
  dateTo?: string;
}

/** Поля мастера /find-all. */
const FIND_ALL_FIELDS = ['тема', 'отправитель', 'дата с', 'дата по'] as const;
type FindAllField = (typeof FIND_ALL_FIELDS)[number];

/** Парсит строку мастера /find-all. */
export function parseFindAllLine(line: string): { field: FindAllField; value: string } | null {
  const trimmed = line.trim();
  if (trimmed === '') return null;
  const sepIdx = trimmed.indexOf(SEPARATOR);
  if (sepIdx === -1) return null;
  const field = trimmed.slice(0, sepIdx).trim().toLowerCase();
  const value = trimmed.slice(sepIdx + SEPARATOR.length).trim();
  if (value === '') return null;
  if (!FIND_ALL_FIELDS.includes(field as FindAllField)) return null;
  return { field: field as FindAllField, value };
}

/**
 * Валидирует значение поля /find-all.
 * @returns null если валидно, иначе сообщение об ошибке.
 */
export function validateFindAllValue(field: FindAllField, value: string): string | null {
  switch (field) {
    case 'тема':
      return value.length > 0 ? null : 'тема не должна быть пустой';
    case 'отправитель':
      return isValidEmail(value) ? null : `некорректный email: ${value}`;
    case 'дата с':
    case 'дата по':
      return isValidIsoDate(value) ? null : `дата должна быть в формате YYYY-MM-DD, получено: ${value}`;
  }
}

/**
 * Проверяет консистентность диапазона дат: если оба поля указаны, `дата с` не
 * должна быть позже `даты по`. Возвращает null если OK, иначе сообщение.
 */
export function validateFindAllRange(input: FindAllCriteriaInput): string | null {
  if (input.dateFrom && input.dateTo) {
    const from = new Date(input.dateFrom);
    const to = new Date(input.dateTo);
    if (from.getTime() > to.getTime()) {
      return 'дата «с» должна быть не позже даты «по».';
    }
  }
  return null;
}

/** Применяет поле к критериям /find-all. */
function applyFindAllField(result: FindAllCriteriaInput, field: FindAllField, value: string): void {
  switch (field) {
    case 'тема':
      result.subject = value;
      break;
    case 'отправитель':
      result.from = value;
      break;
    case 'дата с':
      result.dateFrom = value;
      break;
    case 'дата по':
      result.dateTo = value;
      break;
  }
}

/**
 * Собирает критерии /find-all в интерактивном мастере.
 *
 * Поля вводятся построчно в формате `ключ - значение` (как другие guided-команды).
 * Все поля опциональны, но пустой ввод без единого поля — отмена. При вводе
 * обеих дат проверяется, что `дата с` не позже `даты по`; при ошибке диапазона
 * просим повторить ввод поля `дата по`. Пустая строка завершает сбор.
 */
export async function promptFindAllCriteria(io: ConsoleIO): Promise<FindAllCriteriaInput | null> {
  const result: FindAllCriteriaInput = {};
  const seen = new Set<FindAllField>();
  io.write('Введите критерии поиска (по одному на строку в формате «тема - текст»):\n');
  io.write('Доступные поля: тема, отправитель (email), дата с (YYYY-MM-DD), дата по (YYYY-MM-DD). Пустая строка — завершить.\n');

  while (true) {
    io.write('> ');
    const line = await io.readline();
    if (line === null || line.trim() === '') {
      return Object.keys(result).length > 0 ? result : null;
    }
    const parsed = parseFindAllLine(line);
    if (!parsed) {
      io.write('Неверный формат. Используйте «ключ - значение» (напр. «тема - уроки истории»).\n');
      continue;
    }
    if (seen.has(parsed.field)) {
      io.write(`Поле «${parsed.field}» уже введено. Пустая строка — завершить.
`);
      continue;
    }
    const err = validateFindAllValue(parsed.field, parsed.value);
    if (err) {
      io.write(`${err}
`);
      continue;
    }
    applyFindAllField(result, parsed.field, parsed.value);
    // Проверяем диапазон только когда введено поле «дата по» и уже есть «дата с».
    if (parsed.field === 'дата по') {
      const rangeErr = validateFindAllRange(result);
      if (rangeErr) {
        // Откатываем невалидное поле «дата по», чтобы пользователь мог ввести заново.
        delete result.dateTo;
        io.write(`${rangeErr} Повторите ввод «дата по».
`);
        continue;
      }
    }
    seen.add(parsed.field);
    io.write(`✓ ${parsed.field}: ${parsed.value}
`);
  }
}

/**
 * Нормализованные аргументы поиска для /find-all. `serverCriteria` — только
 * надёжные серверные критерии (диапазон дат); `subject`/`from` применяются
 * локально после фетча (см. design D1: серверный SEARCH Яндекса по кириллическим
 * темам ненадёжен — возвращает неполный результат, и bounded fallback тулa не
 * срабатывает, поэтому не находит все совпадения).
 */
export interface FindAllSearchArgs {
  /** Критерии, передаваемые в серверный search (только даты). */
  serverCriteria: { since?: Date; before?: Date };
  /** Локальный фильтр по теме (подстрока, case-insensitive, нормализованные пробелы). */
  subject?: string;
  /** Локальный фильтр по отправителю (подстрока, case-insensitive). */
  from?: string;
}

/** Ранняя дата-«с», когда диапазон не указан — искать по всему ящику. */
const EARLIEST_SINCE = new Date(1970, 0, 1);

/**
 * Преобразует критерии /find-all в аргументы для агрегатора:
 * - `serverCriteria` содержит ТОЛЬКО диапазон дат (`since`/`before`), без темы/отправителя —
 *   серверный SEARCH по теме ненадёжен, поэтому ищем все письма диапазона и фильтруем локально;
 * - `дата по` включительно → `before` = полночь следующего дня (тул: `msg.date >= before` → отсев);
 * - `дата с` → `since` = полночь указанного дня;
 * - если диапазон не указан → `since` = 1970-01-01 (весь ящик).
 * - `subject`/`from` остаются для локальной фильтрации (не идут на сервер).
 */
export function buildSearchArgsFromFindAll(criteria: FindAllCriteriaInput): FindAllSearchArgs {
  const server: { since?: Date; before?: Date } = {};
  if (criteria.dateFrom) {
    server.since = isoToDate(criteria.dateFrom);
  } else {
    // Диапазон не указан — ищем по всему ящику.
    server.since = EARLIEST_SINCE;
  }
  if (criteria.dateTo) {
    // «дата по» включительно → before = следующий день.
    const before = isoToDate(criteria.dateTo);
    before.setDate(before.getDate() + 1);
    server.before = before;
  }
  return {
    serverCriteria: server,
    subject: criteria.subject,
    from: criteria.from,
  };
}

/** Парсит ISO YYYY-MM-DD в локальную полночь (без сдвига часового пояса). */
export function isoToDate(iso: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return new Date(iso);
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}
