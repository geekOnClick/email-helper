import { describe, it, expect, vi } from 'vitest';
import {
  probeOutlookBasicAuth,
  OUTLOOK_IMAP_HOST,
  OUTLOOK_IMAP_PORT,
  type ImapClientFactory,
} from '../src/tools/mail/providers/outlook-probe.js';

const ACCOUNT = { login: 'alcauselove@outlook.com', password: 'super-secret-pass' };

/** Создаёт мок-фабрику с заданным поведением connect/logout. */
function makeFactory(opts: {
  connect: () => Promise<void>;
  logout?: () => Promise<void>;
}): ImapClientFactory {
  return () => ({
    connect: opts.connect,
    logout: opts.logout ?? vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockResolvedValue([]),
  });
}

describe('probeOutlookBasicAuth', () => {
  it('возвращает {works:true} при успешном login', async () => {
    const factory = makeFactory({ connect: vi.fn().mockResolvedValue(undefined) });
    const res = await probeOutlookBasicAuth(ACCOUNT, factory);
    expect(res.works).toBe(true);
    expect(res.error).toBeUndefined();
  });

  it('возвращает {works:false} при отказе auth и не раскрывает пароль', async () => {
    const factory = makeFactory({
      connect: vi.fn().mockRejectedValue(new Error(`AUTHENTICATIONFAILED: bad credentials for ${ACCOUNT.password}`)),
    });
    const res = await probeOutlookBasicAuth(ACCOUNT, factory);
    expect(res.works).toBe(false);
    expect(res.error).toBeTruthy();
    expect(res.error).not.toContain(ACCOUNT.password);
    expect(res.error).toContain('[REDACTED]');
  });

  it('не раскрывает пароль и при сетевой ошибке', async () => {
    const factory = makeFactory({
      connect: vi.fn().mockRejectedValue(new Error(`connect ECONNREFUSED ${ACCOUNT.password}`)),
    });
    const res = await probeOutlookBasicAuth(ACCOUNT, factory);
    expect(res.works).toBe(false);
    expect(res.error).not.toContain(ACCOUNT.password);
  });

  it('использует outlook.office365.com:993 с TLS', async () => {
    let capturedOpts: { host: string; port: number; secure?: boolean } | null = null;
    const factory: ImapClientFactory = (opts) => {
      capturedOpts = opts;
      return {
        connect: vi.fn().mockResolvedValue(undefined),
        logout: vi.fn().mockResolvedValue(undefined),
        list: vi.fn().mockResolvedValue([]),
      };
    };
    await probeOutlookBasicAuth(ACCOUNT, factory);
    expect(capturedOpts).not.toBeNull();
    const opts = capturedOpts as { host: string; port: number; secure?: boolean };
    expect(opts.host).toBe(OUTLOOK_IMAP_HOST);
    expect(opts.port).toBe(OUTLOOK_IMAP_PORT);
    expect(opts.secure).toBe(true);
  });

  it('всегда вызывает logout (cleanup) после успеха', async () => {
    const logout = vi.fn().mockResolvedValue(undefined);
    const factory = makeFactory({
      connect: vi.fn().mockResolvedValue(undefined),
      logout,
    });
    await probeOutlookBasicAuth(ACCOUNT, factory);
    expect(logout).toHaveBeenCalledTimes(1);
  });
});