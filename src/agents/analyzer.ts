/**
 * Субагент-анализатор писем (Фаза 2, change analyzer-agent).
 *
 * Реализует контракт `Subagent` (`{ name: 'analyzer', description, run(input) }`)
 * через собственный цикл `runToolLoop` с ролью `'analyzer'`, своим скилом
 * `skills/analyzer.md` и ограниченным набором тулов реестра (только чтение
 * содержимого писем). Тул `delegate` НЕ входит в набор — глубина делегирования
 * равна 1 (см. archive/2026-10-28-orchestrator/design.md D10).
 *
 * Stateless: каждый `run(input)` независим; контекст диалога держит оркестратор.
 */
import { listTools } from '../tools/registry.js';
import type { ToolDef } from '../tools/registry.js';
import { mapToolsToOpenAi } from '../llm/tool-mapping.js';
import { runToolLoop } from './loop.js';
import { loadSkill } from './skill-loader.js';
import { noopToolLogger, type ToolLogger } from '../observability/logger.js';
import type { Subagent } from './subagent.js';
import type { RouterAiClient } from '../llm/routerai-client.js';
import type { Config } from '../config/schema.js';
import type { ChatMessage } from '../llm/types.js';

/** Тулы реестра, доступные анализатору (только чтение содержимого писем). */
const ANALYZER_TOOLS: readonly string[] = ['mail.fetch'];

/** Опции конструирования анализатора. */
export interface AnalyzerOptions {
  /** LLM-клиент. */
  client: RouterAiClient;
  /** Конфиг (источник лимитов по умолчанию). */
  config: Config;
  /** Переопределение лимита итераций (иначе config.AGENT_MAX_ITERATIONS). */
  maxIterations?: number;
  /** Переопределение лимита символов результата тулa. */
  maxToolResultChars?: number;
  /** Явный системный промпт (иначе грузится skills/analyzer.md). */
  skill?: string;
  /** Логгер вызовов тулов (опц., аудит). По умолчанию no-op. */
  toolLogger?: ToolLogger;
}

/**
 * Анализатор писем: Subagent-реализация роли 'analyzer'.
 * Крутит runToolLoop с ограниченным набором тулов (без delegate).
 */
class Analyzer implements Subagent {
  readonly name = 'analyzer';
  readonly description =
    'Глубокий анализ писем: саммари одного/нескольких писем, извлечение сущностей, классификация тематики.';

  private readonly client: RouterAiClient;
  private readonly skill: string;
  private readonly maxIterations: number;
  private readonly maxToolResultChars: number;
  private readonly openAiTools: ReturnType<typeof mapToolsToOpenAi>;
  private readonly toolLogger: ToolLogger;

  private constructor(opts: AnalyzerOptions, skill: string) {
    this.client = opts.client;
    this.skill = skill;
    this.maxIterations = opts.maxIterations ?? opts.config.AGENT_MAX_ITERATIONS;
    this.maxToolResultChars =
      opts.maxToolResultChars ?? opts.config.AGENT_MAX_TOOL_RESULT_CHARS;
    this.toolLogger = opts.toolLogger ?? noopToolLogger();

    // Ограниченный набор тулов: только чтение содержимого писем. delegate НЕ входит.
    const domainTools: ToolDef[] = listTools().filter((t) =>
      ANALYZER_TOOLS.includes(t.name),
    );
    this.openAiTools = mapToolsToOpenAi(domainTools);
  }

  /** Асинхронная фабрика: грузит скил, если не передан явно. */
  static async create(opts: AnalyzerOptions): Promise<Analyzer> {
    const skill = opts.skill ?? (await loadSkill('analyzer'));
    return new Analyzer(opts, skill);
  }

  /** Исполняет инструкцию оркестратора и возвращает текстовый анализ. */
  async run(input: string): Promise<string> {
    const messages: ChatMessage[] = [
      { role: 'system', content: this.skill },
      { role: 'user', content: input },
    ];

    const result = await runToolLoop({
      client: this.client,
      messages,
      tools: this.openAiTools,
      maxIterations: this.maxIterations,
      maxToolResultChars: this.maxToolResultChars,
      role: 'analyzer',
      toolLogger: this.toolLogger,
      // extraTools НЕ передаём — delegate недоступен (глубина делегирования = 1).
    });

    return result.content;
  }

  /** Набор тулов, передаваемых модели (для инспекции/тестов). */
  getOpenAiTools(): ReturnType<typeof mapToolsToOpenAi> {
    return this.openAiTools;
  }
}

/**
 * Создаёт субагента-анализатора и возвращает его как `Subagent` для передачи
 * в `OrchestratorOptions.subagents`. Грузит скил `skills/analyzer.md`, если он
 * не передан явно в opts.skill.
 */
export async function createAnalyzer(opts: AnalyzerOptions): Promise<Subagent> {
  return Analyzer.create(opts);
}