import { describe, it, expect } from 'vitest';
import { SessionStats } from '../src/observability/session-stats.js';
import type { OrchestratorResult } from '../src/agents/orchestrator.js';

function makeResult(overrides: Partial<OrchestratorResult> = {}): OrchestratorResult {
  return {
    content: 'ответ',
    toolCalls: [],
    iterations: 1,
    truncated: false,
    ...overrides,
  };
}

describe('SessionStats', () => {
  it('один прогон без usage — runs=1, токены недоступны', () => {
    const stats = new SessionStats();
    stats.recordRun(makeResult());
    const report = stats.getReport();
    expect(report.runs).toBe(1);
    expect(report.tokens.available).toBe(false);
    expect(report.tokens.total).toBe(0);
  });

  it('два прогона с usage — токены суммируются', () => {
    const stats = new SessionStats();
    stats.recordRun(
      makeResult({ usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 } }),
    );
    stats.recordRun(
      makeResult({ usage: { promptTokens: 200, completionTokens: 80, totalTokens: 280 } }),
    );
    const report = stats.getReport();
    expect(report.runs).toBe(2);
    expect(report.tokens.available).toBe(true);
    expect(report.tokens.prompt).toBe(300);
    expect(report.tokens.completion).toBe(130);
    expect(report.tokens.total).toBe(430);
  });

  it('прогон с usage и без usage — токены частично агрегируются, available=true', () => {
    const stats = new SessionStats();
    stats.recordRun(
      makeResult({ usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 } }),
    );
    stats.recordRun(makeResult()); // без usage
    const report = stats.getReport();
    expect(report.runs).toBe(2);
    expect(report.tokens.available).toBe(true);
    expect(report.tokens.total).toBe(150); // только первый прогон
  });

  it('recordToolLog: ok и error считаются раздельно', () => {
    const stats = new SessionStats();
    stats.recordToolLog('ok');
    stats.recordToolLog('ok');
    stats.recordToolLog('error');
    const report = stats.getReport();
    expect(report.toolCalls.ok).toBe(2);
    expect(report.toolCalls.error).toBe(1);
  });

  it('reset обнуляет статистику', () => {
    const stats = new SessionStats();
    stats.recordRun(
      makeResult({ usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 } }),
    );
    stats.recordToolLog('ok');
    stats.reset();
    const report = stats.getReport();
    expect(report.runs).toBe(0);
    expect(report.toolCalls.ok).toBe(0);
    expect(report.tokens.total).toBe(0);
    expect(report.tokens.available).toBe(false);
  });

  it('частичные usage-поля (только totalTokens)', () => {
    const stats = new SessionStats();
    stats.recordRun(makeResult({ usage: { totalTokens: 100 } }));
    const report = stats.getReport();
    expect(report.tokens.available).toBe(true);
    expect(report.tokens.total).toBe(100);
    expect(report.tokens.prompt).toBe(0);
    expect(report.tokens.completion).toBe(0);
  });

  it('getReport не мутирует состояние', () => {
    const stats = new SessionStats();
    stats.recordRun(
      makeResult({ usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 } }),
    );
    stats.getReport();
    stats.getReport();
    stats.recordRun(
      makeResult({ usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 } }),
    );
    const report = stats.getReport();
    expect(report.runs).toBe(2);
    expect(report.tokens.total).toBe(30);
  });
});
