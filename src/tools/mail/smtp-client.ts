import nodemailer, { type Transport, type SendMailOptions } from 'nodemailer';
import type { SmtpAuth, SmtpConnectionOptions, AuthStrategy } from './mail-provider.js';
import type { MailAccount } from './types.js';
import type { ComposeMailInput } from '../../types/email.js';
import { redact } from './redact.js';

/** Опции письма, сформированные для nodemailer (тип сужен для тестов). */
export type SmtpSendMailOptions = Pick<
  SendMailOptions,
  'from' | 'to' | 'cc' | 'bcc' | 'subject' | 'text' | 'html' | 'attachments' | 'encoding'
>;

/** Результат отправки письма через SMTP. */
export interface SmtpSendResult {
  /** Message-ID, присвоенный сервером/клиентом. */
  messageId: string;
}

/**
 * Минимальный интерфейс SMTP-транспорта (сужение nodemailer.Transport).
 * Инъектируется фабрикой — для моков в unit-тестах и реального nodemailer в проде.
 */
export interface SmtpTransport extends Transport {
  /** Отправить письмо, вернуть { messageId }. */
  sendMail(opts: SmtpSendMailOptions): Promise<SmtpSendResult>;
}

/** Фабрика SMTP-транспорта. По умолчанию — nodemailer.createTransport. */
export type SmtpTransportFactory = (opts: {
  connection: SmtpConnectionOptions;
  auth: SmtpAuth;
}) => SmtpTransport;

/**
 * Дефолтная фабрика транспорта: обёртка над nodemailer.createTransport.
 * Возвращает объект, реализующий SmtpTransport поверх nodemailer-транспорта.
 * @param extra — доп. nodemailer-опции (напр. tls-настройки для тестов/прода), мержатся поверх.
 */
export function createDefaultTransport(
  opts: {
    connection: SmtpConnectionOptions;
    auth: SmtpAuth;
    extra?: Record<string, unknown>;
  },
): SmtpTransport {
  const transport = nodemailer.createTransport({
    host: opts.connection.host,
    port: opts.connection.port,
    secure: opts.connection.secure,
    auth:
      opts.auth.pass !== undefined
        ? { user: opts.auth.user, pass: opts.auth.pass }
        : { user: opts.auth.user, accessToken: opts.auth.accessToken },
    ...(opts.extra ?? {}),
  });
  return transport as unknown as SmtpTransport;
}

/**
 * SMTP-клиент: строит nodemailer-опции письма и отправляет через транспорт.
 * Аутентификацию получает через AuthStrategy (basic/oauth2), соединение — по провайдеру.
 */
export class SmtpClient {
  private readonly account: MailAccount;
  private readonly strategy: AuthStrategy;
  private readonly connection: SmtpConnectionOptions;
  private readonly transportFactory: SmtpTransportFactory;

  constructor(opts: {
    account: MailAccount;
    strategy: AuthStrategy;
    connection: SmtpConnectionOptions;
    transportFactory: SmtpTransportFactory;
  }) {
    this.account = opts.account;
    this.strategy = opts.strategy;
    this.connection = opts.connection;
    this.transportFactory = opts.transportFactory;
  }

  /**
   * Отправляет письмо по SMTP: получает auth через стратегию, строит опции,
   * вызывает transport.sendMail. Ошибки пропускаются через redact (без секретов).
   */
  async send(mail: ComposeMailInput): Promise<SmtpSendResult> {
    const auth = await this.strategy.getSmtpAuth(this.account, this.connection);
    const transport = this.transportFactory({ connection: this.connection, auth });
    try {
      const sendOpts = this.buildSendMailOptions(mail);
      const result = await transport.sendMail(sendOpts);
      return { messageId: result.messageId };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const accessToken = (auth as { accessToken?: string }).accessToken;
      throw new Error(
        redact(message, this.account.password, this.account.login, auth.user, accessToken),
        { cause: err },
      );
    } finally {
      // nodemailer-транспорт держит пул соединений; закрываем после каждой отправки
      // (short-lived, как в design D3). close() синхронный (void) — оборачиваем в try.
      try {
        transport.close?.();
      } catch {
        // освобождение после отправки не критично
      }
    }
  }

  /** Строит nodemailer SendMailOptions из доменных критериев письма. */
  private buildSendMailOptions(mail: ComposeMailInput): SmtpSendMailOptions {
    const opts: SmtpSendMailOptions = {
      from: this.account.login,
      to: mail.to.map((a) => formatAddress(a)),
      subject: mail.subject,
      text: mail.text,
    };
    if (mail.cc && mail.cc.length > 0) opts.cc = mail.cc.map((a) => formatAddress(a));
    if (mail.bcc && mail.bcc.length > 0) opts.bcc = mail.bcc.map((a) => formatAddress(a));
    if (mail.html) opts.html = mail.html;
    if (mail.encoding) opts.encoding = mail.encoding;
    if (mail.attachments && mail.attachments.length > 0) {
      opts.attachments = mail.attachments.map((a) => ({ path: a.path }));
    }
    return opts;
  }
}

/** Форматирует EmailAddress в nodemailer-совместимое значение (объект или строка). */
function formatAddress(a: { name?: string; address: string }): string | { name: string; address: string } {
  if (a.name) {
    return { name: a.name, address: a.address };
  }
  return a.address;
}
