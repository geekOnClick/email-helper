/**
 * Streamable HTTP-транспорт MCP-сервера (Фаза 6, change mcp-server).
 *
 * Поднимает Node HTTP-сервер на эндпоинте `/mcp`. Stateless-режим Streamable
 * HTTP: новый `Server` + `StreamableHTTPServerTransport` создаются на каждый
 * HTTP-запрос (контракт SDK — stateless transport нельзя переиспользовать).
 * Тулы переиспользуются через переданную factory-функцию (реестр статичен).
 *
 * По умолчанию слушает `127.0.0.1:3000` (localhost-only — см. спеку, безопасность).
 */
import { createServer, type Server as HttpServer } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';

/** Опции запуска HTTP-транспорта. */
export interface RunHttpOptions {
  /** Factory MCP-сервера с тулами; вызывается на каждый запрос (stateless). */
  createServer: () => Server;
  /** Порт (по умолчанию 3000). */
  port?: number;
  /** Хост (по умолчанию `127.0.0.1` — только localhost). */
  host?: string;
}

/** Результат запуска: HTTP-сервер + функция остановки. */
export interface HttpServerHandle {
  /** Адрес, на котором сервер принимает соединения. */
  url: string;
  /** Останавливает HTTP-сервер. */
  close: () => Promise<void>;
}

/** Дефолтный порт HTTP-транспорта. */
const DEFAULT_PORT = 3000;
/** Дефолтный хост — localhost-only. */
const DEFAULT_HOST = '127.0.0.1';
/** Эндпоинт MCP. */
const MCP_ENDPOINT = '/mcp';

/**
 * Поднимает HTTP-сервер со Streamable HTTP-транспортом MCP (stateless).
 * @returns handle с URL и функцией close().
 */
export async function runHttp(opts: RunHttpOptions): Promise<HttpServerHandle> {
  const host = opts.host ?? DEFAULT_HOST;
  const port = opts.port ?? DEFAULT_PORT;

  const httpServer: HttpServer = createServer(async (req, res) => {
    if (!req.url?.startsWith(MCP_ENDPOINT)) {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'not found' }));
      return;
    }
    if (req.method !== 'POST') {
      res.writeHead(405, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'method not allowed' }));
      return;
    }
    try {
      // Stateless: новый server + transport на каждый запрос.
      const mcpServer = opts.createServer();
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      await mcpServer.connect(transport);
      await transport.handleRequest(req, res);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!res.headersSent) {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: msg }));
      }
    }
  });

  return new Promise((resolve, reject) => {
    httpServer.on('error', reject);
    httpServer.listen(port, host, () => {
      const addr = httpServer.address();
      const actualPort =
        addr && typeof addr === 'object' ? addr.port : port;
      resolve({
        url: `http://${host}:${actualPort}${MCP_ENDPOINT}`,
        close: async () => {
          httpServer.close();
        },
      });
    });
  });
}
