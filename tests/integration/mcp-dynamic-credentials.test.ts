import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { composeAgents } from '../../src/agents/compose.js';
import { resetTools, listTools } from '../../src/tools/registry.js';
import { createMcpServer } from '../../src/mcp/adapters.js';
import { getSharedSessionStore } from '../../src/tools/mail/register-tools.js';
import { loadConfig } from '../../src/config/loader.js';
import { noopToolLogger } from '../../src/observability/logger.js';
import type { MailProvider } from '../../src/tools/mail/mail-provider.js';
import type { RouterAiClient } from '../../src/llm/routerai-client.js';
import type { ChatResult } from '../../src/llm/types.js';
import type { Config } from '../../src/config/schema.js';
import type { EmailMessage, EmailFull, SearchResult } from '../../src/types/email.js';

function makeConfig(overrides: Partial<Config> = {}): Config {
  const base = loadConfig({ ROUTERAI_API_KEY: 'test-key' });
  return {
    ...base,
    AGENT_MAX_ITERATIONS: 5,
    AGENT_MAX_TOOL_RESULT_CHARS: 1000,
    ...overrides,
  };
}

/** Стаб-провайдер IMAP: запоминает подключение, возвращает предзаготовленные письма. */
function stubProvider(): MailProvider {
  const messages: EmailMessage[] = [
    {
      uid: 10,
      subject: 'Динамический тест',
      from: { address: 'sender@example.com' },
      to: [{ address: 'dyn@yandex.com' }],
      date: new Date('2026-10-20'),
      flags: [],
      folder: 'INBOX',
    },
  ];
  const full: EmailFull = {
    ...messages[0],
    body: 'Тело письма для динамического подключения.',
    hasBody: true,
    attachments: [],
  };
  return {
    connect: async () => ({ connected: true, accountId: 'dyn@yandex.com', provider: 'yandex' }),
    listFolders: async () => [{ name: 'INBOX', path: 'INBOX', delimiter: '/', flags: ['\\Inbox'] }],
    search: async (): Promise<SearchResult> => ({ messages, total: 1, hasMore: false }),
    fetch: async (uid: number): Promise<EmailFull> => ({ ...full, uid }),
    downloadAttachments: async () => ({}) as never,
    dispose: async () => {},
  };
}

/**
 * Мокаем фабрику провайдеров: mail.connect (через createMailProvider) получит
 * stub-провайдер вместо реального IMAP. Это позволяет протестировать полный
 * flow connect→search через MCP с динамическими кредами без сети.
 */
vi.mock('../../src/tools/mail/providers/factory.js', () => ({
  createMailProvider: vi.fn().mockImplementation(() => stubProvider()),
}));

function stubClient(): RouterAiClient {
  return {
    chat: async (): Promise<ChatResult> => ({ content: 'ок', toolCalls: [] }),
  } as unknown as RouterAiClient;
}

async function connectClient() {
  const tools = listTools();
  const server = createMcpServer({ name: 'dyn-test', version: '0.0.0' }, tools);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'c', version: '0.0.0' });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  return client;
}

describe('MCP integration: динамические креды (mail.connect)', () => {
  beforeEach(() => {
    resetTools();
    // Очищаем shared-стор между тестами.
    getSharedSessionStore().disposeAll();
  });

  it('3.1 tools/list возвращает схему mail.connect с полем credentials', async () => {
    await composeAgents({
      client: stubClient(),
      config: makeConfig(),
      accounts: [],
      toolLogger: noopToolLogger(),
    });

    const client = await connectClient();
    const result = await client.listTools();
    const connectTool = result.tools.find((t) => t.name === 'mail.connect');

    expect(connectTool).toBeDefined();
    const schema = connectTool?.inputSchema as {
      properties?: Record<string, unknown>;
    };
    expect(schema.properties).toHaveProperty('login');
    expect(schema.properties).toHaveProperty('credentials');
    const credProp = schema.properties?.credentials as {
      properties?: Record<string, unknown>;
      type?: string;
    };
    expect(credProp.type).toBe('object');
    expect(credProp.properties).toHaveProperty('provider');
    expect(credProp.properties).toHaveProperty('password');
    expect(credProp.properties).toHaveProperty('authStrategy');
  });

  it('3.2 tools/call mail.connect с credentials → сессия доступна mail.search', async () => {
    // accounts пуст (как в .env нет нужного ящика) — только динамические креды.
    await composeAgents({
      client: stubClient(),
      config: makeConfig(),
      accounts: [],
      toolLogger: noopToolLogger(),
    });

    const client = await connectClient();

    // mail.connect с динамическими кредами.
    const connectResult = await client.callTool({
      name: 'mail.connect',
      arguments: {
        login: 'dyn@yandex.com',
        credentials: { provider: 'yandex', password: 'dyn-secret', authStrategy: 'basic' },
      },
    });
    expect(connectResult.isError).toBeFalsy();
    const connectText = (connectResult.content[0] as { type: 'text'; text: string }).text;
    expect(connectText).toContain('dyn@yandex.com');
    // Пароль не должен попасть в ответ.
    expect(connectText).not.toContain('dyn-secret');

    // Сессия сохранена в shared-сторе (доступна mail.search).
    expect(getSharedSessionStore().has('dyn@yandex.com')).toBe(true);

    // mail.search по тому же login — использует сохранённую сессию.
    const searchResult = await client.callTool({
      name: 'mail.search',
      arguments: { login: 'dyn@yandex.com', criteria: { subject: 'Динамический' } },
    });
    expect(searchResult.isError).toBeFalsy();
    const searchText = (searchResult.content[0] as { type: 'text'; text: string }).text;
    expect(searchText).toContain('Динамический тест');
    expect(searchText).toContain('sender@example.com');
  });
});
