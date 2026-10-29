/**
 * Агрегатор статистики сессии агента (Фаза 8, change observability).
 *
 * Транспорт (CLI REPL) аккумулирует прогоны оркестратора: число реплик,
 * вызовы тулов (ok/error), суммарные токены LLM. Отчёт доступен по запросу
 * (/stats) и при завершении сессии.
 *
 * Живёт в транспорте, а не в оркестраторе: оркестратор — доменный слой
 * (история диалога), статистика сессии — транспортная ответственность.
 */
import type { OrchestratorResult } from '../agents/orchestrator.js';

/** Разбивка вызовов тулов по статусу. */
export interface ToolCallCounts {
  /** Успешные вызовы. */
  ok: number;
  /** Ошибочные вызовы. */
  error: number;
}

/** Разбивка токенов LLM по типам. */
export interface TokenCounts {
  /** Токены промпта (вход). */
  prompt: number;
  /** Токены генерации (выход). */
  completion: number;
  /** Всего токенов. */
  total: number;
  /** Доступны ли данные о токенах (false — провайдер не вернул ни в одном прогоне). */
  available: boolean;
}

/** Сводный отчёт по сессии. */
export interface SessionReport {
  /** Число выполненных прогонов (реплик пользователя). */
  runs: number;
  /** Вызовы тулов по статусу. */
  toolCalls: ToolCallCounts;
  /** Суммарные токены LLM по всем прогонам. */
  tokens: TokenCounts;
}

/**
 * Аккумулятор статистики сессии агента.
 *
 * Stateless относительно оркестратора: вызывается транспортом после каждого
 * `orchestrator.run`. Не мутирует результат прогона.
 */
export class SessionStats {
  private runs = 0;
  private toolCallsOk = 0;
  private toolCallsError = 0;
  private promptTokens = 0;
  private completionTokens = 0;
  private totalTokens = 0;
  private tokensAvailable = false;

  /** Записывает результат прогона в агрегаты (runs + токены). */
  recordRun(result: OrchestratorResult): void {
    this.runs += 1;
    // Разбивка тулов ok/error — через recordToolLog из логгера.
    // Здесь — только токены и счётчик прогонов.
    if (result.usage) {
      this.promptTokens += result.usage.promptTokens ?? 0;
      this.completionTokens += result.usage.completionTokens ?? 0;
      this.totalTokens += result.usage.totalTokens ?? 0;
      if (
        result.usage.promptTokens !== undefined ||
        result.usage.completionTokens !== undefined ||
        result.usage.totalTokens !== undefined
      ) {
        this.tokensAvailable = true;
      }
    }
  }

  /**
   * Записывает событие лога тулa для разбивки ok/error.
   * Вызывается транспортом из toolLogger, если логгер — собирающий.
   */
  recordToolLog(status: 'ok' | 'error'): void {
    if (status === 'ok') {
      this.toolCallsOk += 1;
    } else {
      this.toolCallsError += 1;
    }
  }

  /** Возвращает сводный отчёт на текущий момент. */
  getReport(): SessionReport {
    return {
      runs: this.runs,
      toolCalls: { ok: this.toolCallsOk, error: this.toolCallsError },
      tokens: {
        prompt: this.promptTokens,
        completion: this.completionTokens,
        total: this.totalTokens,
        available: this.tokensAvailable,
      },
    };
  }

  /** Сбрасывает статистику (для /reset или тестов). */
  reset(): void {
    this.runs = 0;
    this.toolCallsOk = 0;
    this.toolCallsError = 0;
    this.promptTokens = 0;
    this.completionTokens = 0;
    this.totalTokens = 0;
    this.tokensAvailable = false;
  }
}
