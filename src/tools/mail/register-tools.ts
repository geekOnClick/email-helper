import { registerTool } from '../registry.js';
import { createMailConnectTool } from './mail-connect.tool.js';
import { createMailListFoldersTool } from './mail-list-folders.tool.js';
import { createMailSearchTool } from './mail-search.tool.js';
import { createMailFetchTool } from './mail-fetch.tool.js';
import { createMailDownloadAttachmentsTool } from './mail-download-attachments.tool.js';
import { MailSessionStore } from './session-store.js';
import type { MailAccount } from './types.js';
import type { CreateMailProviderOptions } from './providers/factory.js';

export interface RegisterToolsDeps {
  accounts: MailAccount[];
  oauth2?: CreateMailProviderOptions['oauth2'];
  tokenStorePath?: string;
  sessionStore?: MailSessionStore;
  /** Каталог по умолчанию для скачивания вложений (DOWNLOAD_DIR из конфига). */
  downloadDir?: string;
}

/**
 * Регистрирует тулы Фазы 1 (mail.connect, mail.listFolders) в реестре.
 * Вызывается при инициализации агента (Фаза 2+).
 */
export function registerMailConnectTools(deps: RegisterToolsDeps): MailSessionStore {
  const sessionStore = deps.sessionStore ?? new MailSessionStore();

  registerTool(
    createMailConnectTool({
      accounts: deps.accounts,
      oauth2: deps.oauth2,
      tokenStorePath: deps.tokenStorePath,
      sessionStore,
    }),
  );
  registerTool(createMailListFoldersTool({ sessionStore }));
  registerTool(createMailSearchTool({ sessionStore }));
  registerTool(createMailFetchTool({ sessionStore }));
  registerTool(
    createMailDownloadAttachmentsTool({
      sessionStore,
      defaultDownloadDir: deps.downloadDir ?? './downloads',
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