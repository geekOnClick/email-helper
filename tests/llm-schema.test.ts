import { describe, it, expect } from 'vitest';
import { parseChatResponse, chatCompletionResponseSchema } from '../src/llm/schema.js';

describe('chatCompletionResponseSchema / parseChatResponse', () => {
  it('парсит ответ с текстом и без вызовов', () => {
    const raw = {
      id: 'chatcmpl-1',
      model: 'z-ai/glm-5.3-flash',
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: 'Готов.' },
          finish_reason: 'stop',
        },
      ],
      usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
    };
    const parsed = parseChatResponse(raw);
    expect(parsed.content).toBe('Готов.');
    expect(parsed.rawToolCalls).toEqual([]);
    expect(parsed.usage?.totalTokens).toBe(7);
    expect(parsed.model).toBe('z-ai/glm-5.3-flash');
  });

  it('парсит ответ с tool_calls (v1) и нормализует вызовы', () => {
    const raw = {
      choices: [
        {
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'call_1',
                type: 'function',
                function: {
                  name: 'mail_search',
                  arguments: '{"login":"a@yandex.com"}',
                },
              },
            ],
          },
        },
      ],
    };
    const parsed = parseChatResponse(raw);
    expect(parsed.rawToolCalls).toHaveLength(1);
    expect(parsed.rawToolCalls[0]?.name).toBe('mail_search');
    expect(parsed.rawToolCalls[0]?.arguments).toBe('{"login":"a@yandex.com"}');
    expect(parsed.rawToolCalls[0]?.id).toBe('call_1');
  });

  it('парсит legacy function_call и нормализует к одному вызову', () => {
    const raw = {
      choices: [
        {
          message: {
            role: 'assistant',
            content: '',
            function_call: { name: 'mail_search', arguments: '{}' },
          },
        },
      ],
    };
    const parsed = parseChatResponse(raw);
    expect(parsed.rawToolCalls).toHaveLength(1);
    expect(parsed.rawToolCalls[0]?.name).toBe('mail_search');
    // legacy id генерируется детерминированно от имени
    expect(parsed.rawToolCalls[0]?.id).toBe('legacy_mail_search');
  });

  it('допускает отсутствие content (null/undefined)', () => {
    const raw = { choices: [{ message: { role: 'assistant', content: null } }] };
    const parsed = parseChatResponse(raw);
    expect(parsed.content).toBe('');
  });

  it('отвергает ответ без choices', () => {
    const bad = chatCompletionResponseSchema.safeParse({ id: 'x', choices: [] });
    expect(bad.success).toBe(false);
  });

  it('отвергает ответ без message', () => {
    const bad = chatCompletionResponseSchema.safeParse({ choices: [{}] });
    expect(bad.success).toBe(false);
  });

  it('отвергает полностью пустой объект', () => {
    const bad = chatCompletionResponseSchema.safeParse({});
    expect(bad.success).toBe(false);
  });
});
