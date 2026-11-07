import { describe, it, expect } from 'vitest';
import {
  parseFindAllLine,
  validateFindAllValue,
  validateFindAllRange,
  promptFindAllCriteria,
  buildSearchArgsFromFindAll,
  type FindAllCriteriaInput,
} from '../src/transport/cli/prompts.js';
import { MockConsoleIO } from './mock-io.js';

describe('parseFindAllLine', () => {
  it('парсит тему', () => {
    expect(parseFindAllLine('тема - уроки истории')).toEqual({ field: 'тема', value: 'уроки истории' });
  });

  it('парсит отправителя', () => {
    expect(parseFindAllLine('отправитель - a@b.com')).toEqual({ field: 'отправитель', value: 'a@b.com' });
  });

  it('парсит дату с', () => {
    expect(parseFindAllLine('дата с - 2024-01-01')).toEqual({ field: 'дата с', value: '2024-01-01' });
  });

  it('парсит дату по', () => {
    expect(parseFindAllLine('дата по - 2024-12-31')).toEqual({ field: 'дата по', value: '2024-12-31' });
  });

  it('возвращает null для пустой строки', () => {
    expect(parseFindAllLine('')).toBeNull();
    expect(parseFindAllLine('   ')).toBeNull();
  });

  it('возвращает null без разделителя', () => {
    expect(parseFindAllLine('тема договора')).toBeNull();
  });

  it('возвращает null для неизвестного поля', () => {
    expect(parseFindAllLine('цвет - синий')).toBeNull();
  });

  it('возвращает null для пустого значения', () => {
    expect(parseFindAllLine('тема - ')).toBeNull();
  });
});

describe('validateFindAllValue', () => {
  it('тема — непустая', () => {
    expect(validateFindAllValue('тема', 'договор')).toBeNull();
    expect(validateFindAllValue('тема', '')).not.toBeNull();
  });

  it('отправитель — email', () => {
    expect(validateFindAllValue('отправитель', 'a@b.com')).toBeNull();
    expect(validateFindAllValue('отправитель', 'not-email')).not.toBeNull();
  });

  it('дата с — ISO YYYY-MM-DD', () => {
    expect(validateFindAllValue('дата с', '2024-06-15')).toBeNull();
    expect(validateFindAllValue('дата с', '2024-13-45')).not.toBeNull();
    expect(validateFindAllValue('дата с', '15-06-2024')).not.toBeNull();
  });

  it('дата по — ISO YYYY-MM-DD', () => {
    expect(validateFindAllValue('дата по', '2024-02-28')).toBeNull();
    expect(validateFindAllValue('дата по', '2024-02-30')).not.toBeNull(); // 30 февраля
  });
});

describe('validateFindAllRange', () => {
  it('OK когда оба поля отсутствуют', () => {
    expect(validateFindAllRange({})).toBeNull();
  });

  it('OK когда только одно поле', () => {
    expect(validateFindAllRange({ dateFrom: '2024-01-01' })).toBeNull();
    expect(validateFindAllRange({ dateTo: '2024-12-31' })).toBeNull();
  });

  it('OK когда с <= по', () => {
    expect(validateFindAllRange({ dateFrom: '2024-01-01', dateTo: '2024-12-31' })).toBeNull();
    expect(validateFindAllRange({ dateFrom: '2024-06-01', dateTo: '2024-06-01' })).toBeNull();
  });

  it('ошибка когда с > по', () => {
    expect(validateFindAllRange({ dateFrom: '2024-12-31', dateTo: '2024-01-01' })).not.toBeNull();
  });
});

describe('promptFindAllCriteria', () => {
  it('ввод только темы', async () => {
    const io = new MockConsoleIO(['тема - уроки истории', '']);
    const result = await promptFindAllCriteria(io);
    expect(result).toEqual({ subject: 'уроки истории' });
  });

  it('ввод темы и диапазона дат', async () => {
    const io = new MockConsoleIO(['тема - уроки истории', 'дата с - 2024-01-01', 'дата по - 2024-12-31', '']);
    const result = await promptFindAllCriteria(io);
    expect(result).toEqual({
      subject: 'уроки истории',
      dateFrom: '2024-01-01',
      dateTo: '2024-12-31',
    });
  });

  it('диапазон дат без темы', async () => {
    const io = new MockConsoleIO(['дата с - 2024-06-01', 'дата по - 2024-06-30', '']);
    const result = await promptFindAllCriteria(io);
    expect(result).toEqual({ dateFrom: '2024-06-01', dateTo: '2024-06-30' });
  });

  it('отправитель без темы', async () => {
    const io = new MockConsoleIO(['отправитель - a@b.com', '']);
    const result = await promptFindAllCriteria(io);
    expect(result).toEqual({ from: 'a@b.com' });
  });

  it('невалидная дата — повтор ввода', async () => {
    const io = new MockConsoleIO(['дата с - 2024-13-45', 'дата с - 2024-06-01', '']);
    const result = await promptFindAllCriteria(io);
    expect(result).toEqual({ dateFrom: '2024-06-01' });
    expect(io.output()).toContain('дата должна быть в формате YYYY-MM-DD');
  });

  it('невалидный диапазон (с позже по) — повтор ввода даты по', async () => {
    const io = new MockConsoleIO([
      'дата с - 2024-12-31',
      'дата по - 2024-01-01',
      'дата по - 2024-12-31',
      '',
    ]);
    const result = await promptFindAllCriteria(io);
    expect(result).toEqual({ dateFrom: '2024-12-31', dateTo: '2024-12-31' });
    expect(io.output()).toContain('дата «с» должна быть не позже даты «по»');
  });

  it('дубликат поля — повтор ввода', async () => {
    const io = new MockConsoleIO(['тема - X', 'тема - Y', '']);
    const result = await promptFindAllCriteria(io);
    expect(result).toEqual({ subject: 'X' });
    expect(io.output()).toContain('уже введено');
  });

  it('пустой ввод без полей — отмена (null)', async () => {
    const io = new MockConsoleIO(['']);
    const result = await promptFindAllCriteria(io);
    expect(result).toBeNull();
  });

  it('невалидный формат — повтор ввода', async () => {
    const io = new MockConsoleIO(['тема договора', 'тема - договор', '']);
    const result = await promptFindAllCriteria(io);
    expect(result).toEqual({ subject: 'договор' });
    expect(io.output()).toContain('Неверный формат');
  });

  it('EOF после полей — возвращает что есть', async () => {
    const io = new MockConsoleIO(['тема - договор']);
    const result = await promptFindAllCriteria(io);
    expect(result).toEqual({ subject: 'договор' });
  });
});

describe('buildSearchArgsFromFindAll', () => {
  it('subject/from остаются для локального фильтра (не идут в serverCriteria)', () => {
    const args = buildSearchArgsFromFindAll({ subject: 'договор', from: 'a@b.com' });
    expect(args.subject).toBe('договор');
    expect(args.from).toBe('a@b.com');
    // subject/from не попадают в serverCriteria
    expect(args.serverCriteria).not.toHaveProperty('subject');
    expect(args.serverCriteria).not.toHaveProperty('from');
  });

  it('без диапазона — bounded since (now − maxHistoryDays), не 1970', () => {
    const args = buildSearchArgsFromFindAll({ subject: 'договор' });
    expect(args.serverCriteria.since).toBeInstanceOf(Date);
    expect(args.serverCriteria.before).toBeUndefined();
    // since ≈ now − 1095 дней (3 года), в пределах минуты.
    const since = args.serverCriteria.since as Date;
    const expected = Date.now() - 1095 * 24 * 60 * 60 * 1000;
    expect(Math.abs(since.getTime() - expected)).toBeLessThan(60_000);
  });

  it('без диапазона — maxHistoryDays переопределяет потолок глубины', () => {
    const args = buildSearchArgsFromFindAll({ subject: 'договор' }, 365);
    const since = args.serverCriteria.since as Date;
    const expected = Date.now() - 365 * 24 * 60 * 60 * 1000;
    expect(Math.abs(since.getTime() - expected)).toBeLessThan(60_000);
  });

  it('только dateFrom (в пределах потолка) — since = полночь dateFrom, без before', () => {
    const args = buildSearchArgsFromFindAll({ dateFrom: '2024-06-01' });
    expect(args.serverCriteria.since).toEqual(new Date(2024, 5, 1));
    expect(args.serverCriteria.before).toBeUndefined();
  });

  it('старый dateFrom (раньше потолка) — since обрезается к now − maxHistoryDays', () => {
    // 2010 год раньше потолка 3 года → since = now − 1095дн, не 2010.
    const args = buildSearchArgsFromFindAll({ dateFrom: '2010-01-01' });
    const since = args.serverCriteria.since as Date;
    const expected = Date.now() - 1095 * 24 * 60 * 60 * 1000;
    expect(Math.abs(since.getTime() - expected)).toBeLessThan(60_000);
  });

  it('только dateTo — bounded since (now − maxHistoryDays) + before = следующий день (включительность)', () => {
    const args = buildSearchArgsFromFindAll({ dateTo: '2024-12-31' });
    expect(args.serverCriteria.since).toBeInstanceOf(Date);
    // «по 2024-12-31» включительно → before = 2025-01-01 (тул: msg.date >= before → отсев)
    expect(args.serverCriteria.before).toEqual(new Date(2025, 0, 1));
  });

  it('полный диапазон — since=полночь from, before=следующий день после to', () => {
    const args = buildSearchArgsFromFindAll({ dateFrom: '2024-01-01', dateTo: '2024-12-31' });
    expect(args.serverCriteria.since).toEqual(new Date(2024, 0, 1));
    expect(args.serverCriteria.before).toEqual(new Date(2025, 0, 1));
  });

  it('пустые критерии — bounded since (now − maxHistoryDays), без subject/from', () => {
    const args = buildSearchArgsFromFindAll({} as FindAllCriteriaInput);
    expect(args.serverCriteria.since).toBeInstanceOf(Date);
    expect(args.serverCriteria.before).toBeUndefined();
    expect(args.subject).toBeUndefined();
    expect(args.from).toBeUndefined();
  });

  it('включительность dateTo при совпадении dateFrom==dateTo', () => {
    const args = buildSearchArgsFromFindAll({ dateFrom: '2024-06-15', dateTo: '2024-06-15' });
    expect(args.serverCriteria.since).toEqual(new Date(2024, 5, 15));
    // один день включительно: since=2024-06-15, before=2024-06-16
    expect(args.serverCriteria.before).toEqual(new Date(2024, 5, 16));
  });
});
