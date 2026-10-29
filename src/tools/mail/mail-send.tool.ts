import type { ToolDef } from '../registry.js';
import type { MailAccount } from './types.js';
import { MailSessionStore } from './session-store.js';
import { ConnectError } from './providers/abstract-imap-provider.js';
import { createAuthStrategyForAccount, type CreateMailProviderOptions } from './providers/factory.js';
import { smtpConnectionFor } from './providers/smtp-options.js';
import { SmtpClient, createDefaultTransport, type SmtpTransportFactory } from './smtp-client.js';
import { validateComposeMail } from './compose-mail.js';
import { redact } from './redact.js';
import type {
  ComposeMailInput,
  EmailAddress,
  ValidationResult,
} from '../../types/email.js';

export interface MailSendArgs {
  login: string;
  mail: ComposeMailInput;
  confirm: boolean;
}

export interface MailSendDeps {
  sessionStore: MailSessionStore;
  accounts: MailAccount[];
  oauth2?: CreateMailProviderOptions['oauth2'];
  tokenStorePath?: string;
  /** Инжектируемая фабрика SMTP-транспорта (тесты). По умолчанию — nodemailer. */
  transportFactory?: SmtpTransportFactory;
}

/** Метаданные вложения в предпросмотре. */
export interface AttachmentPreview {
  filename: string;
  size: number;
}

/** Предпросмотр черновика (confirm !== true или невалидные критерии при confirm). */
export interface SendPreview {
  ready: false;
  preview: {
    from: string;
    to: EmailAddress[];
    cc?: EmailAddress[];
    bcc?: EmailAddress[];
    subject: string;
    textLength: number;
    hasHtml: boolean;
    attachments: AttachmentPreview[];
  };
  validation: ValidationResult;
}

/** Результат успешной отправки. */
export interface SendResult {
  ready: true;
  messageId: string;
  /** Все получатели (TO + CC + BCC), которым отправлено. */
  recipients: string[];
}

/** Результат тулa mail.send — предпросмотр или отправка (discriminated union по ready). */
export type MailSendResult = SendPreview | SendResult;

/**
 * Тул mail.send: отправка письма по SMTP с двухфазным протоколом подтверждения.
 *
 * - confirm !== true → валидация + предпросмотр черновика, БЕЗ SMTP-соединения.
 * - confirm === true → валидация; если валидно — отправка через SmtpClient,
 *   иначе возврат с ready:false и ошибками валидации (без отправки).
 *
 * Требует активную сессию mail.connect (gate по контракту помощника, design D3).
 * Stateless: каждый вызов независим.
 */
export function createMailSendTool(deps: MailSendDeps): ToolDef<MailSendArgs> {
  return {
    name: 'mail.send',
    description:
      'Отправка письма по SMTP (Яндекс basic, Outlook OAuth2). ' +
      'Без confirm:true возвращает предпросмотр черновика с валидацией; ' +
      'с confirm:true — отправляет. Требует активное mail.connect.',
    inputSchema: {
      type: 'object',
      properties: {
        login: { type: 'string', description: 'логин аккаунта-отправителя' },
        mail: {
          type: 'object',
          description: 'критерии письма: to (≥1), cc?, bcc?, subject, text, html?, attachments?, encoding?',
          properties: {
            to: { type: 'array', items: { type: 'object' } },
            cc: { type: 'array', items: { type: 'object' } },
            bcc: { type: 'array', items: { type: 'object' } },
            subject: { type: 'string' },
            text: { type: 'string' },
            html: { type: 'string' },
            attachments: { type: 'array', items: { type: 'object' } },
            encoding: { type: 'string' },
          },
        },
        confirm: { type: 'boolean', description: 'true — отправить; иначе — предпросмотр' },
      },
      required: ['login', 'mail', 'confirm'],
    },
    handler: async (args): Promise<MailSendResult> => {
      const login = args.login;
      if (typeof login !== 'string') {
        throw new ConnectError('mail.send: требуется параметр login');
      }
      if (!args.mail || typeof args.mail !== 'object') {
        throw new ConnectError('mail.send: требуется параметр mail (критерии письма)');
      }

      const provider = deps.sessionStore.get(login);
      const account = deps.sessionStore.getAccount(login) ?? deps.accounts.find((a) => a.login === login);
      if (!provider || !account) {
        throw new ConnectError(`mail.send: подключение не установлено для ${login}`);
      }

      const validation = await validateComposeMail(args.mail);
      const preview = buildPreview(account, args.mail);

      // 1. Без подтверждения — только предпросмотр, без SMTP.
      if (args.confirm !== true) {
        return { ready: false, preview, validation };
      }

      // 2. С подтверждением, но невалидные критерии — без отправки.
      if (!validation.valid) {
        return { ready: false, preview, validation };
      }

      // 3. Подтверждено и валидно — отправка.
      try {
        const strategy = createAuthStrategyForAccount(account, {
          oauth2: deps.oauth2,
          tokenStorePath: deps.tokenStorePath,
        });
        const connection = smtpConnectionFor(account.provider);
        const transportFactory = deps.transportFactory ?? createDefaultTransport;
        const smtp = new SmtpClient({ account, strategy, connection, transportFactory });
        const { messageId } = await smtp.send(args.mail);
        const recipients = collectRecipients(args.mail);
        return { ready: true, messageId, recipients };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new ConnectError(
          redact(message, account.password, account.login),
        );
      }
    },
  };
}

/** Строит предпросмотр черновика (без секретов). */
function buildPreview(account: MailAccount, mail: ComposeMailInput): SendPreview['preview'] {
  return {
    from: account.login,
    to: mail.to ?? [],
    cc: mail.cc,
    bcc: mail.bcc,
    subject: mail.subject ?? '',
    textLength: typeof mail.text === 'string' ? mail.text.length : 0,
    hasHtml: typeof mail.html === 'string' && mail.html.length > 0,
    attachments: (mail.attachments ?? []).map((a) => ({
      filename: a.path.split('/').pop() ?? a.path,
      size: 0,
    })),
  };
}

/** Собирает список адресов всех получателей (TO + CC + BCC). */
function collectRecipients(mail: ComposeMailInput): string[] {
  const all: EmailAddress[] = [
    ...(mail.to ?? []),
    ...(mail.cc ?? []),
    ...(mail.bcc ?? []),
  ];
  return all.map((a) => a.address);
}
