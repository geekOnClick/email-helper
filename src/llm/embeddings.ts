/**
 * Клиент embeddings RouterAI (OpenAI-совместимый).
 * Фаза 3, change vector-store: источник векторов для векторного хранилища.
 *
 * Симметричен `routerai-client.ts`: тот же injectable `FetchLike`,
 * AbortController-таймаут, ретраи 429/5xx/сеть, `redactKey`. Использует
 * `RouterAiError` (error-модель уже несёт status/model/retryAfterMs).
 *
 * Контракт — см. `openspec/changes/vector-store/specs/llm/embeddings/spec.md`.
 */
import { z } from 'zod';
import type { Config } from '../config/schema.js';
import { redactKey, isRetryableStatus } from './routerai-client.js';
import type { FetchLike } from './routerai-client.js';
import { RouterAiError } from './types.js';

export interface EmbeddingsClientOptions {
  config: Config;
  /** Инжектируемый fetch (для тестов); по умолчанию globalThis.fetch. */
  fetch?: FetchLike;
}

/**
 * Zod-схема ответа OpenAI embeddings v1.
 * `{ data: [{ embedding: number[], index: number }, ...] }`.
 */
export const embeddingsResponseSchema = z.object({
  data: z
    .array(
      z.object({
        embedding: z.array(z.number()),
        index: z.number(),
      }),
    )
    .min(1),
  model: z.string().optional(),
  usage: z
    .object({
      prompt_tokens: z.number().optional(),
      total_tokens: z.number().optional(),
    })
    .optional(),
});

export type EmbeddingsResponse = z.infer<typeof embeddingsResponseSchema>;

/**
 * Клиент embeddings: один POST /embeddings на пакет текстов.
 * Один объект — один сервис; `embed` — один шаг запрос→ответ (без состояния).
 */
export class EmbeddingsClient {
  private readonly config: Config;
  private readonly fetchImpl: FetchLike;
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(opts: EmbeddingsClientOptions) {
    this.config = opts.config;
    this.fetchImpl = opts.fetch ?? globalThis.fetch.bind(globalThis);
    this.apiKey = opts.config.ROUTERAI_API_KEY;
    this.baseUrl = opts.config.ROUTERAI_BASE_URL.replace(/\/+$/, '');
  }

  /**
   * Возвращает массив векторов по одному на каждый входной текст.
   * Для пустого `texts` возвращает `[]` без запроса.
   */
  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    const maxAttempts = Math.max(1, this.config.LLM_RETRIES + 1);
    let lastError: RouterAiError | null = null;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (attempt > 0) {
        await this.delay(attempt, lastError ?? undefined);
      }

      try {
        return await this.doFetch(texts);
      } catch (err) {
        if (err instanceof RouterAiError) {
          if (isRetryableStatus(err.status)) {
            lastError = err;
            continue;
          }
          throw err;
        }
        // TypeError от fetch (сеть) / AbortError (таймаут) — повторяем.
        lastError = this.wrapNetworkError(err);
        continue;
      }
    }

    throw (
      lastError ??
      new RouterAiError('RouterAI embeddings: исчерпаны попытки запроса')
    );
  }

  /** Один HTTP-запрос с таймаутом; парсит и нормализует ответ. */
  private async doFetch(texts: string[]): Promise<number[][]> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.LLM_REQUEST_TIMEOUT_MS);

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/embeddings`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          model: this.config.EMBEDDINGS_MODEL,
          input: texts,
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    const text = await response.text();
    if (text.length === 0) {
      throw new RouterAiError(
        redactKey(`RouterAI embeddings: пустой ответ от модели ${this.config.EMBEDDINGS_MODEL}`, this.apiKey),
        { status: response.status, model: this.config.EMBEDDINGS_MODEL },
      );
    }

    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      throw new RouterAiError(
        redactKey(
          `RouterAI embeddings: ответ не является валидным JSON (модель ${this.config.EMBEDDINGS_MODEL})`,
          this.apiKey,
        ),
        { status: response.status, model: this.config.EMBEDDINGS_MODEL },
      );
    }

    if (!response.ok) {
      throw new RouterAiError(
        this.formatHttpError(response.status, body),
        {
          status: response.status,
          model: this.config.EMBEDDINGS_MODEL,
          retryAfterMs: this.parseRetryAfter(response.headers.get('retry-after')),
        },
      );
    }

    let parsed: EmbeddingsResponse;
    try {
      parsed = embeddingsResponseSchema.parse(body);
    } catch (err) {
      throw new RouterAiError(
        redactKey(
          `RouterAI embeddings: неожиданная структура ответа от модели ${this.config.EMBEDDINGS_MODEL}`,
          this.apiKey,
        ),
        { model: this.config.EMBEDDINGS_MODEL, cause: err },
      );
    }

    // Сортируем по index на случай перемешивания сервером.
    const sorted = [...parsed.data].sort((a, b) => a.index - b.index);
    return sorted.map((d) => d.embedding);
  }

  /** Формирует сообщение HTTP-ошибки без раскрытия секрета. */
  private formatHttpError(status: number, body: unknown): string {
    let detail = '';
    if (body && typeof body === 'object') {
      const maybe = body as { error?: { message?: string }; message?: string };
      const msg = maybe.error?.message ?? maybe.message;
      if (typeof msg === 'string') {
        detail = `: ${msg}`;
      }
    }
    const base = `RouterAI embeddings: HTTP ${status} от модели ${this.config.EMBEDDINGS_MODEL}${detail}`;
    return redactKey(base, this.apiKey);
  }

  /** Задержка перед повтором: учитывает Retry-After и экспоненциальный рост. */
  private async delay(attempt: number, lastError?: RouterAiError): Promise<void> {
    const base = this.config.LLM_RETRY_BASE_MS;
    const exp = base * Math.pow(2, attempt - 1);
    const retryAfter = lastError?.retryAfterMs;
    const waitMs = retryAfter !== undefined ? Math.max(exp, retryAfter) : exp;
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }

  private parseRetryAfter(value: string | null): number | undefined {
    if (!value) return undefined;
    const asNum = Number(value);
    if (Number.isFinite(asNum) && asNum >= 0) {
      return asNum * 1000;
    }
    const asDate = Date.parse(value);
    if (Number.isFinite(asDate)) {
      return Math.max(0, asDate - Date.now());
    }
    return undefined;
  }

  private wrapNetworkError(err: unknown): RouterAiError {
    const isAbort = err instanceof Error && err.name === 'AbortError';
    const causeMsg = err instanceof Error ? err.message : String(err);
    const base = isAbort
      ? `RouterAI embeddings: таймаут запроса (${this.config.LLM_REQUEST_TIMEOUT_MS} мс) к модели ${this.config.EMBEDDINGS_MODEL}`
      : `RouterAI embeddings: сетевая ошибка запроса к модели ${this.config.EMBEDDINGS_MODEL}: ${causeMsg}`;
    return new RouterAiError(redactKey(base, this.apiKey), {
      model: this.config.EMBEDDINGS_MODEL,
      cause: err,
    });
  }
}