/**
 * Чистые доменные функции команды /smart-send (change web-interface, design D1).
 *
 * Выделены из `src/transport/cli/commands/smart-send.ts`. Разделены на генерацию
 * тела и отправку подтверждённого тела — для подтверждения перед отправкой в
 * обоих транспортах (CLI — цикл правки, веб — форма с кнопкой «Отправить»).
 * Не зависят от ConsoleIO.
 */
import type { ToolDef } from '../../tools/registry.js';
import type { RouterAiClient } from '../../llm/routerai-client.js';
import type { ChatMessage } from '../../llm/types.js';

/** DTO генерации тела письма. */
export interface GenerateSendBodyDeps {
  /** LLM-клиент (роль helper). */
  llmClient: RouterAiClient;
  /** Тема письма (фиксирована, не меняется при правке). */
  subject: string;
  /** Получатель (фиксирован). */
  to: string;
  /** Произвольный промпт для генерации тела. */
  prompt: string;
  /** Текущее тело (для режима правки по обратной связи). */
  currentBody?: string;
  /** Обратная связь для правки (только при currentBody). */
  feedback?: string;
}

/** DTO отправки подтверждённого письма. */
export interface SendEmailDeps {
  /** Логин аккаунта-отправителя. */
  accountLogin: string;
  /** Тул `mail.send`. */
  sendTool: ToolDef;
  /** Получатель (email). */
  to: string;
  /** Тема письма. */
  subject: string;
  /** Подтверждённое тело письма (plain text). */
  body: string;
}

/** Результат отправки. */
export interface SendEmailResult {
  /** Успешна ли отправка. */
  sent: boolean;
  /** Сообщение об ошибке (при неудаче). */
  error?: string;
}

/**
 * Генерирует тело письма (plain text) одним вызовом LLM (роль helper).
 *
 * - Первичная генерация: по теме + промпту.
 * - Правка: по теме + промпту + текущему телу + обратной связи (тема/получатель
 *   фиксированы, модель правит только тело).
 *
 * @throws Error при ошибке LLM.
 */
export async function generateSmartSendBody(deps: GenerateSendBodyDeps): Promise<string> {
  const { llmClient, subject, to, prompt, currentBody, feedback } = deps;

  const systemParts: string[] = [
    'Ты — помощник, составляющий тело email-письма на русском языке (plain text, без HTML).',
    `Тема письма (не меняй): ${subject}.`,
    `Получатель (не меняй): ${to}.`,
    'Верни ТОЛЬКО тело письма (без темы, без «Кому», без пояснений).',
  ];

  const userParts: string[] = [];
  if (currentBody && feedback) {
    userParts.push(`Исходный промпт письма: ${prompt}`);
    userParts.push(`Текущее тело письма:\n${currentBody}`);
    userParts.push(`Переделай тело по обратной связи (тему и получателя не меняй): ${feedback}`);
  } else {
    userParts.push(`Составь тело письма по инструкции: ${prompt}`);
  }

  const messages: ChatMessage[] = [
    { role: 'system', content: systemParts.join('\n') },
    { role: 'user', content: userParts.join('\n\n') },
  ];

  const result = await llmClient.chat({ messages, role: 'helper' });
  return result.content.trim();
}

/**
 * Отправляет подтверждённое письмо через `mail.send` с `confirm: true`.
 * Не падает при ошибке отправки — возвращает `{ sent: false, error }`.
 */
export async function sendSmartSend(deps: SendEmailDeps): Promise<SendEmailResult> {
  const { accountLogin, sendTool, to, subject, body } = deps;
  try {
    await sendTool.handler({
      login: accountLogin,
      mail: {
        to: [{ address: to }],
        subject,
        text: body,
      },
      confirm: true,
    });
    return { sent: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { sent: false, error: msg };
  }
}
