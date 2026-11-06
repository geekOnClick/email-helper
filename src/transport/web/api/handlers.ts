/**
 * REST API-обработчики веб-транспорта (change web-interface, design D2/D5).
 *
 * Каждый обработчик принимает DTO, вызывает чистую доменную функцию (из
 * transport/commands) или тул напрямую, возвращает JSON. Ошибки нормализуются
 * в `ApiError`. Пароли исключены из ответов. Подключение аккаунта — через
 * session-store (как CLI `ensureMailConnected`), прозрачно с self-healing.
 */
import { getTool } from '../../../tools/registry.js';
import { getSharedSessionStore } from '../../../tools/mail/register-tools.js';
import { redact } from '../../../tools/mail/redact.js';
import { runSmartSearch } from '../../commands/smart-search.js';
import { runAnalyze } from '../../commands/analyze.js';
import { runAnalyzeMany } from '../../commands/analyze-many.js';
import { runAnalyzeAttachments } from '../../commands/analyze-attachments.js';
import { generateSmartSendBody, sendSmartSend } from '../../commands/smart-send.js';
import { saveAccount } from '../../commands/add-account.js';
import { fetchEmail } from '../../commands/fetch-email.js';
import { toSearchCriteria } from '../../cli/prompts.js';
import type { BootstrapResult } from '../../cli/bootstrap.js';
import type { AccountRegistry } from '../../../config/account-registry.js';
import type { MailAccount } from '../../../tools/mail/types.js';
import type {
  AccountPublicDto,
  CreateAccountDto,
  SmartSearchDto,
  SearchDto,
  AnalyzeDto,
  AnalyzeManyDto,
  AnalyzeAttachmentsDto,
  SmartSendGenerateDto,
  SmartSendSendDto,
  ApiError,
} from './dtos.js';
import type { Folder } from '../../../tools/mail/types.js';
import type { SearchResult, DownloadResult } from '../../../types/email.js';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import * as os from 'node:os';
import type { ServerResponse } from 'node:http';

/** Контекст API: результат bootstrap + env-путь для add-account. */
export interface ApiContext {
  /** Результат bootstrap (агенты, тулы, реестр, статистика). */
  bootstrap: BootstrapResult;
  /** In-memory реестр аккаунтов. */
  registry: AccountRegistry;
  /** Путь к `.env` (для `POST /api/accounts`). */
  envPath: string;
  /** Окно bounded-поиска (из конфига). */
  fallbackDays: number;
  /** Потолок числа писем для analyze-many (из конфига). */
  analyzeManyMaxEmails: number;
}

/** Результат обработчика: либо данные (200/201), либо ошибка с HTTP-кодом. */
export type HandlerResult =
  | { status: number; data: unknown }
  | { status: number; error: ApiError };

/** Успешный ответ. */
function ok(data: unknown, status = 200): HandlerResult {
  return { status, data };
}

/** Ошибка. */
function err(status: number, error: string, code?: string): HandlerResult {
  return { status, error: { error, ...(code !== undefined ? { code } : {}) } };
}

/** Ищет аккаунт по login; возвращает его или 404-ошибку. */
function requireAccount(
  ctx: ApiContext,
  login: string,
): { ok: true; account: MailAccount } | { ok: false; result: HandlerResult } {
  const account = ctx.registry.list().find((a) => a.login === login);
  if (!account) {
    return { ok: false, result: err(404, `аккаунт не найден: ${login}`, 'account_not_found') };
  }
  return { ok: true, account };
}

/**
 * Подключает аккаунт (если не подключён / соединение разорвано), как CLI
 * `ensureMailConnected`, но без io-вывода. Возвращает true при успехе.
 */
async function ensureConnected(account: MailAccount): Promise<{ ok: true } | { ok: false; result: HandlerResult }> {
  const store = getSharedSessionStore();
  if (store.has(account.login)) {
    const provider = store.get(account.login);
    if (provider && provider.isConnectionUsable()) return { ok: true };
    if (provider) {
      try {
        await provider.reconnect();
        return { ok: true };
      } catch (e) {
        return { ok: false, result: err(503, `ошибка переподключения: ${msg(e)}`, 'reconnect_failed') };
      }
    }
  }
  const connectTool = getTool('mail.connect');
  if (!connectTool) return { ok: false, result: err(500, 'тул mail.connect не зарегистрирован') };
  try {
    await connectTool.handler({ login: account.login, provider: account.provider });
    return { ok: true };
  } catch (e) {
    return { ok: false, result: err(503, `ошибка подключения: ${msg(e)}`, 'connect_failed') };
  }
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Маскирует секреты в сообщении об ошибке. */
function redactedMsg(ctx: ApiContext, e: unknown): string {
  const m = msg(e);
  const secrets = ctx.registry.list().map((a) => a.password);
  return redact(m, ...secrets);
}

// === Обработчики ===

/** `GET /api/accounts` — список аккаунтов без паролей. */
export function listAccounts(ctx: ApiContext): HandlerResult {
  const accounts: AccountPublicDto[] = ctx.registry.list().map((a) => ({
    login: a.login,
    provider: a.provider,
    authStrategy: a.authStrategy,
  }));
  return ok(accounts);
}

/** `POST /api/accounts` — добавление аккаунта. */
export async function createAccount(ctx: ApiContext, body: unknown): Promise<HandlerResult> {
  const dto = body as CreateAccountDto;
  if (!dto || typeof dto.provider !== 'string' || typeof dto.login !== 'string' || typeof dto.password !== 'string') {
    return err(400, 'невалидный DTO: требуются provider, login, password', 'invalid_dto');
  }
  try {
    const result = await saveAccount({
      account: {
        provider: dto.provider,
        login: dto.login,
        password: dto.password,
        ...(dto.authStrategy !== undefined ? { authStrategy: dto.authStrategy } : {}),
      },
      registry: ctx.registry,
      envPath: ctx.envPath,
    });
    return ok(result, 201);
  } catch (e) {
    return err(400, redactedMsg(ctx, e), 'save_failed');
  }
}

/** `GET /api/folders/:accountLogin` — список папок ящика. */
export async function listFolders(ctx: ApiContext, accountLogin: string): Promise<HandlerResult> {
  const found = requireAccount(ctx, accountLogin);
  if (!found.ok) return found.result;
  const conn = await ensureConnected(found.account);
  if (!conn.ok) return conn.result;
  const listFoldersTool = getTool('mail.listFolders');
  if (!listFoldersTool) return err(500, 'тул mail.listFolders не зарегистрирован');
  try {
    const folders = (await listFoldersTool.handler({ login: accountLogin })) as Folder[];
    return ok(folders);
  } catch (e) {
    return err(500, redactedMsg(ctx, e), 'list_folders_failed');
  }
}

/** `POST /api/smart-search` — поиск писем по промпту. */
export async function smartSearch(ctx: ApiContext, body: unknown): Promise<HandlerResult> {
  const dto = body as SmartSearchDto;
  if (!dto || typeof dto.accountLogin !== 'string' || typeof dto.prompt !== 'string') {
    return err(400, 'невалидный DTO: требуются accountLogin, prompt', 'invalid_dto');
  }
  const found = requireAccount(ctx, dto.accountLogin);
  if (!found.ok) return found.result;
  const conn = await ensureConnected(found.account);
  if (!conn.ok) return conn.result;
  const searchTool = getTool('mail.search');
  if (!searchTool) return err(500, 'тул mail.search не зарегистрирован');
  try {
    const result = await runSmartSearch({
      accountLogin: dto.accountLogin,
      prompt: dto.prompt,
      llmClient: ctx.bootstrap.llmClient,
      searchTool,
      fallbackDays: dto.fallbackDays ?? ctx.fallbackDays,
      maxEmails: dto.maxEmails ?? ctx.analyzeManyMaxEmails,
    });
    return ok(result);
  } catch (e) {
    return err(500, redactedMsg(ctx, e), 'smart_search_failed');
  }
}

/** `POST /api/search` — прямой поиск писем по структурированным критериям
 *  (тема/отправитель/дата). Использует `toSearchCriteria` (как CLI `/analyze`):
 *  поле `date` (одна дата YYYY-MM-DD) раскрывается в диапазон одного дня включительно. */
export async function searchEmails(ctx: ApiContext, body: unknown): Promise<HandlerResult> {
  const dto = body as SearchDto;
  if (!dto || typeof dto.accountLogin !== 'string' || !dto.criteria || typeof dto.criteria !== 'object') {
    return err(400, 'невалидный DTO: требуются accountLogin, criteria', 'invalid_dto');
  }
  const found = requireAccount(ctx, dto.accountLogin);
  if (!found.ok) return found.result;
  const conn = await ensureConnected(found.account);
  if (!conn.ok) return conn.result;
  const searchTool = getTool('mail.search');
  if (!searchTool) return err(500, 'тул mail.search не зарегистрирован');
  try {
    // Маппим входные критерии (тема/отправитель/дата) в SearchCriteria (since/before).
    const criteria = toSearchCriteria(dto.criteria);
    const result = (await searchTool.handler({ login: dto.accountLogin, criteria })) as SearchResult;
    return ok(result);
  } catch (e) {
    return err(500, redactedMsg(ctx, e), 'search_failed');
  }
}

/** `GET /api/emails/:accountLogin/:uid` — чтение тела письма. */
export async function getEmail(ctx: ApiContext, accountLogin: string, uid: number, folder?: string): Promise<HandlerResult> {
  const found = requireAccount(ctx, accountLogin);
  if (!found.ok) return found.result;
  const conn = await ensureConnected(found.account);
  if (!conn.ok) return conn.result;
  const fetchTool = getTool('mail.fetch');
  if (!fetchTool) return err(500, 'тул mail.fetch не зарегистрирован');
  try {
    const email = await fetchEmail({
      accountLogin,
      uid,
      fetchTool,
      ...(folder !== undefined ? { folder } : {}),
    });
    return ok(email);
  } catch (e) {
    return err(500, redactedMsg(ctx, e), 'fetch_failed');
  }
}

/** `POST /api/analyze` — анализ одного письма. */
export async function analyze(ctx: ApiContext, body: unknown): Promise<HandlerResult> {
  const dto = body as AnalyzeDto;
  if (!dto || typeof dto.accountLogin !== 'string' || typeof dto.uid !== 'number') {
    return err(400, 'невалидный DTO: требуются accountLogin, uid', 'invalid_dto');
  }
  const found = requireAccount(ctx, dto.accountLogin);
  if (!found.ok) return found.result;
  const conn = await ensureConnected(found.account);
  if (!conn.ok) return conn.result;
  const fetchTool = getTool('mail.fetch');
  if (!fetchTool) return err(500, 'тул mail.fetch не зарегистрирован');
  try {
    const result = await runAnalyze({
      accountLogin: dto.accountLogin,
      uid: dto.uid,
      fetchTool,
      analyzer: ctx.bootstrap.analyzer,
      ...(dto.folder !== undefined ? { folder: dto.folder } : {}),
    });
    return ok(result);
  } catch (e) {
    return err(500, redactedMsg(ctx, e), 'analyze_failed');
  }
}

/** `POST /api/analyze-many` — анализ нескольких писем. */
export async function analyzeMany(ctx: ApiContext, body: unknown): Promise<HandlerResult> {
  const dto = body as AnalyzeManyDto;
  if (!dto || typeof dto.accountLogin !== 'string' || !dto.criteria) {
    return err(400, 'невалидный DTO: требуются accountLogin, criteria', 'invalid_dto');
  }
  const found = requireAccount(ctx, dto.accountLogin);
  if (!found.ok) return found.result;
  const conn = await ensureConnected(found.account);
  if (!conn.ok) return conn.result;
  const searchTool = getTool('mail.search');
  const fetchTool = getTool('mail.fetch');
  if (!searchTool || !fetchTool) return err(500, 'тулы mail.search/mail.fetch не зарегистрированы');
  try {
    const result = await runAnalyzeMany({
      accountLogin: dto.accountLogin,
      criteria: dto.criteria,
      searchTool,
      fetchTool,
      analyzer: ctx.bootstrap.analyzer,
      maxEmails: dto.maxEmails ?? ctx.analyzeManyMaxEmails,
    });
    return ok(result);
  } catch (e) {
    return err(500, redactedMsg(ctx, e), 'analyze_many_failed');
  }
}

/** `POST /api/analyze-attachments` — анализ вложений. */
export async function analyzeAttachments(ctx: ApiContext, body: unknown): Promise<HandlerResult> {
  const dto = body as AnalyzeAttachmentsDto;
  if (!dto || typeof dto.accountLogin !== 'string' || typeof dto.uid !== 'number') {
    return err(400, 'невалидный DTO: требуются accountLogin, uid', 'invalid_dto');
  }
  const found = requireAccount(ctx, dto.accountLogin);
  if (!found.ok) return found.result;
  const conn = await ensureConnected(found.account);
  if (!conn.ok) return conn.result;
  const downloadTool = getTool('mail.downloadAttachments');
  if (!downloadTool) return err(500, 'тул mail.downloadAttachments не зарегистрирован');
  try {
    const result = await runAnalyzeAttachments({
      accountLogin: dto.accountLogin,
      uid: dto.uid,
      downloadTool,
      analyzer: ctx.bootstrap.analyzer,
    });
    return ok(result);
  } catch (e) {
    return err(500, redactedMsg(ctx, e), 'analyze_attachments_failed');
  }
}

/** `POST /api/smart-send/generate` — генерация тела письма. */
export async function smartSendGenerate(ctx: ApiContext, body: unknown): Promise<HandlerResult> {
  const dto = body as SmartSendGenerateDto;
  if (!dto || typeof dto.accountLogin !== 'string' || typeof dto.to !== 'string' || typeof dto.subject !== 'string' || typeof dto.prompt !== 'string') {
    return err(400, 'невалидный DTO: требуются accountLogin, to, subject, prompt', 'invalid_dto');
  }
  // Генерация тела не требует подключения (только LLM).
  try {
    const body = await generateSmartSendBody({
      llmClient: ctx.bootstrap.llmClient,
      subject: dto.subject,
      to: dto.to,
      prompt: dto.prompt,
      ...(dto.body !== undefined ? { currentBody: dto.body } : {}),
      ...(dto.feedback !== undefined ? { feedback: dto.feedback } : {}),
    });
    return ok({ body });
  } catch (e) {
    return err(500, redactedMsg(ctx, e), 'generate_failed');
  }
}

/** `POST /api/smart-send/send` — отправка подтверждённого тела. */
export async function smartSendSend(ctx: ApiContext, body: unknown): Promise<HandlerResult> {
  const dto = body as SmartSendSendDto;
  if (!dto || typeof dto.accountLogin !== 'string' || typeof dto.to !== 'string' || typeof dto.subject !== 'string' || typeof dto.body !== 'string') {
    return err(400, 'невалидный DTO: требуются accountLogin, to, subject, body', 'invalid_dto');
  }
  const found = requireAccount(ctx, dto.accountLogin);
  if (!found.ok) return found.result;
  // Отправка требует подключённого аккаунта (SMTP).
  const conn = await ensureConnected(found.account);
  if (!conn.ok) return conn.result;
  const sendTool = getTool('mail.send');
  if (!sendTool) return err(500, 'тул mail.send не зарегистрирован');
  const result = await sendSmartSend({
    accountLogin: dto.accountLogin,
    sendTool,
    to: dto.to,
    subject: dto.subject,
    body: dto.body,
  });
  if (result.sent) return ok({ sent: true });
  return err(500, redactedMsg(ctx, new Error(result.error ?? 'ошибка отправки')), 'send_failed');
}

/**
 * `GET /api/attachments/:accountLogin/:uid/:filename` — скачивание вложения.
 *
 * Скачивает все вложения во временную папку (через `mail.downloadAttachments`),
 * находит файл по имени и возвращает его содержимое. Временная папка удаляется.
 * Возвращает `StreamResult` (отдаётся сервером как файл, не JSON).
 */
export async function downloadAttachment(
  ctx: ApiContext,
  accountLogin: string,
  uid: number,
  filename: string,
): Promise<StreamResult | HandlerResult> {
  const found = requireAccount(ctx, accountLogin);
  if (!found.ok) return found.result;
  const conn = await ensureConnected(found.account);
  if (!conn.ok) return conn.result;
  const downloadTool = getTool('mail.downloadAttachments');
  if (!downloadTool) return err(500, 'тул mail.downloadAttachments не зарегистрирован');

  const tmpDir = join(os.tmpdir(), `email-helper-dl-${Date.now()}-${process.pid}`);
  try {
    const result = (await downloadTool.handler({
      login: accountLogin,
      uid,
      targetDir: tmpDir,
      names: [filename],
    })) as DownloadResult;
    const match = result.paths.find((p) => p.endsWith(filename) || p.split('/').pop() === filename || p.split('\\').pop() === filename);
    if (!match) return err(404, `вложение не найдено: ${filename}`, 'attachment_not_found');
    const content = await readFile(match);
    return { content, filename };
  } catch (e) {
    return err(500, redactedMsg(ctx, e), 'download_failed');
  } finally {
    try {
      await rm(tmpDir, { recursive: true, force: true });
    } catch {
      // очистка tmp — не критично
    }
  }
}

/** Результат стриминга файла (вложение) — отдаётся как файл, не JSON. */
export interface StreamResult {
  content: Buffer;
  filename: string;
}

/** Записывает StreamResult в ответ как файл (Content-Disposition: attachment). */
export function sendStreamResult(res: ServerResponse, sr: StreamResult): void {
  res.writeHead(200, {
    'content-type': 'application/octet-stream',
    'content-disposition': `attachment; filename="${sr.filename.replace(/"/g, '')}"`,
  });
  res.end(sr.content);
}
