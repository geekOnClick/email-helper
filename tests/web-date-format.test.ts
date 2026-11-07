/**
 * Unit-тесты утилиты ввода даты веб-форм (change web-interface).
 *
 * Покрывают конвертацию пользовательского формата `ДД.ММ.ГГ`/`ДД.ММ.ГГГГ`
 * в ISO `YYYY-MM-DD` (контракт бэкенда) и валидацию (негативные случаи).
 */
import { describe, it, expect } from 'vitest';
import { parseDisplayDate } from '../src/transport/web/client/dateFormat.js';

describe('parseDisplayDate', () => {
  describe('корректные даты', () => {
    it('ДД.ММ.ГГ → ISO с раскруткой века (pivot 70)', () => {
      expect(parseDisplayDate('03.11.26')).toEqual({ ok: true, iso: '2026-11-03' });
      expect(parseDisplayDate('15.01.00')).toEqual({ ok: true, iso: '2000-01-15' });
      expect(parseDisplayDate('15.01.69')).toEqual({ ok: true, iso: '2069-01-15' });
      expect(parseDisplayDate('15.01.70')).toEqual({ ok: true, iso: '1970-01-15' });
      expect(parseDisplayDate('31.12.99')).toEqual({ ok: true, iso: '1999-12-31' });
    });

    it('ДД.ММ.ГГГГ → ISO как есть', () => {
      expect(parseDisplayDate('03.11.2026')).toEqual({ ok: true, iso: '2026-11-03' });
      expect(parseDisplayDate('29.02.2024')).toEqual({ ok: true, iso: '2024-02-29' });
    });

    it('однозначные день/месяц', () => {
      expect(parseDisplayDate('3.5.26')).toEqual({ ok: true, iso: '2026-05-03' });
      expect(parseDisplayDate('3.5.2026')).toEqual({ ok: true, iso: '2026-05-03' });
    });

    it('терпит разделители / и -', () => {
      expect(parseDisplayDate('03/11/26')).toEqual({ ok: true, iso: '2026-11-03' });
      expect(parseDisplayDate('03-11-2026')).toEqual({ ok: true, iso: '2026-11-03' });
    });

    it('пробелы вокруг обрезаются', () => {
      expect(parseDisplayDate('  03.11.26  ')).toEqual({ ok: true, iso: '2026-11-03' });
    });

    it('пустая строка → ok с пустым iso (нет даты)', () => {
      expect(parseDisplayDate('')).toEqual({ ok: true, iso: '' });
      expect(parseDisplayDate('   ')).toEqual({ ok: true, iso: '' });
    });
  });

  describe('валидация', () => {
    it('несуществующая дата месяца', () => {
      const r = parseDisplayDate('31.02.2026');
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/несуществующая/i);
    });

    it('29 февраля не в високосный год', () => {
      const r = parseDisplayDate('29.02.2025');
      expect(r.ok).toBe(false);
    });

    it('29 февраля в високосный год — ок', () => {
      expect(parseDisplayDate('29.02.2024')).toEqual({ ok: true, iso: '2024-02-29' });
    });

    it('несуществующий месяц', () => {
      const r = parseDisplayDate('03.13.26');
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/месяц/i);
    });

    it('несуществующий день', () => {
      const r = parseDisplayDate('00.11.26');
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/день/i);
    });

    it('неверный формат — буквы', () => {
      const r = parseDisplayDate('абв.11.26');
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/формат/i);
    });

    it('неверный формат — только год', () => {
      const r = parseDisplayDate('2026');
      expect(r.ok).toBe(false);
    });

    it('неверный формат — ISO YYYY-MM-DD напрямую не принимается как ДД.ММ.ГГ', () => {
      // '2026-11-03' разбирается как ДД=2026 → день > 31 → ошибка
      const r = parseDisplayDate('2026-11-03');
      expect(r.ok).toBe(false);
    });

    it('однозначный год (1 цифра) не принимается', () => {
      const r = parseDisplayDate('03.11.6');
      expect(r.ok).toBe(false);
    });
  });
});
