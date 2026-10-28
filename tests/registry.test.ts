import { describe, it, expect, beforeEach } from 'vitest';
import { registerTool, getTool, listTools, resetTools, type ToolDef } from '../src/tools/registry.js';

beforeEach(() => resetTools());

describe('tool registry', () => {
  it('register → get → list', () => {
    const def: ToolDef = {
      name: 'mail.connect',
      description: 'подключение к ящику',
      inputSchema: { type: 'object', properties: { login: { type: 'string' } }, required: ['login'] },
      handler: async () => ({ ok: true }),
    };
    registerTool(def);

    expect(getTool('mail.connect')).toBe(def);
    expect(listTools()).toHaveLength(1);
    expect(listTools()[0]?.name).toBe('mail.connect');
  });

  it('регистрация дубликата бросает', () => {
    registerTool({
      name: 'x',
      description: 'd',
      inputSchema: { type: 'object' },
      handler: async () => null,
    });
    expect(() =>
      registerTool({
        name: 'x',
        description: 'd2',
        inputSchema: { type: 'object' },
        handler: async () => null,
      }),
    ).toThrow(/уже зарегистрирован/);
  });

  it('getTool для несуществующего возвращает undefined', () => {
    expect(getTool('nope')).toBeUndefined();
  });
});