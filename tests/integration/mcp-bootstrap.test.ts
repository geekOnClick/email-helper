import { describe, it, expect, beforeEach } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { composeAgents } from '../../src/agents/compose.js';
import { resetTools, listTools } from '../../src/tools/registry.js';
import { createMcpServer } from '../../src/mcp/adapters.js';
import { loadConfig } from '../../src/config/loader.js';
import type { RouterAiClient } from '../../src/llm/routerai-client.js';
import type { ChatResult } from '../../src/llm/types.js';
import type { Config } from '../../src/config/schema.js';

function makeConfig(overrides: Partial<Config> = {}): Config {
  const base = loadConfig({ ROUTERAI_API_KEY: 'test-key' });
  return {
    ...base,
    AGENT_MAX_ITERATIONS: 5,
    AGENT_MAX_TOOL_RESULT_CHARS: 1000,
    ...overrides,
  };
}

/** Мок RouterAiClient: всегда финальный ответ без тулов (тулы регистрируются, но не вызываются). */
function stubClient(): RouterAiClient {
  return {
    chat: async (): Promise<ChatResult> => ({
      content: 'ок',
      toolCalls: [],
    }),
  } as unknown as RouterAiClient;
}

/** Поднимает MCP-сервер поверх тулов реестра + клиент через InMemory. */
async function connectClient(): Promise<Client> {
  const tools = listTools();
  const server = createMcpServer(
    { name: 'integration-test', version: '0.0.0' },
    tools,
  );
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'c', version: '0.0.0' });
  await Promise.all([
    server.connect(serverSide),
    client.connect(clientSide),
  ]);
  return client;
}

describe('MCP: интеграция с composeAgents (реальные тулы)', () => {
  beforeEach(() => resetTools());

  it('composeAgents регистрирует mail-тулы, MCP их экспонирует', async () => {
    await composeAgents({
      client: stubClient(),
      config: makeConfig(),
      accounts: [],
    });

    const client = await connectClient();
    const result = await client.listTools();
    const names = result.tools.map((t) => t.name);

    // Ключевые mail-тулы должны быть зарегистрированы composeAgents.
    expect(names).toContain('mail.connect');
    expect(names).toContain('mail.search');
    expect(names).toContain('mail.fetch');

    // delegate (внутренний тул оркестратора) не экспонируется.
    expect(names).not.toContain('delegate');
  });

  it('тулы имеют JSON-схему параметров (inputSchema)', async () => {
    await composeAgents({
      client: stubClient(),
      config: makeConfig(),
      accounts: [],
    });

    const client = await connectClient();
    const result = await client.listTools();
    const connectTool = result.tools.find((t) => t.name === 'mail.connect');

    expect(connectTool).toBeDefined();
    expect(connectTool?.inputSchema).toHaveProperty('type', 'object');
    expect(connectTool?.inputSchema).toHaveProperty('properties');
  });

  it('callTool mail.connect с неизвестным логином → isError (без реального подключения)', async () => {
    await composeAgents({
      client: stubClient(),
      config: makeConfig(),
      accounts: [],
    });

    const client = await connectClient();
    const result = await client.callTool({
      name: 'mail.connect',
      arguments: { login: 'nonexistent@test.local' },
    });

    // Аккаунт не найден → handler выбрасывает → isError: true.
    expect(result.isError).toBe(true);
    const textBlock = result.content[0] as { type: 'text'; text: string };
    expect(textBlock.text).toContain('nonexistent@test.local');
  });
});
