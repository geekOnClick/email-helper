import type { ToolDef } from '../registry.js';
import { MailSessionStore } from './session-store.js';
import { ConnectError } from './providers/abstract-imap-provider.js';
import type { EmailFull } from '../../types/email.js';

export interface MailFetchArgs {
  login: string;
  uid: number;
  folder?: string;
}

export interface MailFetchDeps {
  sessionStore: MailSessionStore;
}

/**
 * Тул mail.fetch: чтение тела + метаданных вложений письма по UID.
 * Требует активную сессию для login (mail.connect).
 */
export function createMailFetchTool(deps: MailFetchDeps): ToolDef<MailFetchArgs> {
  return {
    name: 'mail.fetch',
    description:
      'Чтение письма по UID: текстовое тело (text/plain, иначе text/html) + метаданные вложений. Требует активное подключение mail.connect.',
    inputSchema: {
      type: 'object',
      properties: {
        login: { type: 'string', description: 'логин аккаунта' },
        uid: { type: 'integer', description: 'UID письма' },
        folder: { type: 'string', description: 'папка (иначе направление incoming → \\Inbox)' },
      },
      required: ['login', 'uid'],
    },
    handler: async (args): Promise<EmailFull> => {
      const login = args.login;
      const uid = args.uid;
      if (typeof login !== 'string') {
        throw new ConnectError('mail.fetch: требуется параметр login');
      }
      if (typeof uid !== 'number' || !Number.isFinite(uid)) {
        throw new ConnectError('mail.fetch: требуется параметр uid (число)');
      }

      const provider = deps.sessionStore.get(login);
      if (!provider) {
        throw new ConnectError(`mail.fetch: подключение не установлено для ${login}`);
      }

      return await provider.fetch(uid, args.folder);
    },
  };
}