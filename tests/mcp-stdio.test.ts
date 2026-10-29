import { describe, it, expect } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from '../src/mcp/adapters.js';
import type { ToolDef } from '../src/tools/registry.js';

/**
 * End-to-end через транспорт: stdio-путь логически идентичен InMemory-паре
 * (тот же Server.connect(transport) + Client), поэтому покрываем транспортным
 * прогоном listTools + callTool.
 */
async function boot(tools: ToolDef[]): Promise<Client> {
  const server = createMcpServer(
    { name: 'stdio-test', version: '0.0.0' },
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

describe('MCP stdio-транспорт (end-to-end через транспорт)', () => {
  it('listTools проходит через транспорт', async () => {
    const tool: ToolDef = {
      name: 'mail.connect',
      description: 'подключение к ящику',
      inputSchema: {
        type: 'object',
        properties: { login: { type: 'string' } },
        required: ['login'],
      },
      handler: async () => 'connected',
    };
    const client = await boot([tool]);

    const result = await client.listTools();
    expect(result.tools[0]?.name).toBe('mail.connect');
    expect(result.tools[0]?.inputSchema).toEqual(tool.inputSchema);
  });

  it('callTool проходит через транспорт и возвращает результат', async () => {
    const tool: ToolDef = {
      name: 'echo',
      description: 'эхо',
      inputSchema: { type: 'object', properties: {} },
      handler: async (args) => (args as { x: string }).x,
    };
    const client = await boot([tool]);

    const result = await client.callTool({ name: 'echo', arguments: { x: 'hi' } });
    const textBlock = result.content[0] as { type: 'text'; text: string };

    expect(textBlock.text).toBe('hi');
    expect(result.isError).toBeFalsy();
  });

  it('ошибка handler возвращается через транспорт как isError', async () => {
    const tool: ToolDef = {
      name: 'boom',
      description: 'падает',
      inputSchema: { type: 'object', properties: {} },
      handler: async () => {
        throw new Error('сбой');
      },
    };
    const client = await boot([tool]);

    const result = await client.callTool({ name: 'boom', arguments: {} });
    expect(result.isError).toBe(true);
  });
});
