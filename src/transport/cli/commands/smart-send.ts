/**
 * Команда /smart-send: генерация тела письма по промпту и отправка с циклом
 * правки (change cli-smart-commands, design D4).
 *
 * Поток: мастер (тема, получатель, промпт) → выбор аккаунта → подключение →
 * one-shot вызов LLM-клиента (роль `helper`) генерирует тело (plain text) по
 * теме + промпту → показ черновика (`formatDraft`) → `promptSendAction`:
 * - `send` → `mail.send` с `confirm: true` → успех;
 * - `cancel` → отмена без отправки;
 * - `redo` → регенерация ТОЛЬКО тела по обратной связи (тема/получатель
 *   фиксированы) → новый черновик → повтор цикла.
 *
 * Без явного потолка итераций правки (до подтверждения/отмены). Тело — plain
 * text. Тулы `mail.send` и спека `mail/send` НЕ меняются.
 */
import type { ConsoleIO } from '../io.js';
import { promptSmartSendCriteria, promptAccount, promptSendAction } from '../prompts.js';
import { ensureMailConnected } from './connect.js';
import { formatDraft } from '../format.js';
import { getTool } from '../../../tools/registry.js';
import type { MailAccount } from '../../../tools/mail/types.js';
import type { RouterAiClient } from '../../../llm/routerai-client.js';
import type { ChatMessage } from '../../../llm/types.js';

/** Зависимости команды /smart-send. */
export interface SmartSendCommandDeps {
  /** Ввод/вывод. */
  io: ConsoleIO;
  /** Настроенные аккаунты. */
  accounts: MailAccount[];
  /** LLM-клиент для one-shot генерации тела (роль helper). */
  llmClient: RouterAiClient;
}

/** Выполняет команду /smart-send. */
export async function runSmartSendCommand(deps: SmartSendCommandDeps): Promise<void> {
  const { io, accounts, llmClient } = deps;

  const input = await promptSmartSendCriteria(io);
  if (!input) {
    io.write('Отправка отменена (не все обязательные поля указаны).\n');
    return;
  }

  const account = await promptAccount(io, accounts);
  if (!account) return;

  if (!(await ensureMailConnected(io, account))) return;

  const sendTool = getTool('mail.send');
  if (!sendTool) {
    io.write('Тул mail.send не зарегистрирован.\n');
    return;
  }

  // Цикл генерации тела → предпросмотр → действие (отправить/отмена/правка).
  let currentBody: string | null = null;
  let lastFeedback: string | undefined;
  while (true) {
    // Генерация тела (one-shot, роль helper).
    let body: string;
    try {
      body = await generateBody(llmClient, input.subject, input.to, input.prompt, currentBody, lastFeedback);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      io.write(`Ошибка генерации тела: ${msg}\n`);
      return;
    }

    // Предпросмотр черновика.
    const draft = {
      from: account.login,
      to: input.to,
      subject: input.subject,
      text: body,
    };
    io.write(formatDraft(draft, io.isTTY()) + '\n');

    // Запрос действия.
    const action = await promptSendAction(io);
    if (action.action === 'send') {
      try {
        await sendTool.handler({
          login: account.login,
          mail: {
            to: [{ address: input.to }],
            subject: input.subject,
            text: body,
          },
          confirm: true,
        });
        io.write('Письмо отправлено.\n');
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        io.write(`Ошибка отправки: ${msg}\n`);
      }
      return;
    }
    if (action.action === 'cancel') {
      io.write('Отправка отменена.\n');
      return;
    }
    // redo → регенерация тела по обратной связи (тема/получатель фиксированы).
    currentBody = body;
    lastFeedback = action.feedback;
    io.write('Перегенерирую тело письма...\n');
  }
}

/**
 * Генерирует тело письма (plain text) одним вызовом LLM-клиента (роль helper).
 *
 * - Первичная генерация: по теме + промпту.
 * - Правка: по теме + исходному промпту + текущему телу + обратной связи.
 * Тема и получатель всегда в контексте (фиксированы), модель правит только тело.
 */
async function generateBody(
  client: RouterAiClient,
  subject: string,
  to: string,
  prompt: string,
  currentBody: string | null,
  feedback?: string,
): Promise<string> {
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

  const result = await client.chat({ messages, role: 'helper' });
  return result.content.trim();
}
