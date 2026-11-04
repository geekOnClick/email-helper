import { describe, it, expect } from 'vitest';
import { AccountLookupError } from '../src/tools/mail/account-lookup-error.js';

describe('AccountLookupError', () => {
  it('account_not_found: message и code', () => {
    const err = new AccountLookupError('account_not_found', 'user@yandex.com', 'yandex');
    expect(err.code).toBe('account_not_found');
    expect(err.login).toBe('user@yandex.com');
    expect(err.provider).toBe('yandex');
    expect(err.message).toContain('не найден');
    expect(err.message).toContain('user@yandex.com');
  });

  it('provider_mismatch: message и code', () => {
    const err = new AccountLookupError('provider_mismatch', 'user@yandex.com', 'outlook');
    expect(err.code).toBe('provider_mismatch');
    expect(err.message).toContain('не соответствует');
    expect(err.message).toContain('outlook');
    expect(err.message).toContain('user@yandex.com');
  });

  it('toMcpJson() возвращает поля error/message/login/provider/hint', () => {
    const err = new AccountLookupError('account_not_found', 'user@yandex.com', 'yandex');
    const json = err.toMcpJson();
    expect(json).toEqual({
      error: 'account_not_found',
      message: expect.any(String),
      login: 'user@yandex.com',
      provider: 'yandex',
      hint: expect.any(String),
    });
  });

  it('toMcpJson() НЕ содержит значения пароля', () => {
    const err = new AccountLookupError('account_not_found', 'user@yandex.com', 'yandex');
    const json = err.toMcpJson();
    const serialized = JSON.stringify(json);
    // Слово "password" в hint описывает поля формы, а не значение пароля.
    // Проверяем, что реальное значение пароля не утекло: ошибка не хранит password.
    expect(json).not.toHaveProperty('password');
    expect(serialized).not.toContain('super-secret-value');
    expect(Object.keys(json).sort()).toEqual(['error', 'hint', 'login', 'message', 'provider']);
  });

  it('hint для account_not_found упоминает /add-account', () => {
    const err = new AccountLookupError('account_not_found', 'user@yandex.com', 'yandex');
    expect(err.toMcpJson().hint).toContain('/add-account');
  });

  it('hint для provider_mismatch упоминает несоответствие provider', () => {
    const err = new AccountLookupError('provider_mismatch', 'user@yandex.com', 'outlook');
    expect(err.toMcpJson().hint).toContain('provider');
  });

  it('является экземпляром Error (проходит через канал ошибок тулов)', () => {
    const err = new AccountLookupError('account_not_found', 'user@yandex.com', 'yandex');
    expect(err).toBeInstanceOf(Error);
  });
});
