import { describe, it, expect, beforeEach } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { resetTools, type ToolDef } from '../src/tools/registry.js';
import { createMcpServer } from '../src/mcp/adapters.js';

/** Stub-тул: возвращает фиксированный объект. */
function stubTool(
  name: string,
  description: string,
  handler: (args: unknown) => Promise<unknown>,
  inputSchema: Record<string, unknown> = { type: 'object', properties: {} },
): ToolDef {
  return {
    name,
    description,
    inputSchema,
    handler: handler as (args: Record<string, unknown>) => Promise<unknown>,
  };
}

/** Поднимает server+client через InMemoryTransport, возвращает клиент. */
async function connectClient(tools: ToolDef[]): Promise<Client> {
  const server = createMcpServer(
    { name: 'test-server', version: '0.0.0' },
    tools,
  );
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([
    server.connect(serverSide),
    client.connect(clientSide),
  ]);
  return client;
}

describe('MCP-адаптер: регистрация тулов', () => {
  beforeEach(() => resetTools());

  it('tools/list возвращает все тулы кроме delegate', async () => {
    const tools: ToolDef[] = [
      stubTool('mail.connect', 'подключение', async () => 'ok'),
      stubTool('mail.search', 'поиск', async () => [], {
        type: 'object',
        properties: { query: { type: 'string' } },
        required: ['query'],
      }),
      stubTool('delegate', 'внутренний', async () => 'nope'),
    ];
    const client = await connectClient(tools);

    const result = await client.listTools();
    const names = result.tools.map((t) => t.name);

    expect(names).toContain('mail.connect');
    expect(names).toContain('mail.search');
    expect(names).not.toContain('delegate');
  });

  it('JSON-схема параметров передаётся как есть', async () => {
    const schema = {
      type: 'object' as const,
      properties: { login: { type: 'string', description: 'логин' } },
      required: ['login'],
    };
    const client = await connectClient([stubTool('mail.connect', 'd', async () => 'ok', schema)]);

    const result = await client.listTools();
    const tool = result.tools.find((t) => t.name === 'mail.connect');

    expect(tool?.inputSchema).toEqual(schema);
  });

  it('tools/call успешный → content с текстом, isError нет', async () => {
    const client = await connectClient([
      stubTool('echo', 'эхо', async (args) => ({ echoed: (args as { msg: string }).msg })),
    ]);

    const result = await client.callTool({ name: 'echo', arguments: { msg: 'привет' } });

    expect(result.isError).toBeFalsy();
    expect(result.content).toHaveLength(1);
    expect(result.content[0]?.type).toBe('text');
    const textBlock = result.content[0] as { type: 'text'; text: string };
    expect(textBlock.text).toContain('привет');
  });

  it('строковый результат → text-блок как есть', async () => {
    const client = await connectClient([
      stubTool('ping', 'понг', async () => 'pong'),
    ]);

    const result = await client.callTool({ name: 'ping', arguments: {} });
    const textBlock = result.content[0] as { type: 'text'; text: string };

    expect(textBlock.text).toBe('pong');
  });

  it('handler выбрасывает → isError: true, сессия живёт', async () => {
    const client = await connectClient([
      stubTool('boom', 'падает', async () => {
        throw new Error('внутренняя ошибка тулa');
      }),
    ]);

    const result = await client.callTool({ name: 'boom', arguments: {} });

    expect(result.isError).toBe(true);
    const textBlock = result.content[0] as { type: 'text'; text: string };
    expect(textBlock.text).toContain('внутренняя ошибка тулa');

    // Сессия живёт — повторный вызов другого тулa работает.
    const client2 = client;
    const again = await client2.callTool({ name: 'boom', arguments: {} });
    expect(again.isError).toBe(true);
  });

  it('вызов неизвестного тулa → isError: true', async () => {
    const client = await connectClient([
      stubTool('real', 'есть', async () => 'ok'),
    ]);

    const result = await client.callTool({ name: 'nonexistent', arguments: {} });

    expect(result.isError).toBe(true);
  });
});
