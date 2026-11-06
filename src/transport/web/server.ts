/**
 * Веб-сервер email-helper: встроенный Node HTTP REST API + отдача SPA
 * (change web-interface, design D2).
 *
 * Поднимается в том же процессе, что и CLI, переиспользует `bootstrap()`.
 * Слушает `WEB_HOST:WEB_PORT` (по умолчанию `127.0.0.1:3000`, localhost-only).
 * REST-эндпоинты под `/api`; статика SPA из `dist/client/` на корневом маршруте.
 *
 * Роутинг — простой маппинг `method + url → handler` (без фреймворка, как MCP
 * HTTP-транспорт). CORS для dev-origin Vite (порт 5173) в dev-режиме.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, normalize, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ApiContext, HandlerResult } from './api/handlers.js';
import * as h from './api/handlers.js';

/** Дефолтный хост — localhost-only. */
const DEFAULT_HOST = '127.0.0.1';
/** Дефолтный порт. */
const DEFAULT_PORT = 3000;
/** Каталог собранного SPA (относительно cwd). */
const CLIENT_DIST = 'dist/client';
/** Dev-origin Vite (для CORS в dev-режиме). */
const VITE_DEV_ORIGIN = 'http://localhost:5173';

/** Опции запуска веб-сервера. */
export interface RunWebOptions {
  /** Контекст API (bootstrap + реестр + env-путь). */
  ctx: ApiContext;
  /** Порт (из конфига WEB_PORT). */
  port?: number;
  /** Хост (из конфига WEB_HOST). */
  host?: string;
}

/** Результат запуска: URL + функция остановки. */
export interface WebServerHandle {
  url: string;
  close: () => Promise<void>;
}

/**
 * Поднимает HTTP-сервер: REST API под `/api` + статика SPA из `dist/client/`.
 * @returns handle с URL и close().
 */
export async function runWeb(opts: RunWebOptions): Promise<WebServerHandle> {
  const host = opts.host ?? DEFAULT_HOST;
  const port = opts.port ?? DEFAULT_PORT;
  const ctx = opts.ctx;

  const server = createServer((req, res) => {
    handleRequest(req, res, ctx).catch((e) => {
      const msg = e instanceof Error ? e.message : String(e);
      if (!res.headersSent) {
        res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: msg }));
      }
    });
  });

  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(port, host, () => {
      const addr = server.address();
      const actualPort = addr && typeof addr === 'object' ? addr.port : port;
      resolve({
        url: `http://${host}:${actualPort}`,
        close: async () => {
          server.close();
        },
      });
    });
  });
}

/** Маршрутизация запроса: /api/* → обработчик, иначе — статика SPA. */
async function handleRequest(req: IncomingMessage, res: ServerResponse, ctx: ApiContext): Promise<void> {
  // CORS для dev-origin Vite (preflight + обычные запросы).
  setCorsHeaders(req, res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = req.url ?? '/';
  const path = url.split('?')[0] ?? '/';

  // REST API.
  if (path.startsWith('/api/')) {
    await routeApi(req, res, path, ctx);
    return;
  }

  // Статика SPA.
  await serveStatic(res, path);
}

/** CORS-заголовки для dev-origin Vite. */
function setCorsHeaders(req: IncomingMessage, res: ServerResponse): void {
  const origin = req.headers.origin;
  if (origin === VITE_DEV_ORIGIN) {
    res.setHeader('Access-Control-Allow-Origin', VITE_DEV_ORIGIN);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }
}

/** Маршрутизация /api-эндпоинтов. */
async function routeApi(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  ctx: ApiContext,
): Promise<void> {
  const method = req.method ?? 'GET';
  const segments = path.replace(/^\/api\//, '').split('/').filter(Boolean);

  // GET /api/accounts
  if (method === 'GET' && segments.length === 1 && segments[0] === 'accounts') {
    return send(res, h.listAccounts(ctx));
  }
  // POST /api/accounts
  if (method === 'POST' && segments.length === 1 && segments[0] === 'accounts') {
    return send(res, await h.createAccount(ctx, await readJson(req)));
  }
  // GET /api/folders/:accountLogin
  if (method === 'GET' && segments.length === 2 && segments[0] === 'folders') {
    return send(res, await h.listFolders(ctx, decodeURIComponent(segments[1] ?? '')));
  }
  // POST /api/smart-search
  if (method === 'POST' && segments.length === 1 && segments[0] === 'smart-search') {
    return send(res, await h.smartSearch(ctx, await readJson(req)));
  }
  // POST /api/search (прямой поиск по структурированным критериям — для форм analyze/analyze-attachments)
  if (method === 'POST' && segments.length === 1 && segments[0] === 'search') {
    return send(res, await h.searchEmails(ctx, await readJson(req)));
  }
  // GET /api/emails/:accountLogin/:uid
  if (method === 'GET' && segments.length === 3 && segments[0] === 'emails') {
    const uid = Number(segments[2]);
    if (!Number.isInteger(uid)) return send(res, errResult(400, 'uid должен быть числом', 'invalid_dto'));
    const folder = readQuery(req, 'folder');
    return send(res, await h.getEmail(ctx, decodeURIComponent(segments[1] ?? ''), uid, folder));
  }
  // POST /api/analyze
  if (method === 'POST' && segments.length === 1 && segments[0] === 'analyze') {
    return send(res, await h.analyze(ctx, await readJson(req)));
  }
  // POST /api/analyze-many
  if (method === 'POST' && segments.length === 1 && segments[0] === 'analyze-many') {
    return send(res, await h.analyzeMany(ctx, await readJson(req)));
  }
  // POST /api/analyze-attachments
  if (method === 'POST' && segments.length === 1 && segments[0] === 'analyze-attachments') {
    return send(res, await h.analyzeAttachments(ctx, await readJson(req)));
  }
  // POST /api/smart-send/generate
  if (method === 'POST' && segments.length === 2 && segments[0] === 'smart-send' && segments[1] === 'generate') {
    return send(res, await h.smartSendGenerate(ctx, await readJson(req)));
  }
  // POST /api/smart-send/send
  if (method === 'POST' && segments.length === 2 && segments[0] === 'smart-send' && segments[1] === 'send') {
    return send(res, await h.smartSendSend(ctx, await readJson(req)));
  }
  // GET /api/attachments/:accountLogin/:uid/:filename — скачивание вложения (файл, не JSON)
  if (method === 'GET' && segments.length === 4 && segments[0] === 'attachments') {
    const uid = Number(segments[2]);
    if (!Number.isInteger(uid)) return send(res, errResult(400, 'uid должен быть числом', 'invalid_dto'));
    const filename = decodeURIComponent(segments[3] ?? '');
    const result = await h.downloadAttachment(ctx, decodeURIComponent(segments[1] ?? ''), uid, filename);
    if ('content' in result && 'filename' in result) {
      h.sendStreamResult(res, result);
      return;
    }
    return send(res, result);
  }

  // Неизвестный /api-маршрут.
  return send(res, errResult(404, 'not found'));
}

/** Читает JSON-тело запроса. */
async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const c of req) {
    chunks.push(c as Buffer);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (raw.trim() === '') return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error('невалидный JSON в теле запроса');
  }
}

/** Читает query-параметр из URL. */
function readQuery(req: IncomingMessage, key: string): string | undefined {
  const url = req.url ?? '';
  const qIdx = url.indexOf('?');
  if (qIdx === -1) return undefined;
  const search = new URLSearchParams(url.slice(qIdx + 1));
  const v = search.get(key);
  return v === null ? undefined : v;
}

/** Отправляет HandlerResult как JSON. */
function send(res: ServerResponse, result: HandlerResult): void {
  const body = 'error' in result ? result.error : result.data;
  res.writeHead(result.status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

/** Конструирует ошибку-результат (для случаев до обработчика). */
function errResult(status: number, error: string, code?: string): HandlerResult {
  return { status, error: { error, ...(code !== undefined ? { code } : {}) } };
}

// === Отдача статики SPA ===

/** MIME-типы для статики. */
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
};

/**
 * Отдаёт статику SPA из `dist/client/`. Корневой маршрут (`/`) → `index.html`.
 * При отсутствии сборки — 503 с подсказкой. Безопасный path (без выхода за каталог).
 */
async function serveStatic(res: ServerResponse, urlPath: string): Promise<void> {
  try {
    // Проверка существования каталога сборки.
    try {
      await stat(CLIENT_DIST);
    } catch {
      res.writeHead(503, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'соберите фронтенд: npm run web:build' }));
      return;
    }

    // Нормализация пути: '/' → index.html, иначе — безопасный путь.
    let rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\//, '');
    rel = normalize(rel).replace(/^(\.\.[/\\])+/, '');
    const abs = join(CLIENT_DIST, rel);

    // Защита от выхода за каталог сборки.
    if (!abs.startsWith(normalize(CLIENT_DIST))) {
      res.writeHead(403, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'forbidden' }));
      return;
    }

    try {
      const data = await readFile(abs);
      const mime = MIME[extname(abs)] ?? 'application/octet-stream';
      res.writeHead(200, { 'content-type': mime });
      res.end(data);
    } catch {
      // Для /assets/* (статика сборки) возвращаем 404, а не SPA-фолбэк —
      // иначе stale-кэш браузера (старый index.html со старым hash JS) получит
      // HTML вместо JS → MIME-ошибка module script. SPA-фолбэк — только для
      // клиентских маршрутов (не-asset путей).
      if (urlPath.startsWith('/assets/')) {
        res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'asset not found' }));
        return;
      }
      // SPA-фолбэк: неизвестный путь → index.html (клиентский роутинг).
      try {
        const index = await readFile(join(CLIENT_DIST, 'index.html'));
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(index);
      } catch {
        res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'not found' }));
      }
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: msg }));
  }
}

/** Утилита для тестов: путь к каталогу модуля (не используется в рантайме). */
export const __dirname = fileURLToPath(new URL('.', import.meta.url));
