import { describe, it, expect, beforeEach } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { composeAgents } from '../../src/agents/compose.js';
import { resetTools, listTools } from '../../src/tools/registry.js';
import { createMcpServer } from '../../src/mcp/adapters.js';
import { getSharedSessionStore } from '../../src/tools/mail/register-tools.js';
import { loadConfig } from '../../src/config/loader.js';
import { noopToolLogger } from '../../src/observability/logger.js';
import type { MailProvider } from '../../src/tools/mail/mail-provider.js';
import type { MailAccount } from '../../src/tools/mail/types.js';
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

const ACCOUNT: MailAccount = {
  provider: 'yandex',
  login: 'test@yandex.com',
  password: 'stub',
  authStrategy: 'basic',
};

/** Стаб-провайдер IMAP: возвращает предзаготовленные письма. */
function stubProvider(): MailProvider {
  const messages: EmailMessage[] = [
    {
      uid: 301,
      subject: 'Договор N 42',
      from: { address: 'legal@example.com' },
      to: [{ address: 'test@yandex.com' }],
      date: new Date('2026-10-10'),
      flags: [],
      folder: 'INBOX',
    },
  ];
  const full: EmailFull = {
    ...messages[0],
    body: 'Тело письма: текст договора N 42.',
    hasBody: true,
    attachments: [],
  };
  return {
    connect: async () => ({ ok: true, login: ACCOUNT.login }),
    listFolders: async () => [{ name: 'INBOX', path: 'INBOX', delimiter: '/', flags: [] }],
    search: async (): Promise<SearchResult> => ({ messages, total: 1, hasMore: false }),
    fetch: async (uid: number): Promise<EmailFull> => ({ ...full, uid }),
    downloadAttachments: async () => ({}) as never,
    dispose: async () => {},
  };
}

/** Stub-клиент LLM: не используется в MCP-вызовах (тулы вызываются напрямую). */
function stubClient(): RouterAiClient {
  return {
    chat: async (): Promise<ChatResult> => ({ content: 'ок', toolCalls: [] }),
  } as unknown as RouterAiClient;
}

async function connectClient() {
  const tools = listTools();
  const server = createMcpServer({ name: 'e2e-test', version: '0.0.0' }, tools);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'c', version: '0.0.0' });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  return client;
}

describe('E2E MCP: search→fetch→send', () => {
  beforeEach(() => resetTools());

  it('последовательность вызовов тулов через MCP-клиента', async () => {
    await composeAgents({
      client: stubClient(),
      config: makeConfig(),
      accounts: [ACCOUNT],
      toolLogger: noopToolLogger(),
    });

    // Предзаготовленная стаб-сессия (без реального mail.connect).
    getSharedSessionStore().set(ACCOUNT, stubProvider());

    const client = await connectClient();

    // 1. mail.search — найти письма.
    const searchResult = await client.callTool({
      name: 'mail.search',
      arguments: { login: 'test@yandex.com', criteria: { subject: 'Договор' } },
    });
    const searchText = (searchResult.content[0] as { type: 'text'; text: string }).text;
    expect(searchText).toContain('Договор N 42');
    expect(searchText).toContain('legal@example.com');

    // 2. mail.fetch — прочитать письмо по UID.
    const fetchResult = await client.callTool({
      name: 'mail.fetch',
      arguments: { login: 'test@yandex.com', uid: 301 },
    });
    const fetchText = (fetchResult.content[0] as { type: 'text'; text: string }).text;
    expect(fetchText).toContain('текст договора');
    expect(fetchText).toContain('301');

    // 3. mail.listTools — все доменные тулы экспонируются (без delegate).
    const toolsList = await client.listTools();
    const names = toolsList.tools.map((t) => t.name);
    expect(names).toContain('mail.search');
    expect(names).toContain('mail.fetch');
    expect(names).toContain('mail.send');
    expect(names).not.toContain('delegate');
  });
});
