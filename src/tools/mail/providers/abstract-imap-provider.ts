import { ImapFlow, type ImapFlowOptions, type ListResponse, type SearchObject, type FetchQueryObject, type FetchMessageObject } from 'imapflow';
import { simpleParser } from 'mailparser';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { MailProvider, AuthStrategy } from '../mail-provider.js';
import { redact } from '../redact.js';
import { resolveFolder } from '../folder-resolver.js';
import { toEmailMessage } from '../email-mapper.js';
import { extractAttachments } from '../attachments.js';
import { ensureDir } from '../fs.js';
import { uniqueFilename, isInsideDir, ensureExtension } from '../filename.js';
import type {
  ConnectionResult,
  Folder,
  ImapClient,
  ImapConnectionOptions,
  MailAccount,
  MailProviderKind,
} from '../types.js';
import type { SearchCriteria, SearchResult, EmailMessage, EmailAddress, EmailFull, DownloadResult, MailOpOptions } from '../../../types/email.js';

/** Фабрика IMAP-клиента. По умолчанию ImapFlow; в тестах подменяется. */
export type ImapClientFactory = (options: ImapFlowOptions) => ImapClient;

const defaultFactory: ImapClientFactory = (options) =>
  new ImapFlow(options) as unknown as ImapClient;

/** Ошибка «подключение не установлено» — доменный класс. */
export class ConnectError extends Error {}

function looksLikeAuthFailure(err: unknown): boolean {
  const msg = String((err as { message?: string })?.message ?? err).toUpperCase();
  return (
    msg.includes('AUTHENTICATE') ||
    msg.includes('AUTHENTICATIONFAILED') ||
    msg.includes('AUTH') && msg.includes('FAILED')
  );
}

/**
 * Базовая реализация MailProvider поверх ImapFlow.
 * Инкапсулирует общий lifecycle: connect (через стратегию), listFolders, dispose.
 * Конкретные провайдеры задают host/port/secure и стратегию по умолчанию.
 */
export abstract class AbstractImapProvider implements MailProvider {
  protected client: ImapClient | null = null;
  protected account: MailAccount | null;
  protected strategy: AuthStrategy;
  protected readonly clientFactory: ImapClientFactory;

  constructor(opts: { account: MailAccount; strategy: AuthStrategy; clientFactory?: ImapClientFactory }) {
    this.account = opts.account;
    this.strategy = opts.strategy;
    this.clientFactory = opts.clientFactory ?? defaultFactory;
  }

  /** Параметры соединения, специфичные для провайдера. */
  protected abstract get connection(): ImapConnectionOptions;
  abstract get providerKind(): MailProviderKind;

  async connect(): Promise<ConnectionResult> {
    if (this.account === null) {
      throw new ConnectError('провайдер закрыт (dispose уже вызван)');
    }
    if (this.client) {
      return { connected: true, accountId: this.accountId(), provider: this.providerKind };
    }
    return await this.tryConnect(this.strategy);
  }

  /**
   * Пытается подключиться с заданной стратегией. При ошибке аутентификации
   * выбрасывает ConnectError с редуцированным сообщением.
   */
  protected async tryConnect(strategy: AuthStrategy): Promise<ConnectionResult> {
    const account = this.requireAccount();
    const imapOpts = await strategy.getImapAuth(account, this.connection);
    const client = this.clientFactory(imapOpts);
    try {
      await client.connect();
    } catch (err) {
      try {
        await client.logout();
      } catch {
        // освобождение после ошибки не релевантно
      }
      throw new ConnectError(this.sanitizeConnectError(err));
    }
    this.client = client;
    return { connected: true, accountId: this.accountId(), provider: this.providerKind };
  }

  async listFolders(options?: Partial<MailOpOptions>): Promise<Folder[]> {
    const opts = this.resolveOpOptions(options);
    return this.runWithTimeoutAndRetry(() => this.listFoldersAttempt(), opts);
  }

  /** Тело listFolders без таймаута/retry (вызывается через runWithTimeoutAndRetry). */
  protected async listFoldersAttempt(): Promise<Folder[]> {
    const client = this.requireClient();
    const list = await client.list();
    return list.map((r: ListResponse) => {
      const flags = Array.from(r.flags);
      // Яндекс (и др.) кладут \Inbox/\Sent/... в specialUse, а не в flags —
      // нормализуем, чтобы доменный Folder.flags содержал спецфлаги.
      if (r.specialUse && !flags.includes(r.specialUse)) {
        flags.push(r.specialUse);
      }
      return { name: r.name, path: r.path, delimiter: r.delimiter, flags };
    });
  }

  async search(criteria: SearchCriteria, options?: Partial<MailOpOptions>): Promise<SearchResult> {
    const opts = this.resolveOpOptions(options);
    return this.runWithTimeoutAndRetry(() => this.searchAttempt(criteria, opts), opts);
  }

  /** Тело поиска без таймаута/retry (вызывается через runWithTimeoutAndRetry). */
  protected async searchAttempt(
    criteria: SearchCriteria,
    opts: MailOpOptions,
  ): Promise<SearchResult> {
    const client = this.requireClient();
    const account = this.requireAccount();
    try {
      // 1. разрешаем папку (явная / direction / по умолчанию incoming)
      const folders = await this.listFoldersAttempt();
      const folderPath = resolveFolder(criteria, folders);
      await client.mailboxOpen(folderPath, { readOnly: true });

      // 2. серверный поиск по полному query (включая subject).
      const query = this.buildSearchObject(criteria);
      const uids = await client.search(query, { uid: true });

      // 2b. Client-side fallback: серверный SEARCH Яндекса по длинным кириллическим
      // SUBJECT-литералам ненадёжен (возвращает 0 даже при совпадении). Если серверный
      // поиск по текстовому критерию пуст — сужаем надёжными критериями (since/before/
      // from/to/флаги) или SINCE по умолчанию, и фетчим метаданные только по суженному
      // набору (не по всей папке). См. design D1.
      let effectiveUids = uids;
      if (effectiveUids.length === 0 && this.hasTextCriteria(criteria)) {
        const narrowedQuery = this.buildNarrowedQuery(criteria, opts.fallbackDays);
        effectiveUids = await client.search(narrowedQuery, { uid: true });
      }
      const total = effectiveUids.length;

      // 3. limit/offset
      const limit = criteria.limit ?? 50;
      const offset = criteria.offset ?? 0;
      const slice = effectiveUids.slice(offset, offset + limit);
      const hasMore = offset + limit < total;

      if (slice.length === 0) {
        return { messages: [], total, hasMore };
      }

      // 4. fetch метаданных по UID'ам
      const range = slice.join(',');
      const fetchQuery: FetchQueryObject = {
        uid: true,
        envelope: true,
        internalDate: true,
        flags: true,
        size: true,
      };
      const rows = await client.fetchAll(range, fetchQuery, { uid: true });
      // D2: ВСЕГДА дофильтровываем серверный результат локально — сервер может
      // применить только часть текстовых критериев (напр. только SINCE).
      const messages = rows
        .map((r: FetchMessageObject) => toEmailMessage(r, folderPath))
        .filter((m) => this.matchesCriteria(m, criteria));

      return { messages, total, hasMore };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new ConnectError(redact(message, account.password, account.login));
    }
  }

  /** Маппит доменные критерии в SearchObject imapflow. */
  protected buildSearchObject(criteria: SearchCriteria): SearchObject {
    const q: SearchObject = {};
    if (criteria.subject) q.subject = criteria.subject;
    if (criteria.from) q.from = criteria.from;
    if (criteria.to) q.to = criteria.to;
    if (criteria.since) q.since = criteria.since;
    if (criteria.before) q.before = criteria.before;
    if (criteria.unseen === true) q.seen = false;
    if (criteria.flagged === true) q.flagged = true;
    if (criteria.answered === true) q.answered = true;
    return q;
  }

  /** Есть ли текстовые критерии (subject/from/to/body), которые могут не искаться сервером. */
  protected hasTextCriteria(criteria: SearchCriteria): boolean {
    return Boolean(criteria.subject || criteria.from || criteria.to);
  }

  /**
   * Суженный серверный запрос для fallback (design D1): берёт надёжные критерии
   * (since/before/from/to/флаги) без subject. Если надёжных нет — добавляет
   * SINCE = now - fallbackDays, чтобы не фетчить весь ящик.
   */
  protected buildNarrowedQuery(criteria: SearchCriteria, fallbackDays: number): SearchObject {
    const q: SearchObject = {};
    if (criteria.from) q.from = criteria.from;
    if (criteria.to) q.to = criteria.to;
    if (criteria.since) q.since = new Date(criteria.since);
    if (criteria.before) q.before = new Date(criteria.before);
    if (criteria.unseen === true) q.seen = false;
    if (criteria.flagged === true) q.flagged = true;
    if (criteria.answered === true) q.answered = true;
    // нет надёжных критериев → SINCE по умолчанию (bounded fallback)
    if (!q.from && !q.to && !q.since && !q.before && q.seen === undefined && q.flagged === undefined && q.answered === undefined) {
      const since = new Date();
      since.setDate(since.getDate() - fallbackDays);
      q.since = since;
    }
    return q;
  }

  /** Проверка письма против всех критериев (локальный AND). */
  protected matchesCriteria(msg: EmailMessage, criteria: SearchCriteria): boolean {
    const subj = (msg.subject ?? '').toLowerCase();
    if (criteria.subject && !subj.includes(criteria.subject.toLowerCase())) return false;

    const fromAddr = (msg.from?.address ?? '').toLowerCase();
    const fromName = (msg.from?.name ?? '').toLowerCase();
    const fromAll = `${fromAddr} ${fromName}`;
    if (criteria.from) {
      const f = criteria.from.toLowerCase();
      if (!fromAll.includes(f)) return false;
    }

    if (criteria.to) {
      const t = criteria.to.toLowerCase();
      const toAll = (msg.to ?? []).map((a: EmailAddress) => `${a.address} ${a.name ?? ''}`.toLowerCase()).join(' ');
      if (!toAll.includes(t)) return false;
    }

    if (criteria.since) {
      const since = new Date(criteria.since);
      if (!Number.isNaN(since.getTime()) && msg.date < since) return false;
    }
    if (criteria.before) {
      const before = new Date(criteria.before);
      if (!Number.isNaN(before.getTime()) && msg.date >= before) return false;
    }

    const flags = msg.flags;
    if (criteria.unseen === true && flags.includes('\\Seen')) return false;
    if (criteria.flagged === true && !flags.includes('\\Flagged')) return false;
    if (criteria.answered === true && !flags.includes('\\Answered')) return false;

    return true;
  }

  async fetch(
    uid: number,
    folder?: string,
    options?: Partial<MailOpOptions>,
  ): Promise<EmailFull> {
    const opts = this.resolveOpOptions(options);
    return this.runWithTimeoutAndRetry(() => this.fetchAttempt(uid, folder), opts);
  }

  /** Тело fetch без таймаута/retry. */
  protected async fetchAttempt(uid: number, folder?: string): Promise<EmailFull> {
    const client = this.requireClient();
    const account = this.requireAccount();
    try {
      const folderPath = await this.resolveFolderForOp(folder, 'incoming');
      await client.mailboxOpen(folderPath, { readOnly: true });

      const rows = await client.fetchAll(
        String(uid),
        { uid: true, source: true, bodyStructure: true, envelope: true, internalDate: true, flags: true, size: true },
        { uid: true },
      );
      const row = rows[0];
      if (!row) {
        throw new ConnectError(`письмо ${uid} не найдено в ${folderPath}`);
      }

      // парсинг rfc822 source через mailparser
      let body = '';
      let hasBody = false;
      if (row.source) {
        const parsed = await simpleParser(row.source);
        const text = parsed.text ?? '';
        const html = typeof parsed.html === 'string' ? parsed.html : '';
        body = text || html;
        hasBody = body.length > 0;
      }

      const attachments = extractAttachments(row.bodyStructure);
      const base = toEmailMessage(row, folderPath);
      return { ...base, body, hasBody, attachments };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new ConnectError(redact(message, account.password, account.login));
    }
  }

  async downloadAttachments(
    uid: number,
    targetDir: string,
    options?: { folder?: string; names?: string[] } & Partial<MailOpOptions>,
  ): Promise<DownloadResult> {
    const opts = this.resolveOpOptions(options);
    return this.runWithTimeoutAndRetry(() => this.downloadAttempt(uid, targetDir, options), opts);
  }

  /** Тело downloadAttachments без таймаута/retry. */
  protected async downloadAttempt(
    uid: number,
    targetDir: string,
    options?: { folder?: string; names?: string[] },
  ): Promise<DownloadResult> {
    const client = this.requireClient();
    const account = this.requireAccount();
    try {
      const folderPath = await this.resolveFolderForOp(options?.folder, 'incoming');
      await client.mailboxOpen(folderPath, { readOnly: true });

      // 1. bodyStructure для списка вложений
      const rows = await client.fetchAll(
        String(uid),
        { uid: true, bodyStructure: true },
        { uid: true },
      );
      const row = rows[0];
      if (!row) {
        throw new ConnectError(`письмо ${uid} не найдено в ${folderPath}`);
      }

      const allAtts = extractAttachments(row.bodyStructure);
      // фильтр по names (имена), если задано
      const namesFilter = options?.names;
      const wanted = namesFilter && namesFilter.length > 0
        ? allAtts.filter((a) => namesFilter.includes(a.filename))
        : allAtts;

      if (wanted.length === 0) {
        return { paths: [], folder: folderPath, uid };
      }

      // 2. downloadMany по part'ам
      const parts = wanted.map((a) => a.part);
      const downloaded = await client.downloadMany(String(uid), parts, { uid: true });

      // 3. запись в targetDir с безопасными именами
      const absDir = await ensureDir(targetDir);
      const paths: string[] = [];
      for (const att of wanted) {
        const dl = downloaded[att.part];
        if (!dl) continue;
        // meta типизирован как Record<string, unknown> (см. types.ts ImapClient.downloadMany),
        // поэтому поля фильтруем через typeof. Приоритет: имя из реального потока
        // (meta.filename, декодированное libmime) над именем из bodyStructure (att.filename).
        // Затем восстанавливаем расширение, если оно слиплось или отсутствует (design.md D1–D3).
        const metaFilename = typeof dl.meta?.filename === 'string' ? dl.meta.filename : undefined;
        const metaContentType = typeof dl.meta?.contentType === 'string' ? dl.meta.contentType : undefined;
        const rawName = metaFilename || att.filename;
        const withExt = ensureExtension(rawName, metaContentType);
        const safeName = await uniqueFilename(absDir, withExt);
        const target = join(absDir, safeName);
        if (!isInsideDir(target, absDir)) {
          throw new ConnectError(`небезопасный путь: ${safeName}`);
        }
        await writeFile(target, dl.content);
        paths.push(target);
      }
      return { paths, folder: folderPath, uid };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new ConnectError(redact(message, account.password, account.login));
    }
  }

  /** Разрешение папки для fetch/download (folder или direction по умолчанию). */
  protected async resolveFolderForOp(folder: string | undefined, direction: 'incoming' | 'outgoing'): Promise<string> {
    if (folder) return folder;
    // Вызываем attempt без обёртки timeout/retry — операция-родитель уже обёрнута.
    const folders = await this.listFoldersAttempt();
    return resolveFolder({ direction }, folders);
  }

  // === Устойчивость IMAP-операций (change mail-search-robustness) ===

  /** Дефолты опций устойчивости (для прямых вызовов без явных options). */
  protected resolveOpOptions(options?: Partial<MailOpOptions>): MailOpOptions {
    return {
      timeoutMs: options?.timeoutMs ?? 30000,
      maxRetries: options?.maxRetries ?? 1,
      fallbackDays: options?.fallbackDays ?? 180,
    };
  }

  /**
   * Классифицирует ошибку как сетевой обрыв (для retry с переподключением).
   * «подключение не установлено» (нет сессии изначально) НЕ считается connection-
   * ошибкой — retry через reconnect не поможет, если connect не вызывался.
   */
  protected isConnectionError(err: unknown): boolean {
    if (err instanceof ConnectError) {
      const msg = err.message.toLowerCase();
      // ошибки аутентификации — не connection (retry не поможет)
      if (msg.includes('auth') && msg.includes('fail')) return false;
      // «письмо N не найдено» — логическая ошибка, не сеть
      if (msg.includes('не найдено')) return false;
    }
    const msg = String((err as { message?: string })?.message ?? err).toLowerCase();
    if (msg.includes('timeout') || msg.includes('превышен таймаут')) return true;
    if (msg.includes('подключение не установлено')) return true;
    return [
      'connection not available',
      'econnreset',
      'enotfound',
      'etimedout',
      'socket hang up',
      'imap connection',
      'connection closed',
      'read econnreset',
      'getaddrinfo enotfound',
      'connection terminated',
      'stream destroyed',
    ].some((s) => msg.includes(s));
  }

  /**
   * Мягкий reconnect для retry: закрывает старый client (logout) и открывает новый
   * через tryConnect, НЕ обнуляя this.account (design D3). После reconnect
   * операция повторяется.
   *
   * Публичный (change mail-connection-self-healing): внешние потребители
   * (guided-команды CLI, SessionStore) могут прозрачно поднять упавшее в простое
   * соединение до операции. Не реентерабелен — не вызывать параллельно с операциями.
   */
  async reconnect(): Promise<void> {
    const oldClient = this.client;
    this.client = null;
    if (oldClient) {
      try {
        await oldClient.logout();
      } catch {
        // старое соединение уже мертво — освобождение не релевантно
      }
    }
    await this.tryConnect(this.strategy);
  }

  /**
   * Обёртка операции таймаутом + retry с переподключением (design D3).
   * Одна попытка в Promise.race с timeout; при таймауте — logout + client=null
   * (ошибка таймаута трактуется как connection-error → retry). При connection-
   * ошибке и оставшихся попытках — reconnect + повтор. Не-connection ошибка
   * выбрасывается сразу. При исчерпании — ConnectError с маскировкой секретов.
   */
  protected async runWithTimeoutAndRetry<T>(
    op: () => Promise<T>,
    opts: MailOpOptions,
  ): Promise<T> {
    const maxAttempts = opts.maxRetries + 1;
    let lastErr: unknown;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        return await this.runWithTimeout(op, opts.timeoutMs);
      } catch (err) {
        lastErr = err;
        if (!this.isConnectionError(err)) throw err;
        if (attempt + 1 < maxAttempts) {
          await this.reconnect();
          continue;
        }
      }
    }
    // Маскируем секреты, если аккаунт ещё доступен (не disposed).
    const account = this.account;
    const message = lastErr instanceof Error ? lastErr.message : String(lastErr);
    if (account) {
      throw new ConnectError(redact(message, account.password, account.login));
    }
    throw new ConnectError(message);
  }

  /** Promise.race(op, timeout) с принудительным logout при таймауте. */
  protected async runWithTimeout<T>(op: () => Promise<T>, timeoutMs: number): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new ConnectError(`превышен таймаут операции (${timeoutMs}мс)`)),
        timeoutMs,
      );
    });
    try {
      return await Promise.race([op(), timeout]);
    } catch (err) {
      // При таймауте разрываем висящую IMAP-команду logout'ом (Promise.race
      // не отменяет underlying-вызов imapflow).
      if (err instanceof ConnectError && err.message.includes('превышен таймаут')) {
        const oldClient = this.client;
        this.client = null;
        if (oldClient) {
          oldClient.logout().catch(() => undefined);
        }
      }
      throw err;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async dispose(): Promise<void> {
    const client = this.client;
    this.client = null;
    if (client) {
      try {
        await client.logout();
      } catch {
        // освобождение после ошибки не релевантно
      }
    }
    // Очистка учётных данных из памяти: обнуляем ссылку на аккаунт, чтобы
    // пароль стал недостижим и был собран GC. После dispose провайдер
    // непригоден к использованию (connect выбросит ошибку «закрыт»).
    this.account = null;
  }
  protected accountId(): string {
    return this.account?.login ?? '(disposed)';
  }

  protected requireClient(): ImapClient {
    if (!this.client) {
      throw new ConnectError(
        `подключение не установлено для ${this.accountId()} (${this.providerKind})`,
      );
    }
    return this.client;
  }

  /**
   * Пригодно ли соединение для использования без сетевых операций (change
   * mail-connection-self-healing). Возвращает `true` только если клиент
   * инициирован и нижележащее соединение пригодно (imapflow `client.usable ===
   * true`). Толерантен к `this.client === null` (возвращает `false`).
   */
  isConnectionUsable(): boolean {
    return this.client !== null && this.client.usable === true;
  }

  /** Аккаунт активной (не disposed) сессии. Бросает, если провайдер закрыт. */
  protected requireAccount(): MailAccount {
    if (this.account === null) {
      throw new ConnectError('провайдер закрыт (dispose уже вызван)');
    }
    return this.account;
  }

  /** Читабельное сообщение об ошибке подключения без секретов. */
  protected sanitizeConnectError(err: unknown): string {
    const account = this.requireAccount();
    const e = err as { message?: string; responseStatus?: unknown; responseText?: unknown };
    const msg = e?.message ?? String(err);
    const status = e?.responseStatus;
    const text = e?.responseText;
    if (text) {
      const detail = status ? `${String(status)}: ${String(text)}` : String(text);
      return redact(detail, account.password, account.login);
    }
    return redact(msg, account.password, account.login);
  }

  protected isAuthFailure(err: unknown): boolean {
    return looksLikeAuthFailure(err);
  }
}