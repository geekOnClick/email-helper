import type { ToolDef } from '../registry.js';
import { MailSessionStore } from './session-store.js';
import { ConnectError } from './providers/abstract-imap-provider.js';
import type { SearchCriteria, SearchResult } from '../../types/email.js';

export interface MailSearchArgs {
  login: string;
  criteria: SearchCriteria;
}

export interface MailSearchDeps {
  sessionStore: MailSessionStore;
}

/**
 * Тул mail.search: поиск писем по критериям.
 * Требует активную сессию для login (созданную тулом mail.connect), иначе ошибка.
 */
export function createMailSearchTool(deps: MailSearchDeps): ToolDef<MailSearchArgs> {
  return {
    name: 'mail.search',
    description:
      'Поиск писем по критериям (тема, отправитель, получатель, дата, флаги, папка/направление). Требует активное подключение mail.connect.',
    inputSchema: {
      type: 'object',
      properties: {
        login: { type: 'string', description: 'логин аккаунта' },
        criteria: {
          type: 'object',
          description: 'Критерии поиска (все поля опциональны, соединяются через AND)',
          properties: {
            subject: { type: 'string' },
            from: { type: 'string' },
            to: { type: 'string' },
            since: { type: 'string', description: 'ISO-дата, получено начиная с' },
            before: { type: 'string', description: 'ISO-дата, получено до' },
            folder: { type: 'string', description: 'явная папка (приоритет над direction)' },
            direction: { type: 'string', enum: ['incoming', 'outgoing'] },
            unseen: { type: 'boolean' },
            flagged: { type: 'boolean' },
            answered: { type: 'boolean' },
            limit: { type: 'integer', description: 'по умолчанию 50' },
            offset: { type: 'integer' },
          },
        },
      },
      required: ['login', 'criteria'],
    },
    handler: async (args): Promise<SearchResult> => {
      const login = args.login;
      if (typeof login !== 'string') {
        throw new ConnectError('mail.search: требуется параметр login');
      }
      if (!args.criteria || typeof args.criteria !== 'object') {
        throw new ConnectError('mail.search: требуется параметр criteria');
      }

      const provider = deps.sessionStore.get(login);
      if (!provider) {
        throw new ConnectError(`mail.search: подключение не установлено для ${login}`);
      }

      // парсинг ISO-дат в Date
      const criteria = normalizeCriteria(args.criteria);
      return await provider.search(criteria);
    },
  };
}

function normalizeCriteria(raw: SearchCriteria): SearchCriteria {
  const c: SearchCriteria = { ...raw };
  if (typeof c.since === 'string') c.since = new Date(c.since);
  if (typeof c.before === 'string') c.before = new Date(c.before);
  return c;
}