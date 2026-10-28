/**
 * Контракт субагентов и тул делегирования (Фаза 2, change orchestrator).
 *
 * Sotom agents (analyzer/helper) подключаются в SubagentRegistry оркестратора
 * в своих change'ах. Здесь — только интерфейс + реестр + тул `delegate`.
 * Глубина делегирования = 1: тул delegate доступен только оркестратору
 * (субагенты не получают его в свой набор тулов).
 */
import type { ToolDef } from '../tools/registry.js';

/** Субагент — именованная роль с описанием и исполнителем запроса. */
export interface Subagent {
  /** Доменное имя, напр. 'analyzer'. */
  name: string;
  /** Описание для тул-def (помогает модели выбрать субагента). */
  description: string;
  /** Исполняет инструкцию, возвращает текстовый ответ. */
  run: (input: string) => Promise<string>;
}

/** Аргументы тулa delegate. */
export interface DelegateArgs {
  /** Имя субагента. */
  subagent: string;
  /** Инструкция для субагента. */
  instruction: string;
}

/**
 * Реестр субагентов: регистрация, получение, список.
 * Пустой по умолчанию (субагенты подключаются в своих change'ах).
 */
export class SubagentRegistry {
  private readonly agents = new Map<string, Subagent>();

  register(agent: Subagent): void {
    if (this.agents.has(agent.name)) {
      throw new Error(`субагент уже зарегистрирован: ${agent.name}`);
    }
    this.agents.set(agent.name, agent);
  }

  get(name: string): Subagent | undefined {
    return this.agents.get(name);
  }

  list(): Subagent[] {
    return Array.from(this.agents.values());
  }

  /** Непуст ли реестр (оркестратор добавляет delegate только при наличии субагентов). */
  hasAny(): boolean {
    return this.agents.size > 0;
  }
}

/**
 * Создаёт тул delegate: делегирует подзадачу зарегистрированному субагенту.
 * Неизвестный субагент не роняет цикл — возвращает строку-ошибку.
 */
export function createDelegateTool(registry: SubagentRegistry): ToolDef<DelegateArgs> {
  return {
    name: 'delegate',
    description:
      'Делегировать подзадачу субагенту по имени. Используй, когда задача требует специализированной роли (анализ писем, рутинные операции).',
    inputSchema: {
      type: 'object',
      properties: {
        subagent: {
          type: 'string',
          description: 'Имя субагента (напр. analyzer, helper).',
        },
        instruction: {
          type: 'string',
          description: 'Инструкция подзадачи для субагента.',
        },
      },
      required: ['subagent', 'instruction'],
    },
    handler: async (args): Promise<string> => {
      const name = args.subagent;
      const agent = registry.get(name);
      if (!agent) {
        return `Субагент не найден: ${name}`;
      }
      try {
        return await agent.run(args.instruction);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return `Ошибка субагента ${name}: ${msg}`;
      }
    },
  };
}