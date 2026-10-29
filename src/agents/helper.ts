/**
 * Субагент-помощник (Фаза 2, change helper-agent).
 *
 * Реализует контракт `Subagent` (`{ name: 'helper', description, run(input) }`)
 * через собственный цикл `runToolLoop` с ролью `'helper'`, своим скилом
 * `skills/helper.md` и набором рутинных тулов реестра (подключение, поиск,
 * чтение, скачивание). Тул `delegate` НЕ входит в набор — глубина
 * делегирования равна 1 (см. archive/2026-10-28-orchestrator/design.md D10).
 *
 * Stateless: каждый `run(input)` независим; контекст диалога держит оркестратор.
 * Симметричен анализатору по структуре (archive/2026-10-28-analyzer-agent).
 */
import { listTools } from '../tools/registry.js';
import type { ToolDef } from '../tools/registry.js';
import { mapToolsToOpenAi } from '../llm/tool-mapping.js';
import { runToolLoop } from './loop.js';
import { loadSkill } from './skill-loader.js';
import type { Subagent } from './subagent.js';
import type { RouterAiClient } from '../llm/routerai-client.js';
import type { Config } from '../config/schema.js';
import type { ChatMessage } from '../llm/types.js';

/** Тулы реестра, доступные помощнику (рутина Фаз 1–4). */
const HELPER_TOOLS: readonly string[] = [
  'mail.connect',
  'mail.listFolders',
  'mail.search',
  'mail.fetch',
  'mail.downloadAttachments',
  'mail.send',
  'embeddings.index',
  'vector.search',
];

/** Опции конструирования помощника. */
export interface HelperOptions {
  /** LLM-клиент. */
  client: RouterAiClient;
  /** Конфиг (источник лимитов по умолчанию). */
  config: Config;
  /** Переопределение лимита итераций (иначе config.AGENT_MAX_ITERATIONS). */
  maxIterations?: number;
  /** Переопределение лимита символов результата тулa. */
  maxToolResultChars?: number;
  /** Явный системный промпт (иначе грузится skills/helper.md). */
  skill?: string;
}

/**
 * Помощник: Subagent-реализация роли 'helper'.
 * Крутит runToolLoop с набором рутинных тулов (без delegate).
 */
class Helper implements Subagent {
  readonly name = 'helper';
  readonly description =
    'Рутина с почтой: подключение, поиск, чтение, скачивание вложений. Без анализа содержимого.';

  private readonly client: RouterAiClient;
  private readonly skill: string;
  private readonly maxIterations: number;
  private readonly maxToolResultChars: number;
  private readonly openAiTools: ReturnType<typeof mapToolsToOpenAi>;

  private constructor(opts: HelperOptions, skill: string) {
    this.client = opts.client;
    this.skill = skill;
    this.maxIterations = opts.maxIterations ?? opts.config.AGENT_MAX_ITERATIONS;
    this.maxToolResultChars =
      opts.maxToolResultChars ?? opts.config.AGENT_MAX_TOOL_RESULT_CHARS;

    // Рутинные тулы; delegate НЕ входит (глубина делегирования = 1).
    const domainTools: ToolDef[] = listTools().filter((t) =>
      HELPER_TOOLS.includes(t.name),
    );
    this.openAiTools = mapToolsToOpenAi(domainTools);
  }

  /** Асинхронная фабрика: грузит скил, если не передан явно. */
  static async create(opts: HelperOptions): Promise<Helper> {
    const skill = opts.skill ?? (await loadSkill('helper'));
    return new Helper(opts, skill);
  }

  /** Исполняет инструкцию оркестратора и возвращает текстовый результат. */
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
      role: 'helper',
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
 * Создаёт субагента-помощника и возвращает его как `Subagent` для передачи
 * в `OrchestratorOptions.subagents`. Грузит скил `skills/helper.md`, если он
 * не передан явно в opts.skill.
 */
export async function createHelper(opts: HelperOptions): Promise<Subagent> {
  return Helper.create(opts);
}