import { describe, it, expect, beforeEach } from 'vitest';
import { resetTools, registerTool } from '../src/tools/registry.js';
import { getSharedSessionStore } from '../src/tools/mail/register-tools.js';
import { runSmartSearchCommand } from '../src/transport/cli/commands/smart-search.js';
import { MockConsoleIO } from './mock-io.js';
import type { MailAccount } from '../src/tools/mail/types.js';
import type { MailProvider } from '../src/tools/mail/mail-provider.js';
import type { RouterAiClient } from '../src/llm/routerai-client.js';
import type { ChatRequest, ChatResult } from '../src/llm/types.js';
import type { SearchResult, EmailFull } from '../src/types/email.js';

const ACCOUNT: MailAccount = {
  provider: 'yandex',
  login: 'test@yandex.com',
  password: 'stub',
  authStrategy: 'basic',
};

/** Pre-seed IMAP-сессии для guided-команд (подключение не вызывается). */
function seedSession(account: MailAccount = ACCOUNT): void {
  getSharedSessionStore().set(account, {
    connect: async () => ({ ok: true, login: account.login }),
    listFolders: async () => [],
    search: async () => ({ messages: [], total: 0, hasMore: false }),
    fetch: async () => ({}),
    downloadAttachments: async () => ({ paths: [], folder: 'INBOX', uid: 0 }),
    dispose: async () => {},
    isConnectionUsable: () => true,
    reconnect: async () => {},
  } as unknown as MailProvider);
}

/**
 * Scripted LLM: возвращает JSON критериев из массива по очереди.
 * Позволяет проверить парсинг промпта в { subject, from, since, N }.
 */
function scriptedClient(responses: string[]): RouterAiClient & { calls: ChatRequest[] } {
  const calls: ChatRequest[] = [];
  let i = 0;
  return {
    calls,
    chat: async (request: ChatRequest): Promise<ChatResult> => {
      calls.push(request);
      const body = responses[Math.min(i, responses.length - 1)] ?? '{}';
      i++;
      return { content: body, toolCalls: [] };
    },
  } as unknown as RouterAiClient & { calls: ChatRequest[] };
}

/** Строит EmailMessage (метаданные) с заданной датой. */
function msgMeta(uid: number, subject: string, date: string, fromAddr = 'ded@ded.ru') {
  return {
    uid,
    subject,
    from: { address: fromAddr },
    to: [{ address: 'test@yandex.com' }],
    date: new Date(date),
    flags: [],
    folder: 'INBOX',
  };
}

/** Строит EmailFull (с телом). */
function msgFull(uid: number, subject: string, date: string, fromAddr = 'ded@ded.ru'): EmailFull {
  return {
    uid,
    subject,
    from: { address: fromAddr },
    to: [{ address: 'test@yandex.com' }],
    date: new Date(date),
    flags: [],
    folder: 'INBOX',
    body: `Тело письма UID=${uid}: ${subject}.`,
    hasBody: true,
    attachments: [],
  };
}

describe('runSmartSearchCommand', () => {
  beforeEach(() => {
    resetTools();
    seedSession();
  });

  it('N=1: промпт «последнее письмо от ded@ded.ru» → показ письма целиком без анализа', async () => {
    const msgs = [
      msgMeta(1, 'старое письмо', '2026-10-01'),
      msgMeta(2, 'новое письмо', '2026-10-10'),
    ];
    registerTool({
      name: 'mail.search',
      description: 'stub',
      inputSchema: { type: 'object' },
      handler: async () => ({ messages: msgs, total: msgs.length, hasMore: false }) as SearchResult,
    });
    const fetched: number[] = [];
    registerTool({
      name: 'mail.fetch',
      description: 'stub',
      inputSchema: { type: 'object' },
      handler: async (args) => {
        const a = args as { uid: number };
        fetched.push(a.uid);
        return msgFull(a.uid, a.uid === 2 ? 'новое письмо' : 'старое письмо', a.uid === 2 ? '2026-10-10' : '2026-10-01');
      },
    });
    const llm = scriptedClient([JSON.stringify({ отправитель: 'ded@ded.ru', количество: 1 })]);
    const io = new MockConsoleIO(['найди последнее письмо от ded@ded.ru', '']);
    // inputs: промпт, promptAccount(1 → авто)
    await runSmartSearchCommand({ io, accounts: [ACCOUNT], llmClient: llm, fallbackDays: 180, maxEmails: 10 });
    const out = io.output();
    // Сортировка по дате убыванием → топ-1 = UID 2 (новее). Фетч тела UID 2.
    expect(fetched).toEqual([2]);
    expect(out).toContain('Письмо');
    expect(out).toContain('UID: 2');
    expect(out).toContain('новое письмо');
    expect(out).toContain('Тело письма UID=2');
    // Без LLM-анализа: слово «саммари» не появляется.
    expect(out).not.toContain('саммари');
  });

  it('N>1: промпт «10 писем по теме Урок» → таблица + выбор UID + показ письма', async () => {
    const msgs = [
      msgMeta(1, 'Урок 1', '2026-10-01', 'a@b.com'),
      msgMeta(2, 'Урок 2', '2026-10-02', 'a@b.com'),
      msgMeta(3, 'Урок 3', '2026-10-03', 'a@b.com'),
    ];
    registerTool({
      name: 'mail.search',
      description: 'stub',
      inputSchema: { type: 'object' },
      handler: async () => ({ messages: msgs, total: msgs.length, hasMore: false }) as SearchResult,
    });
    const fetched: number[] = [];
    registerTool({
      name: 'mail.fetch',
      description: 'stub',
      inputSchema: { type: 'object' },
      handler: async (args) => {
        const a = args as { uid: number };
        fetched.push(a.uid);
        return msgFull(a.uid, `Урок ${a.uid}`, `2026-10-0${a.uid}`);
      },
    });
    const llm = scriptedClient([JSON.stringify({ тема: 'Урок', количество: 10 })]);
    const io = new MockConsoleIO(['собери последние 10 писем по теме Урок', '1']);
    // inputs: промпт, promptAccount(1 → авто), затем UID (promptUid) = 1
    await runSmartSearchCommand({ io, accounts: [ACCOUNT], llmClient: llm, fallbackDays: 180, maxEmails: 10 });
    const out = io.output();
    expect(out).toContain('Найдено писем: 3');
    expect(out).toContain('UID=1');
    expect(out).toContain('Урок 1');
    // Выбран UID 1 → фетч + показ целиком.
    expect(fetched).toEqual([1]);
    expect(out).toContain('Тело письма UID=1');
  });

  it('дефолт N=1: промпт без числа → количество = 1', async () => {
    const msgs = [msgMeta(1, 'договор', '2026-10-01')];
    registerTool({
      name: 'mail.search',
      description: 'stub',
      inputSchema: { type: 'object' },
      handler: async () => ({ messages: msgs, total: msgs.length, hasMore: false }) as SearchResult,
    });
    const fetched: number[] = [];
    registerTool({
      name: 'mail.fetch',
      description: 'stub',
      inputSchema: { type: 'object' },
      handler: async (args) => {
        const a = args as { uid: number };
        fetched.push(a.uid);
        return msgFull(a.uid, 'договор', '2026-10-01');
      },
    });
    // Промпт без количества → JSON без «количество».
    const llm = scriptedClient([JSON.stringify({ тема: 'договор' })]);
    const io = new MockConsoleIO(['найди письмо по теме договор', '']);
    await runSmartSearchCommand({ io, accounts: [ACCOUNT], llmClient: llm, fallbackDays: 180, maxEmails: 10 });
    expect(fetched).toEqual([1]);
    expect(io.output()).toContain('договор');
  });

  it('потолок: промпт запрашивает 50 → min(50, maxEmails=10) = 10', async () => {
    const msgs = Array.from({ length: 15 }, (_, i) => msgMeta(i + 1, `письмо ${i + 1}`, `2026-10-${String(i + 1).padStart(2, '0')}`));
    registerTool({
      name: 'mail.search',
      description: 'stub',
      inputSchema: { type: 'object' },
      handler: async () => ({ messages: msgs, total: msgs.length, hasMore: false }) as SearchResult,
    });
    registerTool({
      name: 'mail.fetch',
      description: 'stub',
      inputSchema: { type: 'object' },
      handler: async (args) => {
        const a = args as { uid: number };
        return msgFull(a.uid, `письмо ${a.uid}`, `2026-10-${String(a.uid).padStart(2, '0')}`);
      },
    });
    const llm = scriptedClient([JSON.stringify({ количество: 50 })]);
    const io = new MockConsoleIO(['найди 50 писем', '1']);
    await runSmartSearchCommand({ io, accounts: [ACCOUNT], llmClient: llm, fallbackDays: 180, maxEmails: 10 });
    const out = io.output();
    // top-N ограничен до 10 → таблица из 10 писем (N>1 ветка).
    expect(out).toContain('Найдено писем: 10');
  });

  it('bounded-окно: промпт без даты → since = now − fallbackDays, before не задан, subject/from в локальный фильтр', async () => {
    const searchCalls: { login: string; criteria: { since?: Date; before?: Date; subject?: string; from?: string; limit?: number; offset?: number } }[] = [];
    const msgs = [msgMeta(1, 'тест', '2026-10-01', 'ded@ded.ru')];
    registerTool({
      name: 'mail.search',
      description: 'stub',
      inputSchema: { type: 'object' },
      handler: async (args) => {
        searchCalls.push(args as { login: string; criteria: { since?: Date; before?: Date; subject?: string; from?: string; limit?: number; offset?: number } });
        return { messages: msgs, total: msgs.length, hasMore: false } as SearchResult;
      },
    });
    registerTool({
      name: 'mail.fetch',
      description: 'stub',
      inputSchema: { type: 'object' },
      handler: async (args) => {
        const a = args as { uid: number };
        return msgFull(a.uid, 'тест', '2026-10-01', 'ded@ded.ru');
      },
    });
    const llm = scriptedClient([JSON.stringify({ отправитель: 'ded@ded.ru' })]);
    const io = new MockConsoleIO(['найди последнее письмо от ded@ded.ru', '']);
    await runSmartSearchCommand({ io, accounts: [ACCOUNT], llmClient: llm, fallbackDays: 180, maxEmails: 10 });
    // Проверяем, что на сервер ушли ТОЛЬКО даты (since есть, before нет),
    // subject/from НЕ переданы на сервер (идут в локальный фильтр агрегатора).
    expect(searchCalls.length).toBeGreaterThan(0);
    const first = searchCalls[0];
    expect(first).toBeDefined();
    if (!first) return; // satisfies TS
    expect(first.criteria.since).toBeInstanceOf(Date);
    expect(first.criteria.before).toBeUndefined();
    expect(first.criteria.subject).toBeUndefined();
    expect(first.criteria.from).toBeUndefined();
    // since ≈ now − 180 дней (в пределах пары секунд).
    const now = Date.now();
    const since = first.criteria.since;
    expect(since).toBeInstanceOf(Date);
    if (!(since instanceof Date)) return; // satisfies TS
    const sinceMs = since.getTime();
    const expectedMs = now - 180 * 24 * 60 * 60 * 1000;
    expect(Math.abs(sinceMs - expectedMs)).toBeLessThan(60_000);
  });

  it('ошибка LLM-парсинга: невалидный JSON → команда выводит ошибку и отменяет (без поиска)', async () => {
    const llm = scriptedClient(['это не JSON']);
    const searchCalled: unknown[] = [];
    registerTool({
      name: 'mail.search',
      description: 'stub',
      inputSchema: { type: 'object' },
      handler: async (args) => {
        searchCalled.push(args);
        return { messages: [], total: 0, hasMore: false } as SearchResult;
      },
    });
    registerTool({
      name: 'mail.fetch',
      description: 'stub',
      inputSchema: { type: 'object' },
      handler: async () => ({}),
    });
    const io = new MockConsoleIO(['найди письмо', '']);
    await runSmartSearchCommand({ io, accounts: [ACCOUNT], llmClient: llm, fallbackDays: 180, maxEmails: 10 });
    const out = io.output();
    expect(out).toContain('Ошибка разбора промпта');
    // Поиск не выполнялся.
    expect(searchCalled).toHaveLength(0);
  });

  it('отмена: пустой промпт → отмена без вызова LLM', async () => {
    const llm = scriptedClient(['{}']);
    const io = new MockConsoleIO(['']);
    await runSmartSearchCommand({ io, accounts: [ACCOUNT], llmClient: llm, fallbackDays: 180, maxEmails: 10 });
    expect(io.output()).toContain('Поиск отменён');
    expect(llm.calls).toHaveLength(0);
  });
});
