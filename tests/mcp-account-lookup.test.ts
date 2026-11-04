import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { composeAgents } from '../src/agents/compose.js';
import { resetTools, listTools } from '../src/tools/registry.js';
import { createMcpServer } from '../src/mcp/adapters.js';
import { getSharedSessionStore } from '../src/tools/mail/register-tools.js';
import { loadConfig } from '../src/config/loader.js';
import { AccountRegistry } from '../src/config/account-registry.js';
import { noopToolLogger } from '../src/observability/logger.js';
import type { MailAccount } from '../src/tools/mail/types.js';
import type { RouterAiClient } from '../src/llm/routerai-client.js';
import type { ChatResult } from '../src/llm/types.js';
import type { Config } from '../src/config/schema.js';

function makeConfig(overrides: Partial<Config> = {}): Config {
  const base = loadConfig({ ROUTERAI_API_KEY: 'test-key' });
  return {
    ...base,
    AGENT_MAX_ITERATIONS: 5,
    AGENT_MAX_TOOL_RESULT_CHARS: 1000,
    ...overrides,
  };
}

function stubClient(): RouterAiClient {
  return {
    chat: async (): Promise<ChatResult> => ({ content: 'ок', toolCalls: [] }),
  } as unknown as RouterAiClient;
}

/**
 * Фабрика провайдеров мокается, чтобы mail.connect НЕ пытался реально подключаться,
 * а сразу падал бы, если бы аккаунт нашёлся. Но в этих тестах аккаунт НЕ находится
 * (lookup падает до фабрики), поэтому мок не вызывается.
 */
vi.mock('../src/tools/mail/providers/factory.js', () => ({
  createMailProvider: vi.fn().mockImplementation(() => {
    throw new Error('factory не должен вызываться при отсутствии аккаунта');
  }),
}));

/** Реестр с одним yandex-аккаунтом (для теста provider_mismatch). */
const yandexAccount: MailAccount = {
  provider: 'yandex',
  login: 'env@yandex.com',
  password: 'env-pass-secret',
  authStrategy: 'basic',
};

async function connectClient() {
  const tools = listTools();
  const server = createMcpServer({ name: 'lookup-test', version: '0.0.0' }, tools);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'c', version: '0.0.0' });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  return client;
}

describe('MCP integration: mail.connect — структурированные ошибки поиска аккаунта', () => {
  beforeEach(() => {
    resetTools();
    getSharedSessionStore().disposeAll();
  });

  it('account_not_found: логин отсутствует в реестре → isError + JSON', async () => {
    // Реестр пустой — аккаунта нет.
    await composeAgents({
      client: stubClient(),
      config: makeConfig(),
      accounts: [],
      accountRegistry: new AccountRegistry([]),
      toolLogger: noopToolLogger(),
    });

    const client = await connectClient();
    const result = await client.callTool({
      name: 'mail.connect',
      arguments: { login: 'nobody@yandex.com', provider: 'yandex' },
    });

    expect(result.isError).toBe(true);
    const block = result.content[0] as { type: 'text'; text: string };
    const parsed = JSON.parse(block.text);
    expect(parsed.error).toBe('account_not_found');
    expect(parsed.login).toBe('nobody@yandex.com');
    expect(parsed.provider).toBe('yandex');
    expect(parsed.hint).toContain('/add-account');
    // Пароль не утёк.
    expect(block.text).not.toContain('env-pass-secret');
  });

  it('provider_mismatch: login есть с другим provider → isError + JSON', async () => {
    // Реестр содержит yandex-аккаунт; запрашиваем outlook → mismatch.
    await composeAgents({
      client: stubClient(),
      config: makeConfig(),
      accounts: [yandexAccount],
      accountRegistry: new AccountRegistry([yandexAccount]),
      toolLogger: noopToolLogger(),
    });

    const client = await connectClient();
    const result = await client.callTool({
      name: 'mail.connect',
      arguments: { login: 'env@yandex.com', provider: 'outlook' },
    });

    expect(result.isError).toBe(true);
    const block = result.content[0] as { type: 'text'; text: string };
    const parsed = JSON.parse(block.text);
    expect(parsed.error).toBe('provider_mismatch');
    expect(parsed.login).toBe('env@yandex.com');
    expect(parsed.provider).toBe('outlook');
    expect(parsed.hint).toContain('provider');
    // Пароль не утёк.
    expect(block.text).not.toContain('env-pass-secret');
  });

  it('tools/list экспонирует mail.connect с обязательными login+provider, без credentials', async () => {
    await composeAgents({
      client: stubClient(),
      config: makeConfig(),
      accounts: [],
      accountRegistry: new AccountRegistry([]),
      toolLogger: noopToolLogger(),
    });

    const client = await connectClient();
    const result = await client.listTools();
    const connectTool = result.tools.find((t) => t.name === 'mail.connect');
    expect(connectTool).toBeDefined();
    const schema = connectTool?.inputSchema as {
      required?: string[];
      properties?: Record<string, unknown>;
    };
    expect(schema.required).toEqual(['login', 'provider']);
    expect(schema.properties).toHaveProperty('login');
    expect(schema.properties).toHaveProperty('provider');
    expect(schema.properties).not.toHaveProperty('credentials');
  });
});
