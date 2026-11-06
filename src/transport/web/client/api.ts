/**
 * Типизированный API-клиент для веб-SPA (change web-interface, design D5).
 *
 * Обёртки над `fetch` для всех REST-эндпоинтов. Обработка ошибок: при
 * неуспешном HTTP-ответе бросает `ApiError` с сообщением из `{ error, code? }`.
 */

/** Публичное представление аккаунта (без пароля). */
export interface AccountPublic {
  login: string;
  provider: 'yandex' | 'outlook' | 'mail';
  authStrategy: 'basic' | 'oauth2';
}

/** Папка ящика. */
export interface Folder {
  name: string;
  path: string;
  delimiter: string;
  flags: string[];
}

/** Адрес email. */
export interface EmailAddress {
  name?: string;
  address: string;
}

/** Метаданные письма (без тела). */
export interface EmailMessage {
  uid: number;
  subject: string;
  from?: EmailAddress;
  to?: EmailAddress[];
  date: string;
  flags: string[];
  size?: number;
  folder: string;
}

/** Полное письмо (с телом и вложениями). */
export interface EmailFull {
  uid: number;
  subject: string;
  from?: EmailAddress;
  to?: EmailAddress[];
  date: string;
  flags: string[];
  size?: number;
  folder: string;
  body: string;
  hasBody: boolean;
  attachments: { part: string; filename: string; size?: number; contentType?: string }[];
}

/** Результат smart-search. */
export interface SmartSearchResult {
  messages: EmailMessage[];
  count: number;
  truncated: boolean;
}

/** Результат анализа. */
export interface AnalyzeResult {
  analysis: string;
  email?: EmailFull;
  messages?: EmailMessage[];
  totalFound?: number;
  truncatedByEmails?: boolean;
  truncatedByPagination?: boolean;
  attachmentCount?: number;
  skipped?: { filename: string; reason?: string }[];
  analysisError?: string;
}

/** Ошибка API. */
export class ApiError extends Error {
  code?: string;
  status: number;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

/** Базовый запрос с JSON. */
async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    throw new ApiError(`невалидный JSON-ответ: ${text}`, res.status);
  }
  if (!res.ok) {
    const e = data as { error?: string; code?: string } | null;
    throw new ApiError(e?.error ?? `HTTP ${res.status}`, res.status, e?.code);
  }
  return data as T;
}

/** `GET /api/accounts`. */
export const getAccounts = (): Promise<AccountPublic[]> => request('GET', '/api/accounts');

/** `POST /api/accounts`. */
export const createAccount = (dto: {
  provider: string;
  login: string;
  password: string;
  authStrategy?: string;
}): Promise<AccountPublic> => request('POST', '/api/accounts', dto);

/** `GET /api/folders/:accountLogin`. */
export const getFolders = (accountLogin: string): Promise<Folder[]> =>
  request('GET', `/api/folders/${encodeURIComponent(accountLogin)}`);

/** `POST /api/smart-search`. */
export const smartSearch = (dto: {
  accountLogin: string;
  prompt: string;
}): Promise<SmartSearchResult> => request('POST', '/api/smart-search', dto);

/** `POST /api/search` (прямой поиск по критериям тема/отправитель/дата). */
export const searchEmails = (dto: {
  accountLogin: string;
  criteria: { subject?: string; from?: string; date?: string };
}): Promise<SmartSearchResult> => request('POST', '/api/search', dto);

/** `GET /api/emails/:accountLogin/:uid`. */
export const getEmail = (accountLogin: string, uid: number, folder?: string): Promise<EmailFull> =>
  request('GET', `/api/emails/${encodeURIComponent(accountLogin)}/${uid}${folder ? `?folder=${encodeURIComponent(folder)}` : ''}`);

/** `POST /api/analyze`. */
export const analyze = (dto: { accountLogin: string; uid: number; folder?: string }): Promise<AnalyzeResult> =>
  request('POST', '/api/analyze', dto);

/** `POST /api/analyze-many`. */
export const analyzeMany = (dto: {
  accountLogin: string;
  criteria: { subject?: string; from?: string; dateFrom?: string; dateTo?: string };
}): Promise<AnalyzeResult> => request('POST', '/api/analyze-many', dto);

/** `POST /api/analyze-attachments`. */
export const analyzeAttachments = (dto: { accountLogin: string; uid: number }): Promise<AnalyzeResult> =>
  request('POST', '/api/analyze-attachments', dto);

/** `POST /api/smart-send/generate`. */
export const smartSendGenerate = (dto: {
  accountLogin: string;
  to: string;
  subject: string;
  prompt: string;
}): Promise<{ body: string }> => request('POST', '/api/smart-send/generate', dto);

/** `POST /api/smart-send/send`. */
export const smartSendSend = (dto: {
  accountLogin: string;
  to: string;
  subject: string;
  body: string;
}): Promise<{ sent: boolean }> => request('POST', '/api/smart-send/send', dto);

/** URL скачивания вложения (для `<a href>` / `window.open`). */
export const attachmentDownloadUrl = (accountLogin: string, uid: number, filename: string): string =>
  `/api/attachments/${encodeURIComponent(accountLogin)}/${uid}/${encodeURIComponent(filename)}`;
