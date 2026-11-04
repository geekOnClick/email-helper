import { describe, it, expect } from 'vitest';
import { toMcpError, toMcpResult } from '../src/mcp/result.js';
import { AccountLookupError } from '../src/tools/mail/account-lookup-error.js';

describe('toMcpError: AccountLookupError → JSON в text-блоке', () => {
  it('account_not_found → isError:true + валидный JSON', () => {
    const err = new AccountLookupError('account_not_found', 'user@yandex.com', 'yandex');
    const result = toMcpError(err);
    expect(result.isError).toBe(true);
    expect(result.content).toHaveLength(1);
    const block = result.content[0] as { type: 'text'; text: string };
    expect(block.type).toBe('text');
    const parsed = JSON.parse(block.text);
    expect(parsed).toEqual({
      error: 'account_not_found',
      message: expect.any(String),
      login: 'user@yandex.com',
      provider: 'yandex',
      hint: expect.any(String),
    });
  });

  it('provider_mismatch → isError:true + валидный JSON с кодом provider_mismatch', () => {
    const err = new AccountLookupError('provider_mismatch', 'user@yandex.com', 'outlook');
    const result = toMcpError(err);
    expect(result.isError).toBe(true);
    const block = result.content[0] as { type: 'text'; text: string };
    const parsed = JSON.parse(block.text);
    expect(parsed.error).toBe('provider_mismatch');
    expect(parsed.login).toBe('user@yandex.com');
    expect(parsed.provider).toBe('outlook');
    expect(parsed.hint).toContain('provider');
  });

  it('JSON-ошибка не содержит значения пароля', () => {
    const err = new AccountLookupError('account_not_found', 'user@yandex.com', 'yandex');
    const result = toMcpError(err);
    const block = result.content[0] as { type: 'text'; text: string };
    const parsed = JSON.parse(block.text);
    expect(parsed).not.toHaveProperty('password');
    expect(block.text).not.toContain('super-secret-value');
  });
});

describe('toMcpError: прочие ошибки → прежнее поведение (текст, не JSON)', () => {
  it('обычная Error → текст сообщения, isError:true', () => {
    const result = toMcpError(new Error('внутренняя ошибка тулa'));
    expect(result.isError).toBe(true);
    const block = result.content[0] as { type: 'text'; text: string };
    expect(block.text).toBe('внутренняя ошибка тулa');
    // Это не структурированный JSON-объект AccountLookupError (просто текст ошибки).
    expect(block.text).not.toMatch(/^\{"error":"account_not_found"/);
    expect(block.text).not.toMatch(/^\{"error":"provider_mismatch"/);
  });

  it('строка-ошибка → текст', () => {
    const result = toMcpError('строка ошибки');
    expect(result.isError).toBe(true);
    const block = result.content[0] as { type: 'text'; text: string };
    expect(block.text).toBe('строка ошибки');
  });
});

describe('toMcpResult: без изменений', () => {
  it('объект → pretty JSON', () => {
    const result = toMcpResult({ connected: true });
    const block = result.content[0] as { type: 'text'; text: string };
    expect(JSON.parse(block.text)).toEqual({ connected: true });
    expect(result.isError).toBeFalsy();
  });
});
