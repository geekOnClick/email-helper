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
import { uniqueFilename, isInsideDir } from '../filename.js';
import type {
  ConnectionResult,
  Folder,
  ImapClient,
  ImapConnectionOptions,
  MailAccount,
  MailProviderKind,
} from '../types.js';
import type { SearchCriteria, SearchResult, EmailMessage, EmailAddress, EmailFull, DownloadResult } from '../../../types/email.js';

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
  protected readonly account: MailAccount;
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
    const imapOpts = await strategy.getImapAuth(this.account, this.connection);
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

  async listFolders(): Promise<Folder[]> {
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

  async search(criteria: SearchCriteria): Promise<SearchResult> {
    const client = this.requireClient();
    try {
      // 1. разрешаем папку (явная / direction / по умолчанию incoming)
      const folders = await this.listFolders();
      const folderPath = resolveFolder(criteria, folders);
      await client.mailboxOpen(folderPath, { readOnly: true });

      // 2. строим SearchObject из критериев (AND по умолчанию)
      const query = this.buildSearchObject(criteria);
      const uids = await client.search(query, { uid: true });

      // 2b. Client-side fallback: некоторые IMAP-серверы (Яндекс) ненадёжно
      // ищут по SUBJECT/FROM/BODY с кириллицей/литералами — SEARCH возвращает 0
      // даже при совпадении. Если серверный search по текстовым критериям
      // ничего не нашёл, делаем fetchAll метаданных и фильтруем локально.
      let effectiveUids = uids;
      if (effectiveUids.length === 0 && this.hasTextCriteria(criteria)) {
        effectiveUids = await this.clientSideSearch(client, criteria);
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
      const messages = rows.map((r: FetchMessageObject) => toEmailMessage(r, folderPath));

      return { messages, total, hasMore };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new ConnectError(redact(message, this.account.password, this.account.login));
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
   * Client-side fallback: fetch всех метаданных и фильтрация по текстовым
   * критериям локально. Используется когда серверный SEARCH (Яндекс)
   * ненадёжно ищет по SUBJECT/FROM/TO с кириллицей или литералами.
   *
   * Возвращает UID'ы совпадающих писем. Доп. флаги (unseen/flagged/answered)
   * и даты (since/before) также применяются локально.
   */
  protected async clientSideSearch(client: ImapClient, criteria: SearchCriteria): Promise<number[]> {
    const fetchQuery: FetchQueryObject = {
      uid: true,
      envelope: true,
      internalDate: true,
      flags: true,
      size: true,
    };
    const rows = await client.fetchAll('1:*', fetchQuery, { uid: true });
    const matched: number[] = [];
    for (const row of rows) {
      const msg = toEmailMessage(row, '');
      if (!this.matchesCriteria(msg, criteria)) continue;
      matched.push(msg.uid);
    }
    // UID'ы возвращаются fetchAll в порядке возрастания, но гарантируем сортировку.
    return matched.sort((a, b) => a - b);
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

  async fetch(uid: number, folder?: string): Promise<EmailFull> {
    const client = this.requireClient();
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
      throw new ConnectError(redact(message, this.account.password, this.account.login));
    }
  }

  async downloadAttachments(
    uid: number,
    targetDir: string,
    options?: { folder?: string; names?: string[] },
  ): Promise<DownloadResult> {
    const client = this.requireClient();
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
        const safeName = await uniqueFilename(absDir, att.filename);
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
      throw new ConnectError(redact(message, this.account.password, this.account.login));
    }
  }

  /** Разрешение папки для fetch/download (folder или direction по умолчанию). */
  protected async resolveFolderForOp(folder: string | undefined, direction: 'incoming' | 'outgoing'): Promise<string> {
    if (folder) return folder;
    const folders = await this.listFolders();
    return resolveFolder({ direction }, folders);
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
  }
  protected accountId(): string {
    return this.account.login;
  }

  protected requireClient(): ImapClient {
    if (!this.client) {
      throw new ConnectError(
        `подключение не установлено для ${this.accountId()} (${this.providerKind})`,
      );
    }
    return this.client;
  }

  /** Читабельное сообщение об ошибке подключения без секретов. */
  protected sanitizeConnectError(err: unknown): string {
    const e = err as { message?: string; responseStatus?: unknown; responseText?: unknown };
    const msg = e?.message ?? String(err);
    const status = e?.responseStatus;
    const text = e?.responseText;
    if (text) {
      const detail = status ? `${String(status)}: ${String(text)}` : String(text);
      return redact(detail, this.account.password, this.account.login);
    }
    return redact(msg, this.account.password, this.account.login);
  }

  protected isAuthFailure(err: unknown): boolean {
    return looksLikeAuthFailure(err);
  }
}