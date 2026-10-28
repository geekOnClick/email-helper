import type { ToolDef } from '../registry.js';
import { MailSessionStore } from './session-store.js';
import { ConnectError } from './providers/abstract-imap-provider.js';
import type { DownloadResult } from '../../types/email.js';

export interface MailDownloadAttachmentsArgs {
  login: string;
  uid: number;
  folder?: string;
  /** Целевой каталог. Если не задан — используется DOWNLOAD_DIR из конфига. */
  targetDir?: string;
  /** Имена вложений для скачивания. Если не задан — все вложения. */
  names?: string[];
}

export interface MailDownloadAttachmentsDeps {
  sessionStore: MailSessionStore;
  /** Каталог по умолчанию (DOWNLOAD_DIR из конфига). */
  defaultDownloadDir: string;
}

/**
 * Тул mail.downloadAttachments: скачивание вложений письма в локальный каталог
 * с безопасными именами. Требует активную сессию для login (mail.connect).
 */
export function createMailDownloadAttachmentsTool(
  deps: MailDownloadAttachmentsDeps,
): ToolDef<MailDownloadAttachmentsArgs> {
  return {
    name: 'mail.downloadAttachments',
    description:
      'Скачивание вложений письма (по UID) в локальный каталог с безопасными именами. Требует активное подключение mail.connect.',
    inputSchema: {
      type: 'object',
      properties: {
        login: { type: 'string', description: 'логин аккаунта' },
        uid: { type: 'integer', description: 'UID письма' },
        folder: { type: 'string' },
        targetDir: { type: 'string', description: 'каталог (по умолчанию DOWNLOAD_DIR)' },
        names: { type: 'array', items: { type: 'string' }, description: 'имена вложений (иначе все)' },
      },
      required: ['login', 'uid'],
    },
    handler: async (args): Promise<DownloadResult> => {
      const login = args.login;
      const uid = args.uid;
      if (typeof login !== 'string') {
        throw new ConnectError('mail.downloadAttachments: требуется параметр login');
      }
      if (typeof uid !== 'number' || !Number.isFinite(uid)) {
        throw new ConnectError('mail.downloadAttachments: требуется параметр uid (число)');
      }

      const provider = deps.sessionStore.get(login);
      if (!provider) {
        throw new ConnectError(`mail.downloadAttachments: подключение не установлено для ${login}`);
      }

      const targetDir = args.targetDir ?? deps.defaultDownloadDir;
      return await provider.downloadAttachments(uid, targetDir, {
        folder: args.folder,
        names: args.names,
      });
    },
  };
}