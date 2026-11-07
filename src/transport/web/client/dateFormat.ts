/**
 * Утилиты ввода даты для веб-форм (change web-interface).
 *
 * Пользовательский формат ввода — `ДД.ММ.ГГ` (например `03.11.26`), также
 * принимается полный год `ДД.ММ.ГГГГ` (`03.11.2026`). Разделитель — точка
 * (также терпим к `/` и `-`, чтобы не ломать ввод при опечатке).
 *
 * На стороне клиента ввод конвертируется в ISO `YYYY-MM-DD`, который ожидает
 * бэкенд (`toSearchCriteria`/`isoToDate` в cli/prompts). Сам бэкенд не трогаем,
 * его контракт и тесты остаются как есть.
 */

export type ParsedDate =
  | { ok: true; iso: string }
  | { ok: false; error: string };

/**
 * Разбирает строку `ДД.ММ.ГГ`/`ДД.ММ.ГГГГ` и возвращает ISO `YYYY-MM-DD` либо
 * понятную ошибку валидации. Пустая строка трактуется как «нет даты» (ok=true,
 * iso='' — вызывающая сторона сама решает, пропускать ли пустое значение).
 *
 * Двузначный год раскрывается по pivot 70: 00–69 → 20xx, 70–99 → 19xx.
 */
export function parseDisplayDate(input: string): ParsedDate {
  const raw = input.trim();
  if (raw === '') return { ok: true, iso: '' };

  const m = /^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{2,4})$/.exec(raw);
  if (!m) {
    return { ok: false, error: 'Дата в формате ДД.ММ.ГГ (например 03.11.26)' };
  }

  const day = Number(m[1]);
  const month = Number(m[2]);
  const yearStr = m[3] ?? '';
  let year = Number(yearStr);

  if (yearStr.length <= 2) {
    // pivot 70: 00–69 → 2000–2069, 70–99 → 1970–1999
    year += year >= 70 ? 1900 : 2000;
  }

  if (month < 1 || month > 12) {
    return { ok: false, error: `Неверный месяц: ${m[2]}` };
  }
  if (day < 1 || day > 31) {
    return { ok: false, error: `Неверный день: ${m[1]}` };
  }

  // Проверка реальной валидности даты (отлавливает 31.02 и т.п.).
  // new Date(year, monthIndex, day) нормализует переполнение, поэтому сверяем
  // компоненты с исходными значениями.
  const probe = new Date(year, month - 1, day);
  if (
    probe.getFullYear() !== year ||
    probe.getMonth() !== month - 1 ||
    probe.getDate() !== day
  ) {
    return { ok: false, error: `Несуществующая дата: ${raw}` };
  }

  const iso = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return { ok: true, iso };
}
