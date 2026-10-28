import type {
  ListResponse,
  SearchObject,
  FetchQueryObject,
  FetchMessageObject,
  MailboxObject,
  DownloadObject,
  SequenceString,
} from 'imapflow';
import type { Account, AuthStrategy } from '../../config/schema.js';

/** Тип провайдера почты. */
export type MailProviderKind = 'yandex' | 'outlook';

/** Учётная запись почтового аккаунта (расширенный Account из конфига). */
export type MailAccount = Account;

/** Вид стратегии аутентификации. */
export type AuthStrategyKind = AuthStrategy;

/** IMAP-папка ящика. */
export interface Folder {
  /** Отображаемое имя (последний сегмент пути). */
  name: string;
  /** Полный путь папки. */
  path: string;
  /** Разделитель пути (обычно '.' или '/'). */
  delimiter: string;
  /** Флаги папки, включая специальные (\Inbox, \Sent, \Drafts ...). */
  flags: string[];
}

/** Результат подключения к ящику. */
export interface ConnectionResult {
  connected: boolean;
  accountId: string;
  provider: MailProviderKind;
}

/**
 * Минимальный интерфейс IMAP-клиента, используемый провайдерами.
 * Сужение реального ImapFlow до реально используемых методов — для моков в тестах.
 */
export interface ImapClient {
  connect(): Promise<void>;
  logout(): Promise<void>;
  list(options?: { status?: boolean }): Promise<ListResponse[]>;
  /** Открыть папку для последующих search/fetch. */
  mailboxOpen(path: string, options?: { readOnly?: boolean }): Promise<MailboxObject>;
  /** Поиск писем в текущей папке. Возвращает UID'ы (при opts.uid=true). */
  search(query: SearchObject, options?: { uid?: boolean }): Promise<number[]>;
  /** Выгрузка метаданных писем по диапазону/UID'ам. */
  fetchAll(
    range: string | number[] | SearchObject,
    query: FetchQueryObject,
    options?: { uid?: boolean },
  ): Promise<FetchMessageObject[]>;
  /** Скачать всё rfc822-письмо или конкретную часть (Stream). */
  download(
    range: SequenceString,
    part?: string,
    options?: { uid?: boolean; maxBytes?: number; chunkSize?: number },
  ): Promise<DownloadObject>;
  /** Скачать несколько частей (Buffers) по part-идентификаторам. */
  downloadMany(
    range: SequenceString,
    parts: string[],
    options?: { uid?: boolean },
  ): Promise<{ [key: string]: { content: Buffer; meta: Record<string, unknown> } }>;
}

/** Опции IMAP-соединения, формируемые стратегией аутентификации. */
export interface ImapConnectionOptions {
  host: string;
  port: number;
  secure: boolean;
  disableAutoIdle?: boolean;
  logger?: false;
}