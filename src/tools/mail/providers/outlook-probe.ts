import { ImapFlow, type ImapFlowOptions, type ListResponse } from 'imapflow';
import { redact } from '../redact.js';

/** Хост и порт Outlook IMAP. */
export const OUTLOOK_IMAP_HOST = 'outlook.office365.com';
export const OUTLOOK_IMAP_PORT = 993;

/** Результат проверочного зонда basic-auth. */
export interface BasicAuthProbeResult {
  works: boolean;
  error?: string;
}

/** Учётные данные аккаунта, достаточно для зонда. */
export interface ProbeAccount {
  login: string;
  password: string;
}

/**
 * Минимальный интерфейс IMAP-клиента, используемый зондом и провайдерами.
 * Позволяет инжектить мок в тестах вместо реального ImapFlow.
 */
export interface ImapClient {
  connect(): Promise<void>;
  logout(): Promise<void>;
  list(options?: { status?: boolean }): Promise<ListResponse[]>;
}

/** Фабрика IMAP-клиента. По умолчанию — ImapFlow; в тестах подменяется. */
export type ImapClientFactory = (options: ImapFlowOptions) => ImapClient;

const defaultFactory: ImapClientFactory = (options) => new ImapFlow(options) as unknown as ImapClient;

/**
 * Проверочный зонд basic-auth для Outlook.
 * Пытается connect+login (verifyOnly) к outlook.office365.com:993.
 * Секреты в `error` не попадают (см. redact).
 */
export async function probeOutlookBasicAuth(
  account: ProbeAccount,
  factory: ImapClientFactory = defaultFactory,
): Promise<BasicAuthProbeResult> {
  const options: ImapFlowOptions = {
    host: OUTLOOK_IMAP_HOST,
    port: OUTLOOK_IMAP_PORT,
    secure: true,
    verifyOnly: true,
    disableAutoIdle: true,
    logger: false,
    auth: { user: account.login, pass: account.password },
  };

  const client = factory(options);
  try {
    await client.connect();
    return { works: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { works: false, error: redact(message, account.password, account.login) };
  } finally {
    try {
      await client.logout();
    } catch {
      // Zwisch: после verifyOnly/logout ошибка уже не релевантна.
    }
  }
}