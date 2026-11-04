import { describe, it, expect } from 'vitest';
import { AccountRegistry } from '../src/config/account-registry.js';
import type { MailAccount } from '../src/tools/mail/types.js';

const yandexAccount: MailAccount = {
  provider: 'yandex',
  login: 'user@yandex.com',
  password: 'yandex-pass',
  authStrategy: 'basic',
};

const outlookAccount: MailAccount = {
  provider: 'outlook',
  login: 'user@outlook.com',
  password: 'outlook-pass',
  authStrategy: 'oauth2',
};

describe('AccountRegistry', () => {
  describe('инициализация из массива', () => {
    it('init-from-array: содержит переданные аккаунты', () => {
      const registry = new AccountRegistry([yandexAccount, outlookAccount]);
      expect(registry.list()).toHaveLength(2);
      expect(registry.list()).toEqual([yandexAccount, outlookAccount]);
    });

    it('пустой конструктор → пустой реестр', () => {
      const registry = new AccountRegistry();
      expect(registry.list()).toHaveLength(0);
    });

    it('list() возвращает копию — внешняя мутация не влияет на реестр', () => {
      const registry = new AccountRegistry([yandexAccount]);
      const list = registry.list();
      list.push(outlookAccount);
      expect(registry.list()).toHaveLength(1);
    });

    it('конструктор копирует массив — мутация исходного не влияет на реестр', () => {
      const initial = [yandexAccount];
      const registry = new AccountRegistry(initial);
      initial.push(outlookAccount);
      expect(registry.list()).toHaveLength(1);
    });
  });

  describe('findByProviderLogin', () => {
    it('найден по точной паре (provider, login)', () => {
      const registry = new AccountRegistry([yandexAccount, outlookAccount]);
      expect(registry.findByProviderLogin('yandex', 'user@yandex.com')).toEqual(yandexAccount);
    });

    it('не найден — login существует с другим provider', () => {
      const registry = new AccountRegistry([yandexAccount]);
      // login user@yandex.com есть, но provider outlook — нет
      expect(registry.findByProviderLogin('outlook', 'user@yandex.com')).toBeUndefined();
    });

    it('не найден — login отсутствует вообще', () => {
      const registry = new AccountRegistry([yandexAccount]);
      expect(registry.findByProviderLogin('yandex', 'nobody@yandex.com')).toBeUndefined();
    });

    it('не раскрывает пароли при промахе (возвращает undefined)', () => {
      const registry = new AccountRegistry([yandexAccount]);
      const result = registry.findByProviderLogin('yandex', 'nobody@yandex.com');
      expect(result).toBeUndefined();
    });
  });

  describe('findByLogin', () => {
    it('найден по login без учёта provider', () => {
      const registry = new AccountRegistry([yandexAccount]);
      expect(registry.findByLogin('user@yandex.com')).toEqual(yandexAccount);
    });

    it('не найден — login отсутствует', () => {
      const registry = new AccountRegistry([yandexAccount]);
      expect(registry.findByLogin('nobody@yandex.com')).toBeUndefined();
    });
  });

  describe('upsert (add-or-replace по login)', () => {
    it('upsert нового аккаунта — добавляется в конец', () => {
      const registry = new AccountRegistry([yandexAccount]);
      registry.upsert(outlookAccount);
      expect(registry.list()).toHaveLength(2);
      expect(registry.findByProviderLogin('outlook', 'user@outlook.com')).toEqual(outlookAccount);
    });

    it('upsert-перезапись: прежний пароль более недоступен', () => {
      const registry = new AccountRegistry([yandexAccount]);
      const updated: MailAccount = {
        provider: 'yandex',
        login: 'user@yandex.com',
        password: 'new-password',
        authStrategy: 'basic',
      };
      registry.upsert(updated);
      expect(registry.list()).toHaveLength(1);
      const found = registry.findByProviderLogin('yandex', 'user@yandex.com');
      expect(found?.password).toBe('new-password');
      // Прежний пароль больше не возвращается ни через один из методов.
      expect(registry.list().some((a) => a.password === 'yandex-pass')).toBe(false);
    });

    it('upsert-перезапись меняет provider и authStrategy', () => {
      const registry = new AccountRegistry([yandexAccount]);
      const updated: MailAccount = {
        provider: 'outlook',
        login: 'user@yandex.com',
        password: 'new-pass',
        authStrategy: 'oauth2',
      };
      registry.upsert(updated);
      expect(registry.findByProviderLogin('yandex', 'user@yandex.com')).toBeUndefined();
      expect(registry.findByProviderLogin('outlook', 'user@yandex.com')).toEqual(updated);
    });
  });

  describe('has', () => {
    it('true, если login присутствует (любой provider)', () => {
      const registry = new AccountRegistry([yandexAccount]);
      expect(registry.has('user@yandex.com')).toBe(true);
    });

    it('false, если login отсутствует', () => {
      const registry = new AccountRegistry([yandexAccount]);
      expect(registry.has('nobody@yandex.com')).toBe(false);
    });

    it('отражает upsert немедленно', () => {
      const registry = new AccountRegistry();
      expect(registry.has('user@yandex.com')).toBe(false);
      registry.upsert(yandexAccount);
      expect(registry.has('user@yandex.com')).toBe(true);
    });
  });
});
