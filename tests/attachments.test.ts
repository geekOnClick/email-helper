import { describe, it, expect } from 'vitest';
import { extractAttachments } from '../src/tools/mail/attachments.js';
import type { MessageStructureObject } from 'imapflow';

/** Хелпер: создаёт узел structure. */
function node(opts: Partial<MessageStructureObject>): MessageStructureObject {
  return { type: 'text/plain', childNodes: [], ...opts } as MessageStructureObject;
}

describe('extractAttachments', () => {
  it('извлекает вложение из disposition attachment', () => {
    const struct = node({
      type: 'multipart/mixed',
      childNodes: [
        node({ part: '1', type: 'text/plain' }),
        node({
          part: '2',
          type: 'application/pdf',
          disposition: 'attachment',
          dispositionParameters: { filename: 'report.pdf' },
          size: 12345,
        }),
      ],
    });
    const atts = extractAttachments(struct);
    expect(atts).toHaveLength(1);
    expect(atts[0]?.part).toBe('2');
    expect(atts[0]?.filename).toBe('report.pdf');
    expect(atts[0]?.contentType).toBe('application/pdf');
    expect(atts[0]?.size).toBe(12345);
  });

  it('несколько вложений', () => {
    const struct = node({
      type: 'multipart/mixed',
      childNodes: [
        node({ part: '1', type: 'text/plain' }),
        node({ part: '2', type: 'image/png', disposition: 'attachment', dispositionParameters: { filename: 'a.png' }, size: 100 }),
        node({ part: '3', type: 'image/jpeg', disposition: 'attachment', dispositionParameters: { filename: 'b.jpg' }, size: 200 }),
      ],
    });
    const atts = extractAttachments(struct);
    expect(atts).toHaveLength(2);
    expect(atts.map((a) => a.filename)).toEqual(['a.png', 'b.jpg']);
  });

  it('вложение без filename → дефолтное имя', () => {
    const struct = node({
      type: 'multipart/mixed',
      childNodes: [
        node({ part: '2', type: 'application/octet-stream', disposition: 'attachment' }),
      ],
    });
    const atts = extractAttachments(struct);
    expect(atts).toHaveLength(1);
    expect(atts[0]?.filename).toBe('attachment-2');
  });

  it('имя из parameters.name', () => {
    const struct = node({
      type: 'multipart/mixed',
      childNodes: [
        node({ part: '2', type: 'application/pdf', parameters: { name: 'doc.pdf' } }),
      ],
    });
    const atts = extractAttachments(struct);
    expect(atts[0]?.filename).toBe('doc.pdf');
  });

  it('без вложений → пустой массив', () => {
    const struct = node({
      type: 'multipart/alternative',
      childNodes: [
        node({ part: '1', type: 'text/plain' }),
        node({ part: '2', type: 'text/html' }),
      ],
    });
    expect(extractAttachments(struct)).toEqual([]);
  });

  it('пустой/undefined → пустой массив', () => {
    expect(extractAttachments(undefined)).toEqual([]);
    expect(extractAttachments(node({ type: 'text/plain' }))).toEqual([]);
  });

  it('вложенная multipart структура', () => {
    const struct = node({
      type: 'multipart/mixed',
      childNodes: [
        node({
          part: '1',
          type: 'multipart/related',
          childNodes: [
            node({ part: '1.1', type: 'text/html' }),
            node({ part: '1.2', type: 'image/png', disposition: 'attachment', dispositionParameters: { filename: 'inline.png' } }),
          ],
        }),
        node({ part: '2', type: 'application/pdf', disposition: 'attachment', dispositionParameters: { filename: 'top.pdf' } }),
      ],
    });
    const atts = extractAttachments(struct);
    expect(atts.map((a) => a.filename)).toEqual(['inline.png', 'top.pdf']);
  });
});