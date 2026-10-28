import type { MailProvider } from './mail-provider.js';
import type { MailAccount } from './types.js';

/**
 * Хранилище активных IMAP-сессий по логину аккаунта.
 * Связывает тул mail.connect (открывает сессию) с mail.listFolders (использует).
 * Жизненный цикл: connect -> store, dispose/listFolders используют, dispose удаляет.
 */
export class MailSessionStore {
  private sessions = new Map<string, { provider: MailProvider; account: MailAccount }>();

  set(account: MailAccount, provider: MailProvider): void {
    this.sessions.set(account.login, { provider, account });
  }

  get(login: string): MailProvider | undefined {
    return this.sessions.get(login)?.provider;
  }

  has(login: string): boolean {
    return this.sessions.has(login);
  }

  /** Закрывает и удаляет сессию. Возвращает true если сессия была. */
  async dispose(login: string): Promise<boolean> {
    const entry = this.sessions.get(login);
    if (!entry) return false;
    this.sessions.delete(login);
    await entry.provider.dispose();
    return true;
  }

  /** Закрывает все сессии. */
  async disposeAll(): Promise<void> {
    const logins = Array.from(this.sessions.keys());
    await Promise.all(logins.map((l) => this.dispose(l)));
  }
}