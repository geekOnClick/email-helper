import { describe, it, expect } from 'vitest';
import {
  parseCriteriaLine,
  validateValue,
  promptSearchCriteria,
  promptAccount,
  promptUid,
  promptConfirm,
  toSearchCriteria,
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

describe('toSearchCriteria', () => {
  it('дата → since/before одного дня включительно', () => {
    const c = toSearchCriteria({ date: '2026-11-03' });
    // since = полночь 2026-11-03
    expect(c.since).toEqual(new Date(2026, 10, 3));
    // before = полночь 2026-11-04 (следующий день) → весь 2026-11-03 включается
    expect(c.before).toEqual(new Date(2026, 10, 4));
    expect(c.subject).toBeUndefined();
    expect(c.from).toBeUndefined();
  });

  it('тема + отправитель → пробрасываются как есть', () => {
    const c = toSearchCriteria({
      subject: 'Интернет-магазин "Сестрица" - Новый заказ',
      from: 'noreply@voda-sestrica.ru',
    });
    expect(c.subject).toBe('Интернет-магазин "Сестрица" - Новый заказ');
    expect(c.from).toBe('noreply@voda-sestrica.ru');
    expect(c.since).toBeUndefined();
    expect(c.before).toBeUndefined();
  });

  it('тема + дата + отправитель → полный критерий с диапазоном одного дня', () => {
    // Воспроизводит сценарий бага: тема + отправитель + дата 2026-11-03.
    // Раньше date игнорировался → возвращались письма из 2023. Теперь date
    // становится since=2026-11-03 + before=2026-11-04 → ровно один день.
    const c = toSearchCriteria({
      subject: 'Интернет-магазин "Сестрица" - Новый заказ',
      from: 'noreply@voda-sestrica.ru',
      date: '2026-11-03',
    });
    expect(c.subject).toBe('Интернет-магазин "Сестрица" - Новый заказ');
    expect(c.from).toBe('noreply@voda-sestrica.ru');
    expect(c.since).toEqual(new Date(2026, 10, 3));
    expect(c.before).toEqual(new Date(2026, 10, 4));
  });

  it('пустой ввод → пустой критерий', () => {
    const c = toSearchCriteria({});
    expect(c).toEqual({});
  });

  it('before точно отсекает следующий день (граница диапазона)', () => {
    // Письмо от 2026-11-04 00:00:00 не должно попасть в диапазон 2026-11-03.
    // matchesCriteria: msg.date >= before → false → отсев.
    const c = toSearchCriteria({ date: '2026-11-03' });
    const before = c.before as Date;
    const nextDayMidnight = new Date(2026, 10, 4, 0, 0, 0, 0);
    expect(nextDayMidnight >= before).toBe(true); // отсечётся
    // Письмо от 2026-11-03 23:59:59 должно попасть.
    const sameDayLate = new Date(2026, 10, 3, 23, 59, 59);
    expect(sameDayLate >= (c.since as Date)).toBe(true);
    expect(sameDayLate < before).toBe(true);
  });
});
