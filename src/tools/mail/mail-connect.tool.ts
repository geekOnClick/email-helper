import type { ToolDef } from '../registry.js';
import type { MailAccount } from './types.js';
import { createMailProvider, type CreateMailProviderOptions } from './providers/factory.js';
import { MailSessionStore } from './session-store.js';
import { ConnectError } from './providers/abstract-imap-provider.js';
import type { FetchLike } from './oauth/device-flow.js';

export interface MailConnectArgs {
  login: string;
}

export interface MailConnectDeps {
  accounts: MailAccount[];
  oauth2?: CreateMailProviderOptions['oauth2'];
  tokenStorePath?: string;
  /** Инжектируется в тестах; по умолчанию общий singleton создаётся при инициализации. */
  sessionStore?: MailSessionStore;
}

/**
 * Тул mail.connect: подключение к ящику.
 * Вход: login. Выбирает провайдер+стратегию через factory, открывает IMAP-сессию.
 */
export function createMailConnectTool(deps: MailConnectDeps): ToolDef<MailConnectArgs> {
  return {
    name: 'mail.connect',
    description: 'Подключение к почтовому ящику по IMAP (Яндекс, Outlook).',
    inputSchema: {
      type: 'object',
      properties: { login: { type: 'string', description: 'логин аккаунта из .env' } },
      required: ['login'],
    },
    handler: async (args) => {
      const login = args.login;
      if (typeof login !== 'string') {
        throw new ConnectError('mail.connect: требуется параметр login');
      }

      const account = deps.accounts.find((a) => a.login === login);
      if (!account) {
        throw new ConnectError(`mail.connect: аккаунт не найден: ${login}`);
      }

      const provider = createMailProvider(account, {
        oauth2: deps.oauth2,
        tokenStorePath: deps.tokenStorePath,
        fetchFn: globalThis.fetch as unknown as FetchLike,
      });

      try {
        const result = await provider.connect();
        deps.sessionStore?.set(account, provider);
        return result;
      } catch (err) {
        await provider.dispose().catch(() => undefined);
        throw err;
      }
    },
  };
}