import { describe, it, expect } from 'vitest';
import { redact } from '../src/tools/mail/redact.js';

describe('redact', () => {
  it('вырезает пароль из сообщения', () => {
    const msg = `AUTHENTICATIONFAILED: invalid password=super-secret-pass`;
    const out = redact(msg, 'super-secret-pass');
    expect(out).not.toContain('super-secret-pass');
    expect(out).toContain('[REDACTED]');
  });

  it('вырезает логин-email', () => {
    const msg = `connect failed for user@yandex.com`;
    const out = redact(msg, undefined, 'user@yandex.com');
    expect(out).not.toContain('user@yandex.com');
    expect(out).toContain('[REDACTED]');
  });

  it('вырезает несколько секретов сразу', () => {
    const msg = `token=AT-xyz refresh=RT-abc`;
    const out = redact(msg, 'AT-xyz', 'RT-abc');
    expect(out).not.toContain('AT-xyz');
    expect(out).not.toContain('RT-abc');
  });

  it('не ломается при отсутствии секрета (пустой/undefined)', () => {
    expect(redact('plain text', undefined, '')).toBe('plain text');
  });

  it('экранирует regex-спецсимволы в секрете', () => {
    const msg = `err with pass=ab.*c`;
    const out = redact(msg, 'ab.*c');
    expect(out).not.toContain('ab.*c');
    expect(out).toContain('[REDACTED]');
  });
});