import { describe, it, expect } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from '../src/mcp/adapters.js';
import type { ToolDef } from '../src/tools/registry.js';

function stubTool(name: string, description: string): ToolDef {
  return {
    name,
    description,
    inputSchema: { type: 'object', properties: {} },
    handler: async () => `result-of-${name}`,
  };
}

describe('createMcpServer: factory', () => {
  it('создаёт сервер, к которому можно подключить транспорт', async () => {
    const server = createMcpServer(
      { name: 'factory-test', version: '1.2.3' },
      [stubTool('one', 'первый'), stubTool('two', 'второй')],
    );
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'c', version: '0.0.0' });

    await Promise.all([
      server.connect(serverSide),
      client.connect(clientSide),
    ]);

    const result = await client.listTools();
    expect(result.tools.map((t) => t.name).sort()).toEqual(['one', 'two']);
  });

  it('callTool исполняет handler соответствующего тулa', async () => {
    const server = createMcpServer(
      { name: 'call-test', version: '0.0.1' },
      [stubTool('ping', 'понг')],
    );
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'c', version: '0.0.0' });
    await Promise.all([
      server.connect(serverSide),
      client.connect(clientSide),
    ]);

    const result = await client.callTool({ name: 'ping', arguments: {} });
    const textBlock = result.content[0] as { type: 'text'; text: string };

    expect(textBlock.text).toBe('result-of-ping');
  });

  it('пустой список тулов → tools/list возвращает пустой массив', async () => {
    const server = createMcpServer({ name: 'empty', version: '0.0.0' }, []);
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'c', version: '0.0.0' });
    await Promise.all([
      server.connect(serverSide),
      client.connect(clientSide),
    ]);

    const result = await client.listTools();
    expect(result.tools).toEqual([]);
  });
});
