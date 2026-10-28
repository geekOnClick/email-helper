import { describe, it, expect } from 'vitest';
import { toOpenAiToolName, fromOpenAiToolName, mapToolsToOpenAi } from '../src/llm/tool-mapping.js';
import type { ToolDef } from '../src/tools/registry.js';

describe('tool-mapping', () => {
  it('toOpenAiToolName: точка → подчёркивание', () => {
    expect(toOpenAiToolName('mail.search')).toBe('mail_search');
    expect(toOpenAiToolName('mail.downloadAttachments')).toBe('mail_downloadAttachments');
  });

  it('fromOpenAiToolName: подчёркивание → точка (round-trip)', () => {
    expect(fromOpenAiToolName('mail_search')).toBe('mail.search');
    // round-trip для составных имён
    expect(fromOpenAiToolName(toOpenAiToolName('mail.search'))).toBe('mail.search');
  });

  it('mapToolsToOpenAi: транслирует имя и сохраняет схему параметров', () => {
    const tool: ToolDef = {
      name: 'mail.search',
      description: 'Поиск писем',
      inputSchema: {
        type: 'object',
        properties: {
          login: { type: 'string' },
          criteria: { type: 'object', properties: { subject: { type: 'string' } } },
        },
        required: ['login', 'criteria'],
      },
      handler: async () => undefined,
    };

    const [mapped] = mapToolsToOpenAi([tool]);
    expect(mapped?.type).toBe('function');
    expect(mapped?.function.name).toBe('mail_search');
    expect(mapped?.function.description).toBe('Поиск писем');
    // параметры передаются as-is
    expect(mapped?.function.parameters.required).toEqual(['login', 'criteria']);
    expect(mapped?.function.parameters.type).toBe('object');
  });

  it('mapToolsToOpenAi: пустой массив → пустой массив', () => {
    expect(mapToolsToOpenAi([])).toEqual([]);
  });
});
