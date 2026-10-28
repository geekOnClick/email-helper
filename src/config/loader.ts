import 'dotenv/config';
import { ConfigSchema, AccountSchema } from './schema.js';
import type { Config, Account } from './schema.js';

/**
 * Загружает и валидирует конфигурацию из process.env (+ .env через dotenv).
 * Бросает ошибку с читаемым сообщением, если .env невалиден.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = ConfigSchema.safeParse(env);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  • ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Конфигурация невалидна:\n${issues}`);
  }

  return parsed.data;
}

/**
 * Парсит JSON-строку ACCOUNTS из конфига в массив аккаунтов.
 * Бросает ошибку при некорректном JSON.
 */
export function parseAccounts(accountsJson: string): Account[] {
  let raw: unknown;
  try {
    raw = JSON.parse(accountsJson);
  } catch {
    throw new Error('ACCOUNTS должен быть валидным JSON-массивом');
  }

  if (!Array.isArray(raw)) {
    throw new Error('ACCOUNTS должен быть массивом');
  }

  return raw.map((item, idx) => {
    const result = AccountSchema.safeParse(item);
    if (!result.success) {
      throw new Error(`Невалидная запись аккаунта #${idx}: ${result.error.message}`);
    }
    return result.data;
  });
}

/**
 * Удобная обёртка: возвращает и конфиг, и распарсенные аккаунты.
 */
export function loadConfigWithAccounts(env: NodeJS.ProcessEnv = process.env): {
  config: Config;
  accounts: Account[];
} {
  const config = loadConfig(env);
  const accounts = parseAccounts(config.ACCOUNTS);
  return { config, accounts };
}