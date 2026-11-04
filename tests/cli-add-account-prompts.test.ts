import { describe, it, expect } from 'vitest';
import { promptAccountFields, type AddAccountInput } from '../src/transport/cli/prompts.js';
import { MockConsoleIO } from './mock-io.js';

describe('promptAccountFields (мастер /add-account)', () => {
  it('валидный ввод всех обязательных полей + authStrategy', async () => {
    const io = new MockConsoleIO([
      'provider - yandex',
      'login - user@yandex.com',
      'password - app-pwd',
      'authStrategy - oauth2',
      '', // завершить
    ]);
    const result = await promptAccountFields(io);
    expect(result).toEqual({
      provider: 'yandex',
      login: 'user@yandex.com',
      password: 'app-pwd',
      authStrategy: 'oauth2',
    } satisfies AddAccountInput);
  });

  it('опц. authStrategy по умолчанию basic', async () => {
    const io = new MockConsoleIO([
      'provider - yandex',
      'login - user@yandex.com',
      'password - app-pwd',
      '', // завершить без authStrategy
    ]);
    const result = await promptAccountFields(io);
    expect(result?.authStrategy).toBe('basic');
  });

  it('невалидный provider — повтор ввода', async () => {
    const io = new MockConsoleIO([
      'provider - gmail',
      'provider - yandex',
      'login - user@yandex.com',
      'password - app-pwd',
      '',
    ]);
    const result = await promptAccountFields(io);
    expect(result?.provider).toBe('yandex');
    expect(io.output()).toContain('provider должен быть yandex или outlook');
  });

  it('пустой login — повтор ввода', async () => {
    const io = new MockConsoleIO([
      'provider - yandex',
      'login - ',
      'login - user@yandex.com',
      'password - app-pwd',
      '',
    ]);
    // Замечание: parseAddAccountLine вернёт null для пустого значения, поэтому
    // сообщение будет «Неверный формат» (как в других мастерах). Проверяем, что
    // в итоге login принят.
    const result = await promptAccountFields(io);
    expect(result?.login).toBe('user@yandex.com');
  });

  it('пустой password — повтор ввода', async () => {
    const io = new MockConsoleIO([
      'provider - yandex',
      'login - user@yandex.com',
      'password - ',
      'password - app-pwd',
      '',
    ]);
    const result = await promptAccountFields(io);
    expect(result?.password).toBe('app-pwd');
  });

  it('невалидный authStrategy — повтор ввода', async () => {
    const io = new MockConsoleIO([
      'provider - yandex',
      'login - user@yandex.com',
      'password - app-pwd',
      'authStrategy - magic',
      'authStrategy - oauth2',
      '',
    ]);
    const result = await promptAccountFields(io);
    expect(result?.authStrategy).toBe('oauth2');
    expect(io.output()).toContain('authStrategy должен быть basic или oauth2');
  });

  it('пустая строка сразу → отмена (null)', async () => {
    const io = new MockConsoleIO(['']);
    const result = await promptAccountFields(io);
    expect(result).toBeNull();
  });

  it('пустая строка после части полей (нет всех обязательных) → отмена', async () => {
    const io = new MockConsoleIO([
      'provider - yandex',
      '', // нет login/password
    ]);
    const result = await promptAccountFields(io);
    expect(result).toBeNull();
  });

  it('EOF → отмена', async () => {
    const io = new MockConsoleIO(['provider - yandex']);
    const result = await promptAccountFields(io);
    expect(result).toBeNull();
  });

  it('невалидный формат строки → повтор', async () => {
    const io = new MockConsoleIO([
      'provider yandex', // без разделителя
      'provider - yandex',
      'login - user@yandex.com',
      'password - app-pwd',
      '',
    ]);
    const result = await promptAccountFields(io);
    expect(result?.provider).toBe('yandex');
    expect(io.output()).toContain('Неверный формат');
  });

  it('повтор поля — сообщение, повтор игнорируется', async () => {
    const io = new MockConsoleIO([
      'provider - yandex',
      'provider - outlook',
      'login - user@yandex.com',
      'password - app-pwd',
      '',
    ]);
    const result = await promptAccountFields(io);
    // Первое значение сохраняется.
    expect(result?.provider).toBe('yandex');
    expect(io.output()).toContain('уже введено');
  });
});
