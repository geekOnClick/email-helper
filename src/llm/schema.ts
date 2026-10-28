import { z } from 'zod';

/**
 * Zod-схемы ответа OpenAI Chat Completions v1.
 * Принимают оба варианта function calling: современный `tool_calls`
 * и legacy `function_call`, нормализуя к единственному `ToolCall[]`.
 */

const toolCallV1Schema = z.object({
  id: z.string(),
  type: z.literal('function'),
  function: z.object({
    name: z.string(),
    arguments: z.string(),
  }),
});

const functionCallLegacySchema = z.object({
  name: z.string(),
  arguments: z.string(),
});

const messageSchema = z.object({
  role: z.string(),
  content: z.string().nullable().optional(),
  tool_calls: z.array(toolCallV1Schema).optional(),
  function_call: functionCallLegacySchema.optional(),
});

const choiceSchema = z.object({
  index: z.number().optional(),
  message: messageSchema,
  finish_reason: z.string().nullable().optional(),
});

const usageSchema = z
  .object({
    prompt_tokens: z.number().optional(),
    completion_tokens: z.number().optional(),
    total_tokens: z.number().optional(),
  })
  .optional();

/**
 * Сырой ответ API (до нормализации). `choices` помечен мин. длиной 1,
 * чтобы отсечь пустой массив (спека: «пустой choices → ошибка»).
 */
export const chatCompletionResponseSchema = z.object({
  id: z.string().optional(),
  model: z.string().optional(),
  choices: z.array(choiceSchema).min(1),
  usage: usageSchema,
});

export type ChatCompletionResponse = z.infer<typeof chatCompletionResponseSchema>;

/**
 * Распарсенный и нормализованный ответ — единый вид для клиента.
 * `toolCalls` всегда массив (пустой, если модель ответила текстом).
 */
export interface ParsedChatResponse {
  content: string;
  rawToolCalls: Array<{
    id: string;
    name: string;
    arguments: string;
  }>;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
  model?: string;
}

/**
 * Валидирует сырой объект ответа и нормализует к `ParsedChatResponse`.
 * Бросает z.ZodError при malformed-структуре; клиент оборачивает в RouterAiError.
 */
export function parseChatResponse(raw: unknown): ParsedChatResponse {
  const parsed = chatCompletionResponseSchema.parse(raw);
  const choice = parsed.choices[0];
  if (!choice) {
    // Не должно случиться из-за min(1), но для noUncheckedIndexedAccess — защита.
    throw new z.ZodError([
      {
        code: 'custom',
        message: 'choices пуст',
        path: ['choices'],
      },
    ]);
  }

  const message = choice.message;
  const content = message.content ?? '';

  const rawToolCalls: ParsedChatResponse['rawToolCalls'] = [];

  // Современный формат: tool_calls[]
  if (message.tool_calls) {
    for (const tc of message.tool_calls) {
      rawToolCalls.push({
        id: tc.id,
        name: tc.function.name,
        arguments: tc.function.arguments,
      });
    }
  }

  // Legacy формат: function_call (одиночный) — нормализуем к одному вызову.
  if (message.function_call) {
    rawToolCalls.push({
      // У legacy function_call нет id; генерируем стабильный, чтобы оркестратор
      // мог сопоставить role:"tool" ответ.
      id: `legacy_${message.function_call.name}`,
      name: message.function_call.name,
      arguments: message.function_call.arguments,
    });
  }

  const usage = parsed.usage
    ? {
        promptTokens: parsed.usage.prompt_tokens,
        completionTokens: parsed.usage.completion_tokens,
        totalTokens: parsed.usage.total_tokens,
      }
    : undefined;

  return {
    content,
    rawToolCalls,
    usage,
    model: parsed.model,
  };
}
