/**
 * Переиспользуемый движок цикла tool-calling (Фаза 2, change orchestrator).
 *
 * Не зависит от роли/системного промпта: любой агент (оркестратор/анализатор/
 * помощник) крутит его со своим набором тулов и историей сообщений. Опирается на
 * готовый RouterAiClient (один шаг запрос→ответ) и доменные типы сообщений/тулов.
 */
import { getTool } from '../tools/registry.js';
import { serializeToolResult } from './result-serializer.js';
import { noopToolLogger, type ToolLogger } from '../observability/logger.js';
import type { RouterAiClient } from '../llm/routerai-client.js';
import { addUsage } from '../llm/types.js';
import type {
  AgentRole,
  ChatMessage,
  ToolCall,
  ToolChoice,
  ToolProgressEvent,
  ToolResultMessage,
  Usage,
} from '../llm/types.js';
import type { OpenAiTool } from '../llm/types.js';
import type { ToolDef, ToolResult } from '../tools/registry.js';

/** Один вызов тулa: модельный ToolCall → результат как сообщение tool. */
export interface ToolResolver {
  resolve(toolCall: ToolCall): Promise<ToolResultMessage>;
}

/** Опции цикла tool-calling. */
export interface ToolLoopOptions {
  /** LLM-клиент (один шаг запрос→ответ). */
  client: RouterAiClient;
  /** История сообщений (системный + user/assistant/tool); мутируется циклом. */
  messages: ChatMessage[];
  /** Доступные тулы в формате OpenAI (из mapToolsToOpenAi). */
  /** Доступные тулы в формате OpenAI (из mapToolsToOpenAi). */
  tools?: OpenAiTool[];
  /** Стратегия выбора функции (по умолчанию авто). */
  toolChoice?: ToolChoice;
  /** Resolver тулов; по умолчанию RegistryToolResolver. */
  resolver?: ToolResolver;
  /** Доп. тулы вне реестра (delegate и пр.) — резолвятся тем же resolver'ом. */
  extraTools?: ToolDef[];
  /** Максимум итераций (по умолчанию из конфига, здесь обязан быть передан). */
  maxIterations: number;
  /** Лимит символов в результате тулa. */
  maxToolResultChars: number;
  /** Роль агента для запроса к LLM (опц.; передаётся клиенту). */
  role?: AgentRole;
  /** Наблюдатель прогресса цикла (опц.): испускает события по тулам и усечению. */
  onToolEvent?: (event: ToolProgressEvent) => void;
  /** Логгер вызовов тулов (опц., аудит): фиксирует имя, статус, длительность, summary. */
  toolLogger?: ToolLogger;
}

/** Результат цикла tool-calling. */
export interface ToolLoopResult {
  /** Финальный текстовый ответ ассистента. */
  content: string;
  /** Все вызовы тулов по всем итерациям (для логирования/прогресса). */
  toolCalls: ToolCall[];
  /** Число выполненных итераций. */
  iterations: number;
  /** Достигнут ли лимит итераций (ответ усечён). */
  truncated: boolean;
  /** Использование токенов последней итерации (если вернулось). */
  usage?: Usage;
}

/** Строит сообщение с результатом/ошибкой тулa. */
function toolResultMessage(toolCallId: string, content: string): ToolResultMessage {
  return { role: 'tool', toolCallId, content };
}

/** Лимит символов в кратком summary прогресса тулa (для наблюдателя). */
const PROGRESS_SUMMARY_CHARS = 200;

/** Строит краткое summary результата тулa для события прогресса. */
function progressSummary(content: string): string {
  if (content.length <= PROGRESS_SUMMARY_CHARS) return content;
  return content.slice(0, PROGRESS_SUMMARY_CHARS) + '…';
}

/** Признаки начала строки-ошибки из resolver'а (ok=false для события прогресса). */
function isToolError(content: string): boolean {
  return (
    content.startsWith('Ошибка тулa') ||
    content.startsWith('Невалидные аргументы тулa') ||
    content.startsWith('Тул не найден')
  );
}

/**
 * Resolver по умолчанию: исполняет тулы через реестр агента.
 * Ошибки (исключение, неизвестный тул, невалидные args) НЕ прерывают цикл —
 * возвращаются как ToolResultMessage с описанием, чтобы модель отреагировала.
 */
export class RegistryToolResolver implements ToolResolver {
  private readonly extraTools: Map<string, ToolDef>;
  private readonly maxToolResultChars: number;
  private readonly toolLogger: ToolLogger;

  constructor(
    maxToolResultChars: number,
    extraTools: ToolDef[] = [],
    toolLogger: ToolLogger = noopToolLogger(),
  ) {
    this.maxToolResultChars = maxToolResultChars;
    this.extraTools = new Map(extraTools.map((t) => [t.name, t]));
    this.toolLogger = toolLogger;
  }

  async resolve(toolCall: ToolCall): Promise<ToolResultMessage> {
    // Невалидные аргументы — модель отдаёт некорректный JSON для args.
    if (toolCall.args === null) {
      const reason = toolCall.parseError ?? 'пустые аргументы';
      const summary = `Невалидные аргументы тулa ${toolCall.name}: ${reason}`;
      this.toolLogger.logToolCall({
        toolName: toolCall.name,
        status: 'error',
        durationMs: 0,
        summary: progressSummary(summary),
      });
      return toolResultMessage(toolCall.id, summary);
    }

    // Сначала доп. тулы (delegate и пр.), затем реестр.
    const def = this.extraTools.get(toolCall.name) ?? getTool(toolCall.name);
    if (!def) {
      const summary = `Тул не найден: ${toolCall.name}`;
      this.toolLogger.logToolCall({
        toolName: toolCall.name,
        status: 'error',
        durationMs: 0,
        summary: progressSummary(summary),
      });
      return toolResultMessage(toolCall.id, summary);
    }

    const start = Date.now();
    try {
      const result = await def.handler(toolCall.args as Record<string, unknown>);
      const content = serializeToolResult(result, this.maxToolResultChars);
      this.toolLogger.logToolCall({
        toolName: toolCall.name,
        status: 'ok',
        durationMs: Date.now() - start,
        summary: progressSummary(content),
      });
      return toolResultMessage(toolCall.id, content);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const summary = `Ошибка тулa ${toolCall.name}: ${msg}`;
      this.toolLogger.logToolCall({
        toolName: toolCall.name,
        status: 'error',
        durationMs: Date.now() - start,
        summary: progressSummary(summary),
      });
      return toolResultMessage(toolCall.id, summary);
    }
  }
}

/**
 * Запускает цикл tool-calling: модель → tool_calls → resolver → role:"tool" → модель,
 * пока модель не ответит текстом без вызовов или не исчерпается лимит итераций.
 *
 * Мутирует opts.messages: дописывает assistant(tool_calls) и tool-результаты.
 */
export async function runToolLoop(opts: ToolLoopOptions): Promise<ToolLoopResult> {
  const resolver =
    opts.resolver ??
    new RegistryToolResolver(
      opts.maxToolResultChars,
      opts.extraTools ?? [],
      opts.toolLogger ?? noopToolLogger(),
    );
  const allToolCalls: ToolCall[] = [];
  let lastContent = '';
  let totalUsage: Usage | undefined;
  let truncated = false;

  for (let iteration = 0; iteration < opts.maxIterations; iteration++) {
    const result = await opts.client.chat({
      messages: opts.messages,
      tools: opts.tools,
      role: opts.role,
    });

    lastContent = result.content;
    totalUsage = addUsage(totalUsage, result.usage);

    // Финал: модель ответила текстом без вызовов.
    if (result.toolCalls.length === 0) {
      return {
        content: result.content,
        toolCalls: allToolCalls,
        iterations: iteration + 1,
        truncated: false,
        usage: totalUsage,
      };
    }

    // Записываем в историю assistant-ответ с tool_calls, затем — все tool-результаты.
    allToolCalls.push(...result.toolCalls);
    opts.messages.push({
      role: 'assistant',
      content: result.content,
      toolCalls: result.toolCalls,
    });

    for (const toolCall of result.toolCalls) {
      if (opts.onToolEvent) {
        opts.onToolEvent({ type: 'toolCall', iteration, toolCall });
      }
      const toolMsg = await resolver.resolve(toolCall);
      opts.messages.push(toolMsg);
      if (opts.onToolEvent) {
        opts.onToolEvent({
          type: 'toolResult',
          iteration,
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          ok: !isToolError(toolMsg.content),
          summary: progressSummary(toolMsg.content),
        });
      }
    }

    // Если это была последняя разрешённая итерация — модель всё ещё зовёт тулы.
    if (iteration === opts.maxIterations - 1) {
      truncated = true;
      if (opts.onToolEvent) {
        opts.onToolEvent({ type: 'truncated', iterations: opts.maxIterations });
      }
      break;
    }
  }

  return {
    content: lastContent,
    toolCalls: allToolCalls,
    iterations: opts.maxIterations,
    truncated,
    usage: totalUsage,
  };
}

/** Реэкспорт для удобства (не часть контракта loop). */
export type { ToolDef, ToolResult };