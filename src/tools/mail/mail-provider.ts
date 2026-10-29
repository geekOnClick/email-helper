import type { ImapFlowOptions } from 'imapflow';
import type {
  ConnectionResult,
  Folder,
  ImapConnectionOptions,
  MailAccount,
} from './types.js';
import type { SearchCriteria, SearchResult, EmailFull, DownloadResult } from '../../types/email.js';

/** Параметры SMTP-соединения (host/port/secure), специфичные для провайдера. */
export interface SmtpConnectionOptions {
  host: string;
  port: number;
  /** true = неявный TLS (465); false = STARTTLS (587). */
  secure: boolean;
}

/**
 * Аутентификация для SMTP (nodemailer-совместимая).
 * basic → { user, pass }; oauth2 (XOAUTH2) → { user, accessToken }.
 */
export interface SmtpAuth {
  user: string;
  pass?: string;
  accessToken?: string;
}

/**
 * Стратегия аутентификации для IMAP.
 * Реализации: BasicAuthStrategy, OAuth2MsalStrategy.
 * Возвращает часть опций ImapFlow с auth + базовыми настройками соединения.
 * Архитектура «стратегия» позволяет добавлять способы аутентификации
 * без изменения провайдера/логики подключения.
 */
export interface AuthStrategy {
  /** Вид стратегии для интроспекции/логов (без секретов). */
  readonly kind: 'basic' | 'oauth2';
  /**
   * Возвращает опции ImapFlow (auth + connection) для данного аккаунта.
   * Может инициировать интерактивный flow (device code) при отсутствии токена.
   */
  getImapAuth(account: MailAccount, connection: ImapConnectionOptions): Promise<ImapFlowOptions>;
  /**
   * Возвращает аутентификацию для SMTP (nodemailer): basic → {user, pass},
   * oauth2 → {user, accessToken}. Переиспользует те же учётные данные/токены,
   * что и IMAP (одна стратегия = одни credentials для обоих протоколов).
   */
  getSmtpAuth(account: MailAccount, connection: SmtpConnectionOptions): Promise<SmtpAuth>;
}

/**
 * Почтовый провайдер. Реализации: YandexMailProvider, OutlookMailProvider.
 */
export interface MailProvider {
  /** Подключение к ящику. Открывает IMAP-сессию. */
  connect(): Promise<ConnectionResult>;
  /** Список папок ящика (требует активную сессию). */
  listFolders(): Promise<Folder[]>;
  /** Поиск писем по критериям в указанной папке. Требует активную сессию. */
  search(criteria: SearchCriteria): Promise<SearchResult>;
  /** Чтение письма по UID: тело + метаданные вложений. */
  fetch(uid: number, folder?: string): Promise<EmailFull>;
  /** Скачивание вложений письма в локальный каталог. */
  downloadAttachments(
    uid: number,
    targetDir: string,
    options?: { folder?: string; names?: string[] },
  ): Promise<DownloadResult>;
  /** Закрытие сессии, освобождение соединения. */
  dispose(): Promise<void>;
}

/** Преобразует ListResponse imapflow в доменный Folder. */
export function toFolder(r: import('imapflow').ListResponse): Folder {
  return {
    name: r.name,
    path: r.path,
    delimiter: r.delimiter,
    flags: Array.from(r.flags),
  };
}