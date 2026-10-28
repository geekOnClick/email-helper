import type { ToolDef } from '../registry.js';
import { MailSessionStore } from './session-store.js';
import { ConnectError } from './providers/abstract-imap-provider.js';

export interface MailListFoldersArgs {
  login: string;
}

export interface MailListFoldersDeps {
  sessionStore: MailSessionStore;
}

/**
 * Тул mail.listFolders: список папок ящика.
 * Требует активную сессию для login (созданную тулом mail.connect), иначе ошибка.
 */
export function createMailListFoldersTool(deps: MailListFoldersDeps): ToolDef<MailListFoldersArgs> {
  return {
    name: 'mail.listFolders',
    description: 'Список папок ящика (требует активное подключение mail.connect).',
    inputSchema: {
      type: 'object',
      properties: { login: { type: 'string', description: 'логин аккаунта' } },
      required: ['login'],
    },
    handler: async (args) => {
      const login = args.login;
      if (typeof login !== 'string') {
        throw new ConnectError('mail.listFolders: требуется параметр login');
      }

      const provider = deps.sessionStore.get(login);
      if (!provider) {
        throw new ConnectError(`mail.listFolders: подключение не установлено для ${login}`);
      }

      return await provider.listFolders();
    },
  };
}