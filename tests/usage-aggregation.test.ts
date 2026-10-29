import { describe, it, expect } from 'vitest';
import { addUsage, type Usage } from '../src/llm/types.js';

describe('addUsage — агрегация токенов по итерациям', () => {
  it('суммирует токены двух итераций', () => {
    const a: Usage = { promptTokens: 100, completionTokens: 50, totalTokens: 150 };
    const b: Usage = { promptTokens: 200, completionTokens: 80, totalTokens: 280 };
    expect(addUsage(a, b)).toEqual({
      promptTokens: 300,
      completionTokens: 130,
      totalTokens: 430,
    });
  });

  it('аккумулятор undefined + next → next', () => {
    const next: Usage = { promptTokens: 10, completionTokens: 5, totalTokens: 15 };
    expect(addUsage(undefined, next)).toEqual(next);
  });

  it('аккумулятор + next undefined → аккумулятор', () => {
    const acc: Usage = { promptTokens: 10, completionTokens: 5, totalTokens: 15 };
    expect(addUsage(acc, undefined)).toEqual(acc);
  });

  it('обе undefined → undefined', () => {
    expect(addUsage(undefined, undefined)).toBeUndefined();
  });

  it('next без usage (провайдер не вернул) → аккумулятор без изменений', () => {
    const acc: Usage = { promptTokens: 100, completionTokens: 50, totalTokens: 150 };
    expect(addUsage(acc, undefined)).toEqual(acc);
  });

  it('частичные поля: только promptTokens в next', () => {
    const acc: Usage = { promptTokens: 100, completionTokens: 50, totalTokens: 150 };
    const next: Usage = { promptTokens: 200 };
    expect(addUsage(acc, next)).toEqual({
      promptTokens: 300,
      completionTokens: 50,
      totalTokens: 150,
    });
  });

  it('несколько итераций подряд (fold)', () => {
    const iters: Usage[] = [
      { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
      { promptTokens: 200, completionTokens: 80, totalTokens: 280 },
      { promptTokens: 50, completionTokens: 20, totalTokens: 70 },
    ];
    const total = iters.reduce(addUsage, undefined as Usage | undefined);
    expect(total).toEqual({
      promptTokens: 350,
      completionTokens: 150,
      totalTokens: 500,
    });
  });

  it('смесь: одна итерация без usage не теряет агрегат', () => {
    const iters: (Usage | undefined)[] = [
      { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
      undefined,
      { promptTokens: 50, completionTokens: 20, totalTokens: 70 },
    ];
    const total = iters.reduce(addUsage, undefined as Usage | undefined);
    expect(total).toEqual({
      promptTokens: 150,
      completionTokens: 70,
      totalTokens: 220,
    });
  });
});
