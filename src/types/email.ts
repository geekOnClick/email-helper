/**
 * Доменные типы писем и поиска.
 * Phase 1: mail-search — метаданные писем без тел.
 */

/** Адрес email (из конверта). */
export interface EmailAddress {
  name?: string;
  address: string;
}

/** Метаданные письма (без тела). */
export interface EmailMessage {
  /** UID письма в папке. */
  uid: number;
  /** Тема письма. */
  subject: string;
  /** Отправитель. */
  from?: EmailAddress;
  /** Получатели (TO). */
  to?: EmailAddress[];
  /** Внутренняя дата письма (IMAP internalDate). */
  date: Date;
  /** Флаги письма (\Seen, \Answered, \Flagged ...). */
  flags: string[];
  /** Размер письма в байтах. */
  size?: number;
  /** Папка, в которой найдено. */
  folder: string;
}

/** Направление письма (выбор папки по умолчанию). */
export type MailDirection = 'incoming' | 'outgoing';

/** Критерии поиска. Все поля опциональны, соединяются через AND. */
export interface SearchCriteria {
  /** Тема (подстрока, без учёта регистра сервером). */
  subject?: string;
  /** Отправитель (подстрока From). */
  from?: string;
  /** Получатель (подстрока To). */
  to?: string;
  /** Получено начиная с даты (IMAP SINCE). */
  since?: Date | string;
  /** Получено до даты (IMAP BEFORE). */
  before?: Date | string;
  /** Явная папка (путь). Приоритет над direction. */
  folder?: string;
  /** Направление: incoming → \Inbox, outgoing → \Sent. По умолчанию incoming. */
  direction?: MailDirection;
  /** Только непрочитанные (\Seen не установлен). */
  unseen?: boolean;
  /** Только помеченные флагом \Flagged. */
  flagged?: boolean;
  /** Только отвеченные (\Answered). */
  answered?: boolean;
  /** Максимум результатов (по умолчанию 50). */
  limit?: number;
  /** Смещение в списке UID для постраничности. */
  offset?: number;
}

/** Результат поиска. */
export interface SearchResult {
  /** Найденные метаданные писем (срез по limit). */
  messages: EmailMessage[];
  /** Общее число найденных по критериям. */
  total: number;
  /** Есть ли ещё результаты за пределами limit+offset. */
  hasMore: boolean;
}

// === mail-attachments: чтение содержимого и вложений ===

/** Метаданные вложения (без тела). */
export interface AttachmentMeta {
  /** Идентификатор части (bodyStructure part). */
  part: string;
  /** Имя файла (обеззараженное, без path-компонентов). */
  filename: string;
  /** Content-Type вложения. */
  contentType: string;
  /** Ожидаемый размер (байты), если известен. */
  size?: number;
}

/** Полное письмо: метаданные + тело + метаданные вложений. */
export interface EmailFull extends EmailMessage {
  /** Текстовое тело (text/plain; при отсутствии — text/html), UTF-8. */
  body: string;
  /** Есть ли текстовое тело. */
  hasBody: boolean;
  /** Метаданные вложений. */
  attachments: AttachmentMeta[];
  /** Заголовки (опц., при парсинге). */
  headers?: Record<string, string>;
}

/** Результат скачивания вложений. */
export interface DownloadResult {
  /** Пути скачанных файлов (абсолютные). */
  paths: string[];
  /** Папка, из которой скачано. */
  folder: string;
  /** UID письма. */
  uid: number;
}