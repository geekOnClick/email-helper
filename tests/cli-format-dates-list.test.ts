import { describe, it, expect } from 'vitest';
import { formatFindAllTable } from '../src/transport/cli/format.js';
import type { EmailMessage } from '../src/types/email.js';

/** Создаёт Date из YYYY-MM-DD (локальная полночь). */
function d(iso: string): Date {
  const [y, m, day] = iso.split('-').map(Number);
  return new Date(y, m - 1, day);
}

/** Строит EmailMessage. */
function msg(uid: number, iso: string, subject: string, fromAddr = 'a@b.com', fromName?: string): EmailMessage {
  return {
    uid,
    subject,
    from: { address: fromAddr, ...(fromName ? { name: fromName } : {}) },
    to: [{ address: 'me@t.com' }],
    date: d(iso),
    flags: [],
    folder: 'INBOX',
  };
}

describe('formatFindAllTable', () => {
  it('0 писем → пустая строка', () => {
    expect(formatFindAllTable([])).toBe('');
  });

  it('заголовки колонок: Дата письма | Тема письма | Отправитель', () => {
    const out = formatFindAllTable([msg(1, '2024-03-01', 'договор')]);
    expect(out).toContain('Дата письма');
    expect(out).toContain('Тема письма');
    expect(out).toContain('Отправитель');
  });

  it('выводит дату, тему и отправителя для каждого письма', () => {
    const out = formatFindAllTable([
      msg(1, '2024-03-01', 'Уроки истории', 'teacher@school.ru'),
      msg(2, '2024-03-15', 'Re: Уроки истории', 'ivan@yandex.ru'),
    ]);
    expect(out).toContain('2024-03-01');
    expect(out).toContain('Уроки истории');
    expect(out).toContain('teacher@school.ru');
    expect(out).toContain('2024-03-15');
    expect(out).toContain('Re: Уроки истории');
    expect(out).toContain('ivan@yandex.ru');
  });

  it('отправитель с именем → «Name <email>»', () => {
    const out = formatFindAllTable([msg(1, '2024-03-01', 'договор', 'a@b.com', 'Иван')]);
    expect(out).toContain('Иван <a@b.com>');
  });

  it('3 письма → без «найдено ещё»', () => {
    const out = formatFindAllTable([
      msg(1, '2024-03-01', 's1'),
      msg(2, '2024-03-15', 's2'),
      msg(3, '2024-04-02', 's3'),
    ]);
    expect(out).toContain('Найдено писем: 3');
    expect(out).not.toContain('найдено ещё');
  });

  it('ровно 10 писем → без «найдено ещё»', () => {
    const msgs = Array.from({ length: 10 }, (_, i) => msg(i + 1, `2024-01-${String(i + 1).padStart(2, '0')}`, `s${i}`));
    const out = formatFindAllTable(msgs);
    expect(out).toContain('Найдено писем: 10');
    expect(out).not.toContain('найдено ещё');
  });

  it('11 писем → 10 строк + «найдено ещё 1 писем»', () => {
    const msgs = Array.from({ length: 11 }, (_, i) => msg(i + 1, `2024-01-${String(i + 1).padStart(2, '0')}`, `s${i}`));
    const out = formatFindAllTable(msgs);
    expect(out).toContain('Найдено писем: 11');
    expect(out).toContain('найдено ещё 1 писем');
  });

  it('15 писем → 10 строк + «найдено ещё 5 писем»', () => {
    const msgs = Array.from({ length: 15 }, (_, i) => msg(i + 1, `2024-01-${String(i + 1).padStart(2, '0')}`, `s${i}`));
    const out = formatFindAllTable(msgs);
    expect(out).toContain('Найдено писем: 15');
    expect(out).toContain('найдено ещё 5 писем');
  });

  it('нормализует тему с переводами строк в одну строку', () => {
    const out = formatFindAllTable([msg(1, '2024-03-01', 'строка1\nстрока2\tтаб')]);
    expect(out).toContain('строка1 строка2 таб');
    expect(out).not.toContain('строка1\nстрока2');
  });

  it('отсутствующий отправитель → «неизвестно»', () => {
    const m = msg(1, '2024-03-01', 's');
    m.from = undefined;
    const out = formatFindAllTable([m]);
    expect(out).toContain('неизвестно');
  });
});
