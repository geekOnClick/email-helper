/**
 * Unit-тесты чистых доменных функций команд (change web-interface, design D1).
 *
 * Вызывают чистые функции (runSmartSearch, runAnalyze, saveAccount, ...) с DTO,
 * проверяют результат без ConsoleIO. Переиспользуют существующие моки тулов/LLM.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { resetTools, registerTool, getTool } from '../src/tools/registry.js';
import { runSmartSearch } from '../src/transport/commands/smart-search.js';
import { runAnalyze } from '../src/transport/commands/analyze.js';
import { saveAccount } from '../src/transport/commands/add-account.js';
import { generateSmartSendBody, sendSmartSend } from '../src/transport/commands/smart-send.js';
import { AccountRegistry } from '../src/config/account-registry.js';
import type { RouterAiClient } from '../src/llm/routerai-client.js';
import type { ChatRequest, ChatResult } from '../src/llm/types.js';
import type { Subagent } from '../src/agents/subagent.js';
import type { SearchResult, EmailFull } from '../src/types/email.js';

const ACCOUNT = { provider: 'yandex' as const, login: 'test@yandex.com', password: 'pwd', authStrategy: 'basic' as const };

/** LLM-клиент, возвращающий заданные ответы последовательно. */
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

/** Subagent-анализатор, возвращающий заданный текст. */
function stubAnalyzer(reply: string): Subagent & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    run: async (input: string): Promise<string> => {
      calls.push(input);
      return reply;
    },
  } as unknown as Subagent & { calls: string[] };
}

function msgMeta(uid: number, subject: string, date: string, fromAddr = 'ded@ded.ru') {
  return { uid, subject, from: { address: fromAddr }, to: [{ address: 't@y.com' }], date: new Date(date), flags: [], folder: 'INBOX' };
}

function msgFull(uid: number, subject: string, body: string): EmailFull {
  return { uid, subject, from: { address: 'ded@ded.ru' }, to: [], date: new Date('2026-01-01'), flags: [], folder: 'INBOX', body, hasBody: true, attachments: [] };
}

describe('Чистые функции команд (transport/commands)', () => {
  beforeEach(() => {
    resetTools();
  });

  describe('runSmartSearch', () => {
    it('парсит промпт + поиск → возвращает top-N писем', async () => {
      const llm = scriptedClient([JSON.stringify({ отправитель: 'ded@ded.ru', количество: 1 })]);
      const result = await runSmartSearch({
        accountLogin: ACCOUNT.login,
        prompt: 'найди последнее письмо от ded@ded.ru',
        llmClient: llm,
        searchTool: registerToolSearchStub([msgMeta(7, 'письмо', '2026-01-01')]),
        fallbackDays: 180,
        maxEmails: 10,
      });
      expect(result.messages).toHaveLength(1);
      expect(result.count).toBe(1);
    });

    it('невалидный JSON от LLM → бросает', async () => {
      const llm = scriptedClient(['это не JSON']);
      await expect(
        runSmartSearch({ accountLogin: ACCOUNT.login, prompt: 'x', llmClient: llm, searchTool: registerToolSearchStub([]) }),
      ).rejects.toThrow('невалидный JSON');
    });
  });

  describe('runAnalyze', () => {
    it('фетчит письмо + анализатор → возвращает отчёт', async () => {
      const analyzer = stubAnalyzer('Саммари письма');
      const result = await runAnalyze({
        accountLogin: ACCOUNT.login,
        uid: 7,
        fetchTool: registerToolFetchStub(msgFull(7, 'тема', 'тело письма')),
        analyzer,
      });
      expect(result.analysis).toBe('Саммари письма');
      expect(result.email.uid).toBe(7);
      expect(analyzer.calls.length).toBe(1);
    });
  });

  describe('saveAccount', () => {
    it('валидирует + сохраняет в реестр, возвращает без пароля', async () => {
      const registry = new AccountRegistry([]);
      const tmpEnv = `/tmp/test-env-${Date.now()}.env`;
      const result = await saveAccount({
        account: { provider: 'yandex', login: 'new@yandex.com', password: 'secret' },
        registry,
        envPath: tmpEnv,
      });
      expect(result.login).toBe('new@yandex.com');
      expect(result.provider).toBe('yandex');
      expect(result.authStrategy).toBe('basic');
      expect((result as { password?: string }).password).toBeUndefined();
      expect(registry.has('new@yandex.com')).toBe(true);
    });

    it('невалидный provider → бросает', async () => {
      const registry = new AccountRegistry([]);
      await expect(
        saveAccount({ account: { provider: 'gmail' as never, login: 'x', password: 'p' }, registry, envPath: '/tmp/x.env' }),
      ).rejects.toThrow('provider');
    });
  });

  describe('smart-send: generate + send', () => {
    it('generate: LLM возвращает тело', async () => {
      const llm = scriptedClient(['Сгенерированное тело']);
      const body = await generateSmartSendBody({ llmClient: llm, subject: 'тема', to: 'a@b.com', prompt: 'напиши письмо' });
      expect(body).toBe('Сгенерированное тело');
      expect(llm.calls).toHaveLength(1);
    });

    it('send: успех → { sent: true }', async () => {
      const result = await sendSmartSend({
        accountLogin: ACCOUNT.login,
        sendTool: registerToolSendStub(),
        to: 'a@b.com',
        subject: 'тема',
        body: 'тело',
      });
      expect(result.sent).toBe(true);
    });

    it('send: ошибка → { sent: false, error }', async () => {
      const result = await sendSmartSend({
        accountLogin: ACCOUNT.login,
        sendTool: registerToolSendStubFailing(),
        to: 'a@b.com',
        subject: 'тема',
        body: 'тело',
      });
      expect(result.sent).toBe(false);
      expect(result.error).toContain('SMTP');
    });
  });
});

/** Регистрирует stub mail.search с заданными письмами и возвращает его. */
function registerToolSearchStub(messages: ReturnType<typeof msgMeta>[]) {
  registerTool({
    name: 'mail.search',
    description: 'stub',
    inputSchema: { type: 'object' },
    handler: async () => ({ messages, total: messages.length, hasMore: false }) as SearchResult,
  });
  const t = getTool('mail.search');
  if (!t) throw new Error('mail.search не зарегистрирован');
  return t;
}

/** Регистрирует stub mail.fetch с заданным письмом и возвращает его. */
function registerToolFetchStub(email: EmailFull) {
  registerTool({
    name: 'mail.fetch',
    description: 'stub',
    inputSchema: { type: 'object' },
    handler: async () => email,
  });
  const t = getTool('mail.fetch');
  if (!t) throw new Error('mail.fetch не зарегистрирован');
  return t;
}

/** Регистрирует stub mail.send (успешный) и возвращает его. */
function registerToolSendStub() {
  registerTool({
    name: 'mail.send',
    description: 'stub',
    inputSchema: { type: 'object' },
    handler: async () => ({ sent: true }),
  });
  const t = getTool('mail.send');
  if (!t) throw new Error('mail.send не зарегистрирован');
  return t;
}

/** Регистрирует stub mail.send (падающий) и возвращает его. */
function registerToolSendStubFailing() {
  registerTool({
    name: 'mail.send',
    description: 'stub',
    inputSchema: { type: 'object' },
    handler: async () => { throw new Error('SMTP недоступен'); },
  });
  const t = getTool('mail.send');
  if (!t) throw new Error('mail.send не зарегистрирован');
  return t;
}
