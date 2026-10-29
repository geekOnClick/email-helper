import { describe, it, expect } from 'vitest';
import {
  parseCriteriaLine,
  validateValue,
  promptSearchCriteria,
  promptSendCriteria,
  promptAccount,
  promptUid,
  promptConfirm,
} from '../src/transport/cli/prompts.js';
import { MockConsoleIO } from './mock-io.js';
import type { MailAccount } from '../src/tools/mail/types.js';
import type { EmailMessage } from '../src/types/email.js';

function makeAccount(login: string, provider: 'yandex' | 'outlook' = 'yandex'): MailAccount {
  return { provider, login, password: 'stub', authStrategy: 'basic' };
}

function makeMessage(uid: number, subject: string): EmailMessage {
  return {
    uid,
    subject,
    from: { address: 'sender@example.com' },
    to: [{ address: 'me@test.com' }],
    date: new Date('2026-10-01'),
    flags: [],
    folder: 'INBOX',
  };
}

describe('parseCriteriaLine', () => {
  it('корректный парсинг «тема - договор»', () => {
    expect(parseCriteriaLine('тема - договор')).toEqual({ field: 'тема', value: 'договор' });
  });
  it('корректный парсинг «дата - 2026-10-01»', () => {
    expect(parseCriteriaLine('дата - 2026-10-01')).toEqual({ field: 'дата', value: '2026-10-01' });
  });
  it('корректный парсинг «отправитель - a@b.com»', () => {
    expect(parseCriteriaLine('отправитель - a@b.com')).toEqual({ field: 'отправитель', value: 'a@b.com' });
  });
  it('тримит пробелы вокруг', () => {
    expect(parseCriteriaLine('  тема  -  договор  ')).toEqual({ field: 'тема', value: 'договор' });
  });
  it('возвращает null для строки без разделителя', () => {
    expect(parseCriteriaLine('тема договора')).toBeNull();
  });
  it('возвращает null для пустого значения', () => {
    expect(parseCriteriaLine('тема -')).toBeNull();
  });
  it('возвращает null для неизвестного поля', () => {
    expect(parseCriteriaLine('папка - INBOX')).toBeNull();
  });
  it('возвращает null для пустой строки', () => {
    expect(parseCriteriaLine('')).toBeNull();
  });
});

describe('validateValue', () => {
  it('тема — непустое значение валидно', () => {
    expect(validateValue('тема', 'договор')).toBeNull();
  });
  it('дата — корректная ISO-дата валидна', () => {
    expect(validateValue('дата', '2026-10-01')).toBeNull();
  });
  it('дата — 31 февраля невалидна', () => {
    expect(validateValue('дата', '2026-02-31')).not.toBeNull();
  });
  it('дата — месяц 13 невалиден', () => {
    expect(validateValue('дата', '2026-13-01')).not.toBeNull();
  });
  it('дата — неправильный формат невалиден', () => {
    expect(validateValue('дата', '01.10.2026')).not.toBeNull();
  });
  it('отправитель — корректный email валиден', () => {
    expect(validateValue('отправитель', 'a@b.com')).toBeNull();
  });
  it('отправитель — некорректный email', () => {
    expect(validateValue('отправитель', 'not-an-email')).not.toBeNull();
  });
});

describe('promptSearchCriteria', () => {
  it('сбор 3 полей', async () => {
    const io = new MockConsoleIO([
      'тема - договор',
      'дата - 2026-10-01',
      'отправитель - legal@example.com',
      '',
    ]);
    const result = await promptSearchCriteria(io);
    expect(result).toEqual({
      subject: 'договор',
      date: '2026-10-01',
      from: 'legal@example.com',
    });
  });
  it('невалидная дата → повтор, потом валидная', async () => {
    const io = new MockConsoleIO(['дата - 2026-13-01', 'дата - 2026-10-01', '']);
    const result = await promptSearchCriteria(io);
    expect(result).toEqual({ date: '2026-10-01' });
    expect(io.output()).toContain('дата должна быть');
  });
  it('невалидный email → повтор', async () => {
    const io = new MockConsoleIO(['отправитель - bad', 'отправитель - a@b.com', '']);
    const result = await promptSearchCriteria(io);
    expect(result).toEqual({ from: 'a@b.com' });
    expect(io.output()).toContain('некорректный email');
  });
  it('невалидный формат строки → повтор', async () => {
    const io = new MockConsoleIO(['тема договора', 'тема - договор', '']);
    const result = await promptSearchCriteria(io);
    expect(result).toEqual({ subject: 'договор' });
    expect(io.output()).toContain('Неверный формат');
  });
  it('пустой ввод после одного поля → критерии', async () => {
    const io = new MockConsoleIO(['тема - договор', '']);
    const result = await promptSearchCriteria(io);
    expect(result).toEqual({ subject: 'договор' });
  });
  it('пустой ввод сразу → отмена (null)', async () => {
    const io = new MockConsoleIO(['']);
    const result = await promptSearchCriteria(io);
    expect(result).toBeNull();
  });
  it('EOF → отмена если ничего не введено', async () => {
    const io = new MockConsoleIO([]);
    const result = await promptSearchCriteria(io);
    expect(result).toBeNull();
  });
  it('повторное поле → предупреждение', async () => {
    const io = new MockConsoleIO(['тема - а', 'тема - б', '']);
    const result = await promptSearchCriteria(io);
    expect(result).toEqual({ subject: 'а' });
    expect(io.output()).toContain('уже введено');
  });
});

describe('promptSendCriteria', () => {
  it('полный сбор тема/текст/получатель', async () => {
    const io = new MockConsoleIO([
      'тема - ответ',
      'текст - тело письма',
      'получатель - dest@example.com',
      '',
    ]);
    const result = await promptSendCriteria(io);
    expect(result).toEqual({
      subject: 'ответ',
      text: 'тело письма',
      to: 'dest@example.com',
    });
  });
  it('неполный набор (нет получателя) → null', async () => {
    const io = new MockConsoleIO(['тема - ответ', 'текст - тело', '']);
    const result = await promptSendCriteria(io);
    expect(result).toBeNull();
  });
  it('невалидный email получателя → повтор', async () => {
    const io = new MockConsoleIO([
      'тема - ответ',
      'текст - тело',
      'получатель - bad',
      'получатель - ok@example.com',
      '',
    ]);
    const result = await promptSendCriteria(io);
    expect(result?.to).toBe('ok@example.com');
  });
});

describe('promptAccount', () => {
  it('0 аккаунтов → null + сообщение', async () => {
    const io = new MockConsoleIO([]);
    const result = await promptAccount(io, []);
    expect(result).toBeNull();
    expect(io.output()).toContain('Нет настроенных');
  });
  it('1 аккаунт → авто-выбор без запроса', async () => {
    const io = new MockConsoleIO([]);
    const acc = makeAccount('one@yandex.com');
    const result = await promptAccount(io, [acc]);
    expect(result).toBe(acc);
    expect(io.output()).not.toContain('Выберите аккаунт');
  });
  it('2 аккаунта → список + выбор', async () => {
    const a1 = makeAccount('one@yandex.com');
    const a2 = makeAccount('two@outlook.com', 'outlook');
    const io = new MockConsoleIO(['1']);
    const result = await promptAccount(io, [a1, a2]);
    expect(result).toBe(a1);
    expect(io.output()).toContain('one@yandex.com');
    expect(io.output()).toContain('two@outlook.com');
  });
  it('2 аккаунта → невалидный ввод → повтор', async () => {
    const a1 = makeAccount('one@yandex.com');
    const a2 = makeAccount('two@yandex.com');
    const io = new MockConsoleIO(['abc', '2']);
    const result = await promptAccount(io, [a1, a2]);
    expect(result).toBe(a2);
    expect(io.output()).toContain('число от 1 до 2');
  });
});

describe('promptUid', () => {
  it('показ 5 писем + выбор UID', async () => {
    const msgs = [1, 2, 3, 4, 5, 6].map((i) => makeMessage(i, `письмо ${i}`));
    const io = new MockConsoleIO(['3']);
    const result = await promptUid(io, msgs);
    expect(result).toBe(3);
    expect(io.output()).toContain('UID=1');
    expect(io.output()).toContain('UID=5');
    expect(io.output()).not.toContain('UID=6');
  });
  it('UID не из списка → повтор', async () => {
    const msgs = [makeMessage(10, 'тест')];
    const io = new MockConsoleIO(['99', '10']);
    const result = await promptUid(io, msgs);
    expect(result).toBe(10);
    expect(io.output()).toContain('не найден');
  });
  it('пустой ввод → отмена (null)', async () => {
    const msgs = [makeMessage(10, 'тест')];
    const io = new MockConsoleIO(['']);
    const result = await promptUid(io, msgs);
    expect(result).toBeNull();
  });
});

describe('promptConfirm', () => {
  it('«да» → true', async () => {
    const io = new MockConsoleIO(['да']);
    expect(await promptConfirm(io, 'Отправить?')).toBe(true);
  });
  it('«нет» → false', async () => {
    const io = new MockConsoleIO(['нет']);
    expect(await promptConfirm(io, 'Отправить?')).toBe(false);
  });
  it('«yes» → true', async () => {
    const io = new MockConsoleIO(['yes']);
    expect(await promptConfirm(io, 'Отправить?')).toBe(true);
  });
  it('EOF → false', async () => {
    const io = new MockConsoleIO([]);
    expect(await promptConfirm(io, 'Отправить?')).toBe(false);
  });
});
