import type { ImapFlowOptions } from 'imapflow';
import type {
  ConnectionResult,
  Folder,
  ImapConnectionOptions,
  MailAccount,
} from './types.js';
import type { SearchCriteria, SearchResult, EmailFull, DownloadResult } from '../../types/email.js';

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