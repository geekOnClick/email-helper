/**
 * Transport отправки писем через Microsoft Graph API (`/me/sendMail`).
 *
 * Для личных @outlook.com аккаунтов SMTP AUTH отключён Microsoft политикой
 * security defaults (сервер возвращает `535 5.7.3 Authentication unsuccessful`
 * для любого токена — XOAUTH2 и basic). Microsoft Graph API — единственный
 * путь отправки для таких аккаунтов. Требует scope
 * `https://graph.microsoft.com/Mail.Send`.
 *
 * Поток: получает Graph access token через `AuthStrategy.getGraphAccessToken`
 * (только oauth2-стратегии), строит JSON-тело `sendMail` (message + recipients
 * + body + attachments base64) и POST'ит в `https://graph.microsoft.com/v1.0/me/sendMail`.
 * Вложениям нужен MIME Content-Type; определяется по расширению файла.
 */
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import type { MailAccount } from './types.js';
import type { AuthStrategy } from './mail-provider.js';
import type { ComposeMailInput } from '../../types/email.js';
import { redact } from './redact.js';

/** Результат отправки через Graph API. */
export interface GraphSendResult {
  /** Message-ID (Graph не возвращает его при 202; генерируем локально). */
  messageId: string;
}

/** Тип fetch-функции (инжектируется для моков в тестах). */
export type GraphFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ status: number; text(): Promise<string> }>;

/** MIME Content-Type по расширению файла вложения. */
function contentTypeFor(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    txt: 'text/plain',
    csv: 'text/csv',
    json: 'application/json',
    html: 'text/html',
    htm: 'text/html',
    pdf: 'application/pdf',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ppt: 'application/vnd.ms-powerpoint',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    zip: 'application/zip',
    rar: 'application/vnd.rar',
    '7z': 'application/x-7z-compressed',
  };
  return map[ext] ?? 'application/octet-stream';
}

/**
 * Transport отправки через Microsoft Graph API.
 * Без состояния: каждый `send` получает свежий Graph-токен и делает один HTTP-запрос.
 */
export class GraphMailTransport {
  private readonly account: MailAccount;
  private readonly strategy: AuthStrategy;
  private readonly fetchFn: GraphFetch;

  constructor(opts: {
    account: MailAccount;
    strategy: AuthStrategy;
    /** Инжектируемый fetch (тесты). По умолчанию — globalThis.fetch. */
    fetchFn?: GraphFetch;
  }) {
    this.account = opts.account;
    this.strategy = opts.strategy;
    this.fetchFn =
      opts.fetchFn ??
      (globalThis.fetch as unknown as GraphFetch);
  }

  /**
   * Отправляет письмо через Graph `/me/sendMail`.
   * @throws Error при отсутствии Graph-токена (не oauth2 / нет refresh) или HTTP-ошибке.
   */
  async send(mail: ComposeMailInput): Promise<GraphSendResult> {
    const accessToken = await this.strategy.getGraphAccessToken?.(this.account);
    if (!accessToken) {
      throw new Error('Graph API: нет access token (требуется oauth2-стратегия с refresh token)');
    }

    const body = await this.buildSendMailBody(mail);

    const res = await this.fetchFn('https://graph.microsoft.com/v1.0/me/sendMail', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (res.status !== 202) {
      const text = await res.text();
      throw new Error(
        redact(
          `Graph sendMail HTTP ${res.status}: ${text}`,
          this.account.password,
          this.account.login,
          accessToken,
        ),
      );
    }

    // Graph возвращает 202 без тела и без Message-ID. Генерируем локальный ID для
    // совместимости с контрактом SmtpSendResult.messageId.
    const messageId = `<graph-${Date.now()}-${Math.random().toString(36).slice(2, 10)}@email-helper>`;
    return { messageId };
  }

  /**
   * Строит тело Graph `sendMail` (message object + saveToSentItems).
   * https://learn.microsoft.com/en-us/graph/api/user-sendmail
   */
  private async buildSendMailBody(mail: ComposeMailInput): Promise<{
    message: Record<string, unknown>;
    saveToSentItems: boolean;
  }> {
    const message: Record<string, unknown> = {
      subject: mail.subject,
      body: {
        contentType: mail.html ? 'HTML' : 'Text',
        content: mail.html ?? mail.text,
      },
      from: { emailAddress: { address: this.account.login } },
      toRecipients: mail.to.map((a) => ({
        emailAddress: a.name ? { name: a.name, address: a.address } : { address: a.address },
      })),
    };

    if (mail.cc && mail.cc.length > 0) {
      message['ccRecipients'] = mail.cc.map((a) => ({
        emailAddress: a.name ? { name: a.name, address: a.address } : { address: a.address },
      }));
    }
    if (mail.bcc && mail.bcc.length > 0) {
      message['bccRecipients'] = mail.bcc.map((a) => ({
        emailAddress: a.name ? { name: a.name, address: a.address } : { address: a.address },
      }));
    }

    if (mail.attachments && mail.attachments.length > 0) {
      message['attachments'] = await Promise.all(
        mail.attachments.map(async (att) => {
          const content = await readFile(att.path);
          return {
            '@odata.type': '#microsoft.graph.fileAttachment',
            name: basename(att.path),
            contentType: contentTypeFor(att.path),
            contentBytes: content.toString('base64'),
          };
        }),
      );
    }

    return { message, saveToSentItems: true };
  }
}
