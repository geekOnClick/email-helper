/**
 * Оркестратор агента (Фаза 2, change orchestrator).
 *
 * Фасад над циклом tool-calling для роли 'orchestrator': грузит системный промпт
 * из skills/orchestrator.md, строит набор тулов из реестра (+ delegate при
 * наличии субагентов), держит контекст диалога между репликами пользователя.
 */
import { listTools } from '../tools/registry.js';
import type { ToolDef } from '../tools/registry.js';
import { mapToolsToOpenAi } from '../llm/tool-mapping.js';
import { runToolLoop } from './loop.js';
import { loadSkill } from './skill-loader.js';
import { noopToolLogger, type ToolLogger } from '../observability/logger.js';
import {
  SubagentRegistry,
  createDelegateTool,
  type Subagent,
} from './subagent.js';
import type { RouterAiClient } from '../llm/routerai-client.js';
import type { Config } from '../config/schema.js';
import type {
  ChatMessage,
  ToolCall,
  ToolProgressEvent,
  Usage,
} from '../llm/types.js';

/** Опции конструирования оркестратора. */
export interface OrchestratorOptions {
  /** LLM-клиент. */
  client: RouterAiClient;
  /** Конфиг (источник лимитов по умолчанию). */
  config: Config;
  /** Субагенты (анализатор/помощник); пусто → тулa delegate нет. */
  subagents?: Subagent[];
  /** Переопределение лимита итераций (иначе config.AGENT_MAX_ITERATIONS). */
  maxIterations?: number;
  /** Переопределение лимита символов результата тулa. */
  maxToolResultChars?: number;
  /** Явный системный промпт (иначе грузится skills/orchestrator.md). */
  skill?: string;
  /** Логгер вызовов тулов (опц., аудит). По умолчанию no-op. */
  toolLogger?: ToolLogger;
}

/** Результат прогона реплики пользователя через оркестратор. */
export interface OrchestratorResult {
  /** Итоговый текстовый ответ ассистента. */
  content: string;
  /** Все вызовы тулов по всем итерациям. */
  toolCalls: ToolCall[];
  /** Число итераций цикла. */
  iterations: number;
  /** Усечён ли ответ по лимиту итераций. */
  truncated: boolean;
  /** Использование токенов последней итерации (если вернулось). */
  usage?: Usage;
}

/**
 * Оркестратор: роль 'orchestrator', контекст диалога, набор тулов из реестра.
 */
export class Orchestrator {
  private readonly client: RouterAiClient;
  private readonly maxIterations: number;
  private readonly maxToolResultChars: number;
  private readonly messages: ChatMessage[];
  private readonly systemPrompt: string;
  private readonly openAiTools: ReturnType<typeof mapToolsToOpenAi>;
  private readonly subagentRegistry: SubagentRegistry;
  private readonly delegateTool: ToolDef | null;
  private readonly toolLogger: ToolLogger;

  private constructor(opts: OrchestratorOptions, systemPrompt: string) {
    this.client = opts.client;
    this.maxIterations = opts.maxIterations ?? opts.config.AGENT_MAX_ITERATIONS;
    this.maxToolResultChars =
      opts.maxToolResultChars ?? opts.config.AGENT_MAX_TOOL_RESULT_CHARS;
    this.toolLogger = opts.toolLogger ?? noopToolLogger();

    // Субагенты → реестр; тул delegate добавляется только при наличии.
    this.subagentRegistry = new SubagentRegistry();
    for (const a of opts.subagents ?? []) {
      this.subagentRegistry.register(a);
    }

    // Набор тулов: реестр + (опц.) delegate, сквозной mapToolsToOpenAi.
    const domainTools: ToolDef[] = listTools();
    this.delegateTool = this.subagentRegistry.hasAny()
      ? (createDelegateTool(this.subagentRegistry) as unknown as ToolDef)
      : null;
    if (this.delegateTool) domainTools.push(this.delegateTool);
    this.openAiTools = mapToolsToOpenAi(domainTools);

    this.systemPrompt = systemPrompt;
    this.messages = [{ role: 'system', content: systemPrompt }];
  }

  /** Асинхронная фабрика: грузит скил, если не передан явно. */
  static async create(opts: OrchestratorOptions): Promise<Orchestrator> {
    const systemPrompt = opts.skill ?? (await loadSkill('orchestrator'));
    return new Orchestrator(opts, systemPrompt);
  }

  /** Прогоняет реплику пользователя через цикл tool-calling. */
  async run(
    userText: string,
    opts?: { onToolEvent?: (event: ToolProgressEvent) => void },
  ): Promise<OrchestratorResult> {
    this.messages.push({ role: 'user', content: userText });

    const loopResult = await runToolLoop({
      client: this.client,
      messages: this.messages,
      tools: this.openAiTools,
      maxIterations: this.maxIterations,
      maxToolResultChars: this.maxToolResultChars,
      role: 'orchestrator',
      extraTools: this.delegateTool ? [this.delegateTool] : [],
      onToolEvent: opts?.onToolEvent,
      toolLogger: this.toolLogger,
    });

    // Дополняем историю финальным assistant-ответом (без tool_calls).
    this.messages.push({ role: 'assistant', content: loopResult.content });

    return {
      content: loopResult.content,
      toolCalls: loopResult.toolCalls,
      iterations: loopResult.iterations,
      truncated: loopResult.truncated,
      usage: loopResult.usage,
    };
  }

  /** Текущая история диалога (для инспекции/тестов). */
  getHistory(): ChatMessage[] {
    return this.messages;
  }

  /** Набор тулов, передаваемых модели (для инспекции/тестов). */
  getOpenAiTools(): ReturnType<typeof mapToolsToOpenAi> {
    return this.openAiTools;
  }

  /**
   * Сбрасывает историю диалога до системного промпта (тулы/субагенты остаются).
   * Для транспорта: /reset обнуляет контекст без пересборки агента.
   */
  resetHistory(): void {
    this.messages.length = 0;
    this.messages.push({ role: 'system', content: this.systemPrompt });
  }
}