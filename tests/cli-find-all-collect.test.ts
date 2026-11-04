import { describe, it, expect, beforeEach } from 'vitest';
import { resetTools, type ToolDef } from '../src/tools/registry.js';
import { collectAllMessages } from '../src/transport/cli/commands/search-aggregator.js';
import type { SearchResult, EmailMessage } from '../src/types/email.js';

/** Строит EmailMessage с заданной датой/темой/отправителем. */
function msg(uid: number, iso: string, subject = 's', fromAddr = 'a@b.com'): EmailMessage {
  const [y, m, d] = iso.split('-').map(Number);
  return {
    uid,
    subject,
    from: { address: fromAddr },
    to: [{ address: 'me@t.com' }],
    date: new Date(y, m - 1, d),
    flags: [],
    folder: 'INBOX',
  };
}

/** Аргументы поиска в форме FindAllSearchArgs: serverCriteria + опц. subject/from. */
function args(subject?: string, from?: string, since: Date = new Date(1970, 0, 1)) {
  return { serverCriteria: { since }, subject, from };
}

/** Строит стаб mail.search, возвращающий страницы по `pages`. */
function makeSearchTool(pages: { messages: EmailMessage[]; total: number; hasMore: boolean }[]): ToolDef {
  let call = 0;
  return {
    name: 'mail.search',
    description: 'stub',
    inputSchema: { type: 'object' },
    handler: async () => {
      const page = pages[Math.min(call, pages.length - 1)];
      call++;
      return page as SearchResult;
    },
  } as unknown as ToolDef;
}

describe('collectAllMessages', () => {
  beforeEach(() => resetTools());

  it('одна страница (hasMore false) — все сообщения, не усечено', async () => {
    const tool = makeSearchTool([
      {
        messages: [msg(1, '2024-03-01'), msg(2, '2024-03-15'), msg(3, '2024-04-02')],
        total: 3,
        hasMore: false,
      },
    ]);
    // без subject/from фильтра — все сообщения проходят
    const res = await collectAllMessages(tool, 'login', args());
    expect(res.messages).toHaveLength(3);
    expect(res.messages[0].date).toEqual(new Date(2024, 2, 1));
    expect(res.truncated).toBe(false);
  });

  it('несколько страниц (hasMore true→false) — агрегирует все', async () => {
    const page1 = Array.from({ length: 50 }, (_, i) => msg(i + 1, '2024-03-01'));
    const page2 = [msg(51, '2024-04-01'), msg(52, '2024-04-02')];
    const tool = makeSearchTool([
      { messages: page1, total: 52, hasMore: true },
      { messages: page2, total: 52, hasMore: false },
    ]);
    const res = await collectAllMessages(tool, 'login', args());
    expect(res.messages).toHaveLength(52);
    expect(res.truncated).toBe(false);
  });

  it('пустая страница — выход без усечения', async () => {
    const tool = makeSearchTool([{ messages: [], total: 0, hasMore: false }]);
    const res = await collectAllMessages(tool, 'login', args());
    expect(res.messages).toHaveLength(0);
    expect(res.truncated).toBe(false);
  });

  it('достижение maxPages → truncated: true', async () => {
    const fullPage = Array.from({ length: 50 }, (_, i) => msg(i + 1, '2024-03-01'));
    const tool = makeSearchTool([{ messages: fullPage, total: 1000, hasMore: true }]);
    const res = await collectAllMessages(tool, 'login', args(), { maxPages: 3 });
    expect(res.messages).toHaveLength(150);
    expect(res.truncated).toBe(true);
  });

  it('передаёт limit/offset в тул и наращивает offset', async () => {
    const seen: { limit?: number; offset?: number }[] = [];
    const page1 = Array.from({ length: 50 }, (_, i) => msg(i + 1, '2024-03-01'));
    const page2 = [msg(51, '2024-04-01')];
    let call = 0;
    const tool: ToolDef = {
      name: 'mail.search',
      description: 'stub',
      inputSchema: { type: 'object' },
      handler: async (raw) => {
        const c = (raw as { criteria: { limit?: number; offset?: number } }).criteria;
        seen.push({ limit: c.limit, offset: c.offset });
        const pages = [
          { messages: page1, total: 51, hasMore: true },
          { messages: page2, total: 51, hasMore: false },
        ];
        return pages[Math.min(call++, pages.length - 1)] as SearchResult;
      },
    } as unknown as ToolDef;
    const res = await collectAllMessages(tool, 'login', args());
    expect(res.messages).toHaveLength(51);
    expect(seen).toEqual([{ limit: 50, offset: 0 }, { limit: 50, offset: 50 }]);
  });

  it('serverCriteria.since передаётся в criteria (не subject/from)', async () => {
    let receivedCriteria: Record<string, unknown> = {};
    const tool: ToolDef = {
      name: 'mail.search',
      description: 'stub',
      inputSchema: { type: 'object' },
      handler: async (raw) => {
        receivedCriteria = (raw as { criteria: Record<string, unknown> }).criteria;
        return { messages: [], total: 0, hasMore: false } as SearchResult;
      },
    } as unknown as ToolDef;
    await collectAllMessages(tool, 'login', args('уроки', 'a@b.com', new Date(2024, 0, 1)));
    expect(receivedCriteria.since).toEqual(new Date(2024, 0, 1));
    expect(receivedCriteria.limit).toBe(50);
    expect(receivedCriteria.offset).toBe(0);
    // subject/from НЕ передаются на сервер (локальный фильтр)
    expect(receivedCriteria).not.toHaveProperty('subject');
    expect(receivedCriteria).not.toHaveProperty('from');
  });

  it('локальная фильтрация по теме (case-insensitive, нормализация пробелов)', async () => {
    const tool = makeSearchTool([
      {
        messages: [
          msg(1, '2024-03-01', 'Уроки истории'),
          msg(2, '2024-03-02', 'уроки  истории'), // двойной пробел
          msg(3, '2024-03-03', 'Другое'),
          msg(4, '2024-03-04', 'Re: УРОКИ'),
        ],
        total: 4,
        hasMore: false,
      },
    ]);
    const res = await collectAllMessages(tool, 'login', args('уроки'));
    expect(res.messages).toHaveLength(3); // «Другое» отсеяно
    expect(res.messages.map((m) => m.uid)).toEqual([1, 2, 4]);
  });

  it('локальная фильтрация по отправителю (имя или адрес)', async () => {
    const tool = makeSearchTool([
      {
        messages: [
          msg(1, '2024-03-01', 's', 'teacher@school.ru'),
          msg(2, '2024-03-02', 's', 'other@example.com'),
          msg(3, '2024-03-03', 's', 'news@school.ru'),
        ],
        total: 3,
        hasMore: false,
      },
    ]);
    const res = await collectAllMessages(tool, 'login', args(undefined, 'school.ru'));
    expect(res.messages).toHaveLength(2); // uid 1 и 3
    expect(res.messages.map((m) => m.uid)).toEqual([1, 3]);
  });

  it('локальная фильтрация по теме+отправителю одновременно (AND)', async () => {
    const tool = makeSearchTool([
      {
        messages: [
          msg(1, '2024-03-01', 'Уроки', 'a@b.com'),
          msg(2, '2024-03-02', 'Уроки', 'c@d.com'),
          msg(3, '2024-03-03', 'Другое', 'a@b.com'),
        ],
        total: 3,
        hasMore: false,
      },
    ]);
    const res = await collectAllMessages(tool, 'login', args('уроки', 'a@b.com'));
    expect(res.messages).toHaveLength(1);
    expect(res.messages[0].uid).toBe(1);
  });

  it('фильтр отсекает всё → 0 сообщений', async () => {
    const tool = makeSearchTool([
      { messages: [msg(1, '2024-03-01', 's')], total: 1, hasMore: false },
    ]);
    const res = await collectAllMessages(tool, 'login', args('несуществующее'));
    expect(res.messages).toHaveLength(0);
    expect(res.truncated).toBe(false);
  });
});
