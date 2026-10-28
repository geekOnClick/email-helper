import { describe, it, expect } from 'vitest';
import { ConfigSchema, AccountSchema } from '../src/config/schema.js';

describe('smoke', () => {
  it('арифметика работает', () => {
    expect(2 + 2).toBe(4);
  });

  it('ConfigSchema экспортируется и схема валидирует базовый конфиг', () => {
    const valid = ConfigSchema.safeParse({
      ROUTERAI_API_KEY: 'test-key',
    });
    expect(valid.success).toBe(true);
  });

  it('AccountSchema валидирует запись аккаунта', () => {
    const acc = AccountSchema.safeParse({
      provider: 'yandex',
      login: 'user@yandex.com',
      password: 'secret',
    });
    expect(acc.success).toBe(true);
  });
});
