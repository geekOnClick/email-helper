import type { Config } from '../config/schema.js';
import { resolveModel } from './models.js';
import { fromOpenAiToolName, toOpenAiToolName } from './tool-mapping.js';
import { parseChatResponse } from './schema.js';
import { RouterAiError } from './types.js';
import type {
  ChatRequest,
  ChatResult,
  ToolCall,
  ToolChoice,
} from './types.js';

/**
 * Тип инжектируемого транспорта (для мока в тестах).
 * По умолчанию — глобальный fetch (Node ≥ 20).
 */
export type FetchLike = typeof globalThis.fetch;

export interface RouterAiClientOptions {
  config: Config;
  /** Инжектируемый fetch (для тестов); по умолчанию globalThis.fetch. */
  fetch?: FetchLike;
}

/** Минимальное описание ответа, нужное клиенту. */
interface FetchJsonResult {
  status: number;
  body: unknown;
  retryAfterMs?: number;
}

const REDACTED = '[REDACTED]';

/** Заменяет вхождения значения ключа на `[REDACTED]`. Безопасно при пустом ключе. */
export function redactKey(text: string, key?: string): string {
  if (!key || key.length === 0) return text;
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text.replace(new RegExp(escaped, 'g'), REDACTED);
}

/**
 * OpenAI-совместимый клиент RouterAI.
 * Один объект — один сервис; метод `chat` выполняет один шаг запрос→ответ.
 */
export class RouterAiClient {
  private readonly config: Config;
  private readonly fetchImpl: FetchLike;
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(opts: RouterAiClientOptions) {
    this.config = opts.config;
    this.fetchImpl = opts.fetch ?? globalThis.fetch.bind(globalThis);
    this.apiKey = opts.config.ROUTERAI_API_KEY;
    this.baseUrl = opts.config.ROUTERAI_BASE_URL.replace(/\/+$/, '');
  }

  /** Выполняет чат-запрос к LLM с ретраями и валидацией ответа. */
  async chat(request: ChatRequest): Promise<ChatResult> {
    const model = resolveModel(this.config, { role: request.role, model: request.model });
    const body = this.buildRequestBody(request, model);
    const maxAttempts = Math.max(1, this.config.LLM_RETRIES + 1);

    let lastError: RouterAiError | null = null;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (attempt > 0) {
        await this.delay(attempt, lastError ?? undefined);
      }

      try {
        const result = await this.doFetch(body, model);
        return result;
      } catch (err) {
        if (err instanceof RouterAiError) {
          if (isRetryableStatus(err.status)) {
            lastError = err;
            continue;
          }
          // 4xx (кроме 429), malformed/parse-ошибки (без статуса) — не повторяем.
          throw err;
        }
        // TypeError от fetch (сеть) / AbortError (таймаут) — повторяем.
        lastError = this.wrapNetworkError(err, model);
        continue;
      }
    }

    throw (
      lastError ??
      new RouterAiError('RouterAI: исчерпаны попытки запроса', { model })
    );
  }

  /** Собирает тело запроса OpenAI Chat Completions v1. */
  private buildRequestBody(request: ChatRequest, model: string): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model,
      messages: request.messages.map(serializeMessage),
    };

    if (request.tools && request.tools.length > 0) {
      body['tools'] = request.tools;
    }
    if (request.toolChoice !== undefined) {
      body['tool_choice'] = serializeToolChoice(request.toolChoice);
    }
    if (request.temperature !== undefined) body['temperature'] = request.temperature;
    if (request.maxTokens !== undefined) body['max_tokens'] = request.maxTokens;
    if (request.topP !== undefined) body['top_p'] = request.topP;

    return body;
  }

  /** Один HTTP-запрос с таймаутом; парсит и нормализует ответ. */
  private async doFetch(body: Record<string, unknown>, model: string): Promise<ChatResult> {
    const controller = new AbortController();
    const timeoutMs = this.config.LLM_REQUEST_TIMEOUT_MS;
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } finally {
      // Гарантированно снимаем таймер (в т.ч. при AbortError таймаута).
      clearTimeout(timer);
    }

    const parsed = await this.readBody(response, model);

    if (!response.ok) {
      throw new RouterAiError(
        this.formatHttpError(response.status, parsed.body, model),
        { status: response.status, model, retryAfterMs: parsed.retryAfterMs },
      );
    }

    return this.parseResult(parsed.body, model);
  }

  /** Читает тело ответа; толерантен к пустому/не-JSON телу. */
  private async readBody(response: Response, model: string): Promise<FetchJsonResult> {
    const retryAfter = response.headers.get('retry-after');
    const retryAfterMs = retryAfter ? this.parseRetryAfter(retryAfter) : undefined;

    const text = await response.text();
    if (text.length === 0) {
      return { status: response.status, body: null, retryAfterMs };
    }

    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      // Malformed JSON — формируем ошибку парсинга (без раскрытия ключа).
      throw new RouterAiError(
        redactKey(`RouterAI: ответ не является валидным JSON (модель ${model})`, this.apiKey),
        { status: response.status, model },
      );
    }

    return { status: response.status, body, retryAfterMs };
  }

  /** Парсит и нормализует успешный ответ (zod-валидация). */
  private parseResult(body: unknown, model: string): ChatResult {
    let parsed;
    try {
      parsed = parseChatResponse(body);
    } catch (err) {
      throw new RouterAiError(
        redactKey(
          `RouterAI: неожиданная структура ответа от модели ${model}`,
          this.apiKey,
        ),
        { model, cause: err },
      );
    }

    const toolCalls: ToolCall[] = parsed.rawToolCalls.map((raw) => {
      // Имя приходит в OpenAI-виде (с подчёркиваниями) — возвращаем к доменному.
      const domainName = fromOpenAiToolName(raw.name);
      const { args, parseError } = parseToolCallArguments(raw.arguments);
      return {
        id: raw.id,
        name: domainName,
        arguments: raw.arguments,
        args,
        parseError,
      };
    });

    return {
      content: parsed.content,
      toolCalls,
      usage: parsed.usage,
      model: parsed.model ?? model,
    };
  }

  /** Формирует сообщение HTTP-ошибки без раскрытия секрета. */
  private formatHttpError(status: number, body: unknown, model: string): string {
    let detail = '';
    if (body && typeof body === 'object') {
      const maybe = body as { error?: { message?: string }; message?: string };
      const msg = maybe.error?.message ?? maybe.message;
      if (typeof msg === 'string') {
        detail = `: ${msg}`;
      }
    }
    const base = `RouterAI: HTTP ${status} от модели ${model}${detail}`;
    return redactKey(base, this.apiKey);
  }

  /** Задержка перед повтором: учитывает Retry-After и экспоненциальный рост. */
  private async delay(attempt: number, lastError?: RouterAiError): Promise<void> {
    const base = this.config.LLM_RETRY_BASE_MS;
    const exp = base * Math.pow(2, attempt - 1);
    // Если последняя ошибка несёт Retry-After — берём максимум из него и экспоненты.
    const retryAfter = lastError?.retryAfterMs;
    const waitMs = retryAfter !== undefined ? Math.max(exp, retryAfter) : exp;
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }

  private parseRetryAfter(value: string): number | undefined {
    const asNum = Number(value);
    if (Number.isFinite(asNum) && asNum >= 0) {
      return asNum * 1000;
    }
    // HTTP-date формат — парсим, если валиден.
    const asDate = Date.parse(value);
    if (Number.isFinite(asDate)) {
      return Math.max(0, asDate - Date.now());
    }
    return undefined;
  }

  private wrapNetworkError(err: unknown, model: string): RouterAiError {
    const isAbort = err instanceof Error && err.name === 'AbortError';
    const causeMsg = err instanceof Error ? err.message : String(err);
    const base = isAbort
      ? `RouterAI: таймаут запроса (${this.config.LLM_REQUEST_TIMEOUT_MS} мс) к модели ${model}`
      : `RouterAI: сетевая ошибка запроса к модели ${model}: ${causeMsg}`;
    return new RouterAiError(redactKey(base, this.apiKey), { model, cause: err });
  }
}

/** Повторяем ли HTTP-статус: 429 и 5xx — да, остальное (включая отсутствие статуса) — нет. */
export function isRetryableStatus(status: number | undefined): boolean {
  if (status === undefined) return false;
  return status === 429 || status >= 500;
}

/** Парсит аргументы вызова функции (строка JSON) без выброса. */
export function parseToolCallArguments(raw: string): {
  args: unknown | null;
  parseError?: string;
} {
  if (raw.length === 0) {
    return { args: null, parseError: 'пустые аргументы' };
  }
  try {
    return { args: JSON.parse(raw) };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { args: null, parseError: msg };
  }
}

/** Сериализует сообщение чата в OpenAI-формат для тела запроса. */
function serializeMessage(msg: ChatRequest['messages'][number]): Record<string, unknown> {
  switch (msg.role) {
    case 'system':
    case 'user':
      return { role: msg.role, content: msg.content };
    case 'assistant': {
      const out: Record<string, unknown> = { role: 'assistant', content: msg.content ?? '' };
      if (msg.toolCalls && msg.toolCalls.length > 0) {
        out['tool_calls'] = msg.toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function',
          function: {
            // При повторной отправке имени — обратно в OpenAI-вид (подчёркивания).
            name: toOpenAiToolName(tc.name),
            arguments: tc.arguments,
          },
        }));
      }
      return out;
    }
    case 'tool':
      return { role: 'tool', tool_call_id: msg.toolCallId, content: msg.content };
  }
}

function serializeToolChoice(choice: ToolChoice): unknown {
  if (typeof choice === 'string') {
    return choice;
  }
  return {
    type: 'function',
    function: { name: toOpenAiToolName(choice.function.name) },
  };
}
