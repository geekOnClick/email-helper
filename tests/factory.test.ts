import { describe, it, expect } from 'vitest';
import { createMailProvider } from '../src/tools/mail/providers/factory.js';
import { YandexMailProvider } from '../src/tools/mail/providers/yandex.js';
import { OutlookMailProvider } from '../src/tools/mail/providers/outlook.js';
import type { MailAccount } from '../src/tools/mail/types.js';

const yandexBasic: MailAccount = {
  provider: 'yandex',
  login: 'a@yandex.com',
  password: 'p',
  authStrategy: 'basic',
};

const outlookBasic: MailAccount = {
  provider: 'outlook',
  login: 'b@outlook.com',
  password: 'p',
  authStrategy: 'basic',
};

const outlookOauth2: MailAccount = {
  provider: 'outlook',
  login: 'b@outlook.com',
  password: 'p',
  authStrategy: 'oauth2',
};

const oauth2 = { clientId: 'ms-client-id', tenant: 'consumers' };

describe('createMailProvider (factory)', () => {
  it('(yandex, basic) -> YandexMailProvider', () => {
    const p = createMailProvider(yandexBasic, { oauth2 });
    expect(p).toBeInstanceOf(YandexMailProvider);
    expect(p.providerKind).toBe('yandex');
  });

  it('(outlook, basic) -> OutlookMailProvider с basic-стратегией и фоллбэком oauth2', () => {
    const p = createMailProvider(outlookBasic, { oauth2 });
    expect(p).toBeInstanceOf(OutlookMailProvider);
    expect(p.providerKind).toBe('outlook');
    // фоллбэк-стратегия присутствует для автоопределения
    expect((p as OutlookMailProvider).getFallbackStrategy()).not.toBeNull();
  });

  it('(outlook, oauth2) -> OutlookMailProvider с oauth2-стратегией, без фолбэка', () => {
    const p = createMailProvider(outlookOauth2, { oauth2 });
    expect(p).toBeInstanceOf(OutlookMailProvider);
    expect((p as OutlookMailProvider).getFallbackStrategy()).toBeNull();
  });

  it('бросает для неизвестного провайдера', () => {
    const bad = { provider: 'gmail' as unknown as 'yandex', login: 'x', password: 'p' } as MailAccount;
    expect(() => createMailProvider(bad)).toThrow(/неизвестный провайдер/i);
  });
});