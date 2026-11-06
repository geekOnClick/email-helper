/**
 * Команда /smart-send: генерация тела письма по промпту и отправка с циклом
 * правки (change cli-smart-commands, design D4).
 *
 * Тонкий CLI-адаптер (change web-interface, design D1): собирает поля, вызывает
 * чистые функции `generateSmartSendBody` и `sendSmartSend` (из transport/
 * commands), рендерит черновик и запрашивает действие. Цикл правки (тема/
 * получатель фиксированы) сохранён. Доменная логика переиспользуется вебом.
 */
import type { ConsoleIO } from '../io.js';
import { promptSmartSendCriteria, promptAccount, promptSendAction } from '../prompts.js';
import { ensureMailConnected } from './connect.js';
import { formatDraft } from '../format.js';
import { getTool } from '../../../tools/registry.js';
import { generateSmartSendBody, sendSmartSend } from '../../commands/smart-send.js';
import type { MailAccount } from '../../../tools/mail/types.js';
import type { RouterAiClient } from '../../../llm/routerai-client.js';

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
    // Генерация тела через чистую функцию (переиспользуется вебом).
    let body: string;
    try {
      body = await generateSmartSendBody({
        llmClient,
        subject: input.subject,
        to: input.to,
        prompt: input.prompt,
        ...(currentBody !== null ? { currentBody } : {}),
        ...(lastFeedback !== undefined ? { feedback: lastFeedback } : {}),
      });
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
      const result = await sendSmartSend({
        accountLogin: account.login,
        sendTool,
        to: input.to,
        subject: input.subject,
        body,
      });
      if (result.sent) {
        io.write('Письмо отправлено.\n');
      } else {
        io.write(`Ошибка отправки: ${result.error ?? 'неизвестная ошибка'}\n`);
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
