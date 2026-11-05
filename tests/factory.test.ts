import { describe, it, expect } from 'vitest';
import { createMailProvider, createAuthStrategyForAccount } from '../src/tools/mail/providers/factory.js';
import { YandexMailProvider } from '../src/tools/mail/providers/yandex.js';
import { OutlookMailProvider } from '../src/tools/mail/providers/outlook.js';
import { MailRuMailProvider } from '../src/tools/mail/providers/mail-ru.js';
import { smtpConnectionFor, MAIL_RU_SMTP } from '../src/tools/mail/providers/smtp-options.js';
import { BasicAuthStrategy } from '../src/tools/mail/providers/basic-auth.js';
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

const mailBasic: MailAccount = {
  provider: 'mail',
  login: 'alexandr1508@mail.ru',
  password: 'p',
  authStrategy: 'basic',
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

describe('createMailProvider: провайдер mail (Mail.ru)', () => {
  it('(mail, basic) -> MailRuMailProvider', () => {
    const p = createMailProvider(mailBasic, { oauth2 });
    expect(p).toBeInstanceOf(MailRuMailProvider);
    expect(p.providerKind).toBe('mail');
  });
});

describe('createAuthStrategyForAccount', () => {
  it('yandex -> BasicAuthStrategy', () => {
    const s = createAuthStrategyForAccount(yandexBasic);
    expect(s).toBeInstanceOf(BasicAuthStrategy);
  });

  it('mail -> BasicAuthStrategy', () => {
    const s = createAuthStrategyForAccount(mailBasic);
    expect(s).toBeInstanceOf(BasicAuthStrategy);
  });

  it('outlook basic -> BasicAuthStrategy', () => {
    const s = createAuthStrategyForAccount(outlookBasic, { oauth2 });
    expect(s).toBeInstanceOf(BasicAuthStrategy);
  });

  it('outlook oauth2 -> не BasicAuthStrategy (OAuth2-стратегия)', () => {
    const s = createAuthStrategyForAccount(outlookOauth2, { oauth2 });
    expect(s).not.toBeInstanceOf(BasicAuthStrategy);
  });

  it('бросает для неизвестного провайдера', () => {
    const bad = { provider: 'gmail' as unknown as 'yandex', login: 'x', password: 'p' } as MailAccount;
    expect(() => createAuthStrategyForAccount(bad)).toThrow(/неизвестный провайдер/i);
  });
});

describe('smtpConnectionFor: провайдер mail', () => {
  it("mail -> MAIL_RU_SMTP (smtp.mail.ru:465, TLS)", () => {
    expect(smtpConnectionFor('mail')).toBe(MAIL_RU_SMTP);
    expect(smtpConnectionFor('mail')).toEqual({
      host: 'smtp.mail.ru',
      port: 465,
      secure: true,
    });
  });
});