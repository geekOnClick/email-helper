import { mkdir, readFile, writeFile, rename, chmod, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';

/** Хранимый токен. expiresAt — epoch ms. */
export interface StoredToken {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // epoch ms
}

/**
 * Хранилище OAuth2-токенов в локальном JSON-файле вне git.
 * Структура: { "<account-login>": { accessToken, refreshToken, expiresAt } }
 * Атомарная запись: temp-файл + rename. Права 0600.
 */
export class OAuthTokenStore {
  /**
   * @param storePath путь к JSON-файлу (OAUTH_TOKEN_STORE_PATH)
   * @param clock инжектируемое "сейчас" (epoch ms) для тестов
   */
  constructor(
    private readonly storePath: string,
    private readonly clock: () => number = Date.now,
  ) {}

  async get(accountLogin: string): Promise<StoredToken | null> {
    const all = await this.readAll();
    return all[accountLogin] ?? null;
  }

  async set(accountLogin: string, token: StoredToken): Promise<void> {
    const all = await this.readAll();
    all[accountLogin] = token;
    await this.writeAll(all);
  }

  async clear(accountLogin: string): Promise<void> {
    const all = await this.readAll();
    if (accountLogin in all) {
      const rest: Record<string, StoredToken> = {};
      for (const [k, v] of Object.entries(all)) {
        if (k !== accountLogin) rest[k] = v;
      }
      await this.writeAll(rest);
    }
  }

  /** Действителен ли access token (с запасом 60с). */
  isAccessTokenValid(token: StoredToken | null): boolean {
    if (!token) return false;
    const skewMs = 60 * 1000;
    return token.expiresAt - this.clock() > skewMs;
  }

  private async readAll(): Promise<Record<string, StoredToken>> {
    try {
      const raw = await readFile(this.storePath, 'utf8');
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, StoredToken>;
      }
      return {};
    } catch {
      return {};
    }
  }

  private async writeAll(data: Record<string, StoredToken>): Promise<void> {
    await mkdir(dirname(this.storePath), { recursive: true });
    const tmp = `${this.storePath}.tmp-${process.pid}-${this.clock()}`;
    await writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
    try {
      await chmod(tmp, 0o600);
    } catch {
      // chmod может не сработать на некоторых FS; не блокируем запись
    }
    try {
      await rename(tmp, this.storePath);
    } catch {
      try {
        await unlink(tmp);
      } catch {
        // ignore
      }
      throw new Error(`не удалось сохранить токены в ${this.storePath}`);
    }
  }
}