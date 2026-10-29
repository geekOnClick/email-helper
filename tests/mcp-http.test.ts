import { describe, it, expect, afterEach } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createMcpServer } from '../src/mcp/adapters.js';
import { runHttp, type HttpServerHandle } from '../src/mcp/http.js';
import type { ToolDef } from '../src/tools/registry.js';

const handles: HttpServerHandle[] = [];

afterEach(async () => {
  while (handles.length) {
    const h = handles.pop();
    if (h) await h.close();
  }
});

function stubTool(name: string, description: string): ToolDef {
  return {
    name,
    description,
    inputSchema: { type: 'object', properties: {} },
    handler: async () => `result-of-${name}`,
  };
}

/** Поднимает HTTP-сервер на случайном порту и подключает MCP-клиента. */
async function bootClient(tools: ToolDef[]): Promise<Client> {
  const createServer = () =>
    createMcpServer({ name: 'http-test', version: '0.0.0' }, tools);
  const handle = await runHttp({ createServer, port: 0, host: '127.0.0.1' });
  handles.push(handle);

  const transport = new StreamableHTTPClientTransport(new URL(handle.url));
  const client = new Client({ name: 'c', version: '0.0.0' });
  await client.connect(transport);
  return client;
}

describe('MCP HTTP-транспорт', () => {
  it('клиент подключается по HTTP и получает список тулов', async () => {
    const client = await bootClient([
      stubTool('mail.connect', 'подключение'),
      stubTool('mail.search', 'поиск'),
    ]);

    const result = await client.listTools();
    expect(result.tools.map((t) => t.name).sort()).toEqual([
      'mail.connect',
      'mail.search',
    ]);
  });

  it('callTool через HTTP исполняет handler и возвращает результат', async () => {
    const client = await bootClient([stubTool('ping', 'понг')]);

    const result = await client.callTool({ name: 'ping', arguments: {} });
    const textBlock = result.content[0] as { type: 'text'; text: string };

    expect(textBlock.text).toBe('result-of-ping');
    expect(result.isError).toBeFalsy();
  });

  it('close() останавливает HTTP-сервер', async () => {
    const createServer = () =>
      createMcpServer(
        { name: 'close-test', version: '0.0.0' },
        [stubTool('one', 'первый')],
      );
    const handle = await runHttp({ createServer, port: 0, host: '127.0.0.1' });

    // Сервер отвечает.
    const transport = new StreamableHTTPClientTransport(new URL(handle.url));
    const client = new Client({ name: 'c', version: '0.0.0' });
    await client.connect(transport);
    const result = await client.listTools();
    expect(result.tools).toHaveLength(1);
    await client.close();

    // После close — эндпоинт недоступен.
    await handle.close();
    await expect(
      fetch(handle.url, { method: 'POST', body: '{}' }).then((r) => r.status),
    ).rejects.toThrow();
  });
});
