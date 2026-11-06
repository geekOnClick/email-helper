/**
 * Типизированные DTO для REST API веб-транспорта (change web-interface, design D5).
 *
 * Ответы — JSON: успех → доменный объект, ошибка → `{ error, code? }`.
 * Пароли всегда исключены из DTO (см. спеку, безопасность).
 */
import type { MailProviderKind, AuthStrategyKind } from '../../../tools/mail/types.js';

/** Публичное представление аккаунта (без пароля) — для `GET /api/accounts`. */
export interface AccountPublicDto {
  login: string;
  provider: MailProviderKind;
  authStrategy: AuthStrategyKind;
}

/** Тело `POST /api/accounts` (добавление аккаунта). */
export interface CreateAccountDto {
  provider: MailProviderKind;
  login: string;
  password: string;
  authStrategy?: AuthStrategyKind;
}

/** Тело `POST /api/smart-search`. */
export interface SmartSearchDto {
  accountLogin: string;
  prompt: string;
  fallbackDays?: number;
  maxEmails?: number;
}

/** Тело `POST /api/search` (прямой поиск по структурированным критериям). */
export interface SearchDto {
  accountLogin: string;
  /** Критерии: тема (подстрока), отправитель (email), дата (ISO YYYY-MM-DD, один день включительно). */
  criteria: {
    subject?: string;
    from?: string;
    date?: string;
  };
}

/** Тело `POST /api/analyze`. */
export interface AnalyzeDto {
  accountLogin: string;
  uid: number;
  folder?: string;
}

/** Тело `POST /api/analyze-many`. */
export interface AnalyzeManyDto {
  accountLogin: string;
  criteria: {
    subject?: string;
    from?: string;
    dateFrom?: string;
    dateTo?: string;
  };
  maxEmails?: number;
}

/** Тело `POST /api/analyze-attachments`. */
export interface AnalyzeAttachmentsDto {
  accountLogin: string;
  uid: number;
  folder?: string;
}

/** Тело `POST /api/smart-send/generate`. */
export interface SmartSendGenerateDto {
  accountLogin: string;
  to: string;
  subject: string;
  prompt: string;
  body?: string;
  feedback?: string;
}

/** Тело `POST /api/smart-send/send`. */
export interface SmartSendSendDto {
  accountLogin: string;
  to: string;
  subject: string;
  body: string;
}

/** Унифицированная форма ошибки API. */
export interface ApiError {
  error: string;
  code?: string;
}

/** Помощник: сериализация доменного письма для JSON (Date → ISO-строка). */
export function emailDateToIso(date: Date): string {
  return date.toISOString();
}
