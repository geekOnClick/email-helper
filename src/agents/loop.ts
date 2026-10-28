/**
 * Переиспользуемый движок цикла tool-calling (Фаза 2, change orchestrator).
 *
 * Не зависит от роли/системного промпта: любой агент (оркестратор/анализатор/
 * помощник) крутит его со своим набором тулов и историей сообщений. Опирается на
 * готовый RouterAiClient (один шаг запрос→ответ) и доменные типы сообщений/тулов.
 */
import { getTool } from '../tools/registry.js';
import { serializeToolResult } from './result-serializer.js';
import type { RouterAiClient } from '../llm/routerai-client.js';
import type {
  AgentRole,
  ChatMessage,
  ToolCall,
  ToolChoice,
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

/**
 * Resolver по умолчанию: исполняет тулы через реестр агента.
 * Ошибки (исключение, неизвестный тул, невалидные args) НЕ прерывают цикл —
 * возвращаются как ToolResultMessage с описанием, чтобы модель отреагировала.
 */
export class RegistryToolResolver implements ToolResolver {
  private readonly extraTools: Map<string, ToolDef>;
  private readonly maxToolResultChars: number;

  constructor(maxToolResultChars: number, extraTools: ToolDef[] = []) {
    this.maxToolResultChars = maxToolResultChars;
    this.extraTools = new Map(extraTools.map((t) => [t.name, t]));
  }

  async resolve(toolCall: ToolCall): Promise<ToolResultMessage> {
    // Невалидные аргументы — модель отдаёт некорректный JSON для args.
    if (toolCall.args === null) {
      const reason = toolCall.parseError ?? 'пустые аргументы';
      return toolResultMessage(
        toolCall.id,
        `Невалидные аргументы тулa ${toolCall.name}: ${reason}`,
      );
    }

    // Сначала доп. тулы (delegate и пр.), затем реестр.
    const def = this.extraTools.get(toolCall.name) ?? getTool(toolCall.name);
    if (!def) {
      return toolResultMessage(toolCall.id, `Тул не найден: ${toolCall.name}`);
    }

    try {
      const result = await def.handler(toolCall.args as Record<string, unknown>);
      const content = serializeToolResult(result, this.maxToolResultChars);
      return toolResultMessage(toolCall.id, content);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return toolResultMessage(toolCall.id, `Ошибка тулa ${toolCall.name}: ${msg}`);
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
    opts.resolver ?? new RegistryToolResolver(opts.maxToolResultChars, opts.extraTools ?? []);
  const allToolCalls: ToolCall[] = [];
  let lastContent = '';
  let lastUsage: Usage | undefined;
  let truncated = false;

  for (let iteration = 0; iteration < opts.maxIterations; iteration++) {
    const result = await opts.client.chat({
      messages: opts.messages,
      tools: opts.tools,
      role: opts.role,
    });

    lastContent = result.content;
    lastUsage = result.usage;

    // Финал: модель ответила текстом без вызовов.
    if (result.toolCalls.length === 0) {
      return {
        content: result.content,
        toolCalls: allToolCalls,
        iterations: iteration + 1,
        truncated: false,
        usage: result.usage,
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
      const toolMsg = await resolver.resolve(toolCall);
      opts.messages.push(toolMsg);
    }

    // Если это была последняя разрешённая итерация — модель всё ещё зовёт тулы.
    if (iteration === opts.maxIterations - 1) {
      truncated = true;
      break;
    }
  }

  return {
    content: lastContent,
    toolCalls: allToolCalls,
    iterations: opts.maxIterations,
    truncated,
    usage: lastUsage,
  };
}

/** Реэкспорт для удобства (не часть контракта loop). */
export type { ToolDef, ToolResult };