import { describe, it, expect } from 'vitest';
import { extFromContentType, KNOWN_EXTENSIONS } from '../src/tools/mail/mime-extensions.js';

describe('extFromContentType', () => {
  it('возвращает расширение для известных офисных типов', () => {
    expect(extFromContentType('application/vnd.ms-excel')).toBe('xls');
    expect(extFromContentType('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')).toBe('xlsx');
    expect(extFromContentType('application/msword')).toBe('doc');
    expect(extFromContentType('application/vnd.openxmlformats-officedocument.wordprocessingml.document')).toBe('docx');
    expect(extFromContentType('application/vnd.ms-powerpoint')).toBe('ppt');
    expect(extFromContentType('application/vnd.openxmlformats-officedocument.presentationml.presentation')).toBe('pptx');
    expect(extFromContentType('application/pdf')).toBe('pdf');
  });

  it('обрезает параметры (charset и пр.) после `;`', () => {
    expect(extFromContentType('application/pdf; charset=binary')).toBe('pdf');
    expect(extFromContentType('  text/csv; charset=utf-8  ')).toBe('csv');
    expect(extFromContentType('application/vnd.ms-excel; name=report.xls')).toBe('xls');
  });

  it('возвращает undefined для неизвестного типа', () => {
    expect(extFromContentType('application/octet-stream')).toBeUndefined();
    expect(extFromContentType('application/x-unknown')).toBeUndefined();
    expect(extFromContentType('foo/bar')).toBeUndefined();
  });

  it('возвращает undefined для пустого/undefined', () => {
    expect(extFromContentType(undefined)).toBeUndefined();
    expect(extFromContentType('')).toBeUndefined();
    expect(extFromContentType('   ')).toBeUndefined();
    expect(extFromContentType('; charset=utf-8')).toBeUndefined();
  });

  it('регистронезависим', () => {
    expect(extFromContentType('APPLICATION/PDF')).toBe('pdf');
    expect(extFromContentType('Application/Vnd.MS-Excel')).toBe('xls');
    expect(extFromContentType('  Application/Vnd.OpenXMLformats-Officedocument.WordprocessingML.Document  ')).toBe('docx');
  });

  it('KNOWN_EXTENSIONS содержит офисные расширения без дубликатов', () => {
    // ключевые офисные расширения присутствуют
    for (const ext of ['xls', 'xlsx', 'doc', 'docx', 'ppt', 'pptx', 'pdf']) {
      expect(KNOWN_EXTENSIONS).toContain(ext);
    }
    // нет дубликатов
    const unique = new Set(KNOWN_EXTENSIONS);
    expect(unique.size).toBe(KNOWN_EXTENSIONS.length);
    // отсортированы по убыванию длины (xlsx раньше xls)
    const xlsxIdx = KNOWN_EXTENSIONS.indexOf('xlsx');
    const xlsIdx = KNOWN_EXTENSIONS.indexOf('xls');
    expect(xlsxIdx).toBeGreaterThanOrEqual(0);
    expect(xlsIdx).toBeGreaterThanOrEqual(0);
    expect(xlsxIdx).toBeLessThan(xlsIdx);
  });
});
