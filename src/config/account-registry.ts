/**
 * In-memory реестр почтовых аккаунтов (change mcp-env-account-credentials).
 *
 * Изменяемый источник правды об аккаунтах в рамках процесса. Инициализируется из
 * `ACCOUNTS` (`.env`) при `bootstrap()`. Тул `mail.connect` и guided-команды читают
 * реестр при каждом вызове — поэтому аккаунты, добавленные командой `/add-account`,
 * становятся доступны немедленно, без перезапуска и без перерегистрации тулов
 * (в отличие от прежнего замыкания статичного `accounts: MailAccount[]`).
 *
 * API:
 * - `findByProviderLogin(provider, login)` — точный поиск по паре (для `mail.connect`).
 * - `findByLogin(login)` — поиск по логину без учёта провайдера (для различения
 *   `account_not_found` и `provider_mismatch`, а также для `mail.send` fallback).
 * - `list()` — полный список (для guided-команд выбора аккаунта и записи `.env`).
 * - `upsert(account)` — add-or-replace по `login` (для `/add-account`).
 * - `has(login)` — наличие логина (для подтверждения перезаписи в `/add-account`).
 */
import type { MailAccount, MailProviderKind } from '../tools/mail/types.js';

export class AccountRegistry {
  private accounts: MailAccount[];

  /**
   * @param initial Аккаунты из `ACCOUNTS` (`.env`), либо пустой массив.
   */
  constructor(initial: MailAccount[] = []) {
    // Копируем массив, чтобы внешняя мутация исходного не влияла на реестр.
    this.accounts = [...initial];
  }

  /** Точный поиск по паре `(provider, login)`. Возвращает undefined, если не найдено. */
  findByProviderLogin(provider: MailProviderKind, login: string): MailAccount | undefined {
    return this.accounts.find((a) => a.provider === provider && a.login === login);
  }

  /** Поиск по `login` без учёта провайдера. Возвращает undefined, если не найдено. */
  findByLogin(login: string): MailAccount | undefined {
    return this.accounts.find((a) => a.login === login);
  }

  /** Полный список аккаунтов (копия, чтобы внешняя мутация не влияла на реестр). */
  list(): MailAccount[] {
    return [...this.accounts];
  }

  /** Есть ли в реестре аккаунт с данным `login` (любого провайдера). */
  has(login: string): boolean {
    return this.accounts.some((a) => a.login === login);
  }

  /**
   * Add-or-replace по `login`. Если аккаунт с таким `login` уже есть — он заменяется
   * (прежний пароль более недоступен через реестр). Иначе — добавляется в конец.
   */
  upsert(account: MailAccount): void {
    const idx = this.accounts.findIndex((a) => a.login === account.login);
    if (idx >= 0) {
      this.accounts[idx] = account;
    } else {
      this.accounts.push(account);
    }
  }
}
