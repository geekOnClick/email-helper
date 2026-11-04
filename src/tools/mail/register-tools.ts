import { registerTool } from '../registry.js';
import { createMailConnectTool } from './mail-connect.tool.js';
import { createMailListFoldersTool } from './mail-list-folders.tool.js';
import { createMailSearchTool } from './mail-search.tool.js';
import { createMailFetchTool } from './mail-fetch.tool.js';
import { createMailDownloadAttachmentsTool } from './mail-download-attachments.tool.js';
import { createMailSendTool } from './mail-send.tool.js';
import { MailSessionStore } from './session-store.js';
import type { CreateMailProviderOptions } from './providers/factory.js';
import type { SmtpTransportFactory } from './smtp-client.js';
import type { MailOpOptions } from '../../types/email.js';
import type { AccountRegistry } from '../../config/account-registry.js';

export interface RegisterToolsDeps {
  /** In-memory реестр аккаунтов (источник правды для mail.connect/mail.send). */
  accountRegistry: AccountRegistry;
  oauth2?: CreateMailProviderOptions['oauth2'];
  tokenStorePath?: string;
  sessionStore?: MailSessionStore;
  /** Каталог по умолчанию для скачивания вложений (DOWNLOAD_DIR из конфига). */
  downloadDir?: string;
  /** Инжектируемая фабрика SMTP-транспорта для mail.send (по умолчанию — nodemailer). */
  smtpTransportFactory?: SmtpTransportFactory;
  /** Опции устойчивости IMAP-операций (change mail-search-robustness). */
  mailOpOptions?: MailOpOptions;
}

/**
 * Регистрирует тулы Фазы 1 (mail.connect, mail.listFolders) в реестре.
 * Вызывается при инициализации агента (Фаза 2+).
 */
export function registerMailConnectTools(deps: RegisterToolsDeps): MailSessionStore {
  const sessionStore = deps.sessionStore ?? new MailSessionStore();

  registerTool(
    createMailConnectTool({
      accountRegistry: deps.accountRegistry,
      oauth2: deps.oauth2,
      tokenStorePath: deps.tokenStorePath,
      sessionStore,
    }),
  );
  registerTool(createMailListFoldersTool({ sessionStore, mailOpOptions: deps.mailOpOptions }));
  registerTool(createMailSearchTool({ sessionStore, mailOpOptions: deps.mailOpOptions }));
  registerTool(createMailFetchTool({ sessionStore, mailOpOptions: deps.mailOpOptions }));
  registerTool(
    createMailDownloadAttachmentsTool({
      sessionStore,
      defaultDownloadDir: deps.downloadDir ?? './downloads',
      mailOpOptions: deps.mailOpOptions,
    }),
  );
  registerTool(
    createMailSendTool({
      sessionStore,
      accountRegistry: deps.accountRegistry,
      oauth2: deps.oauth2,
      tokenStorePath: deps.tokenStorePath,
      transportFactory: deps.smtpTransportFactory,
    }),
  );

  return sessionStore;
}

/** Shared singleton session store (для процесса-агента). */
let sharedSessionStore: MailSessionStore | null = null;

export function getSharedSessionStore(): MailSessionStore {
  if (!sharedSessionStore) {
    sharedSessionStore = new MailSessionStore();
  }
  return sharedSessionStore;
}