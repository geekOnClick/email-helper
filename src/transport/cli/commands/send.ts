/**
 * Команда /send: отправка письма с подтверждением (change guided-commands).
 *
 * Собирает тему/текст/получателя, запрашивает выбор аккаунта-отправителя,
 * готовит черновик, показывает его и просит подтвердить отправку (да/нет).
 * При подтверждении — отправляет через mail.send, при отказе — отменяет.
 */
import type { ConsoleIO } from '../io.js';
import { promptSendCriteria, promptAccount, promptConfirm } from '../prompts.js';
import { ensureMailConnected } from './connect.js';
import { formatDraft } from '../format.js';
import { getTool } from '../../../tools/registry.js';
import type { MailAccount } from '../../../tools/mail/types.js';

/** Зависимости команды /send. */
export interface SendCommandDeps {
  /** Ввод/вывод. */
  io: ConsoleIO;
  /** Настроенные аккаунты. */
  accounts: MailAccount[];
}

/** Выполняет команду /send. */
export async function runSendCommand(deps: SendCommandDeps): Promise<void> {
  const { io, accounts } = deps;

  const sendInput = await promptSendCriteria(io);
  if (!sendInput) {
    io.write('Отправка отменена (не все обязательные поля указаны).\n');
    return;
  }

  const account = await promptAccount(io, accounts);
  if (!account) return;

  if (!(await ensureMailConnected(io, account))) return;

  // Черновик для предпросмотра.
  const draft = {
    from: account.login,
    to: sendInput.to,
    subject: sendInput.subject,
    text: sendInput.text,
  };
  io.write(formatDraft(draft, io.isTTY()) + '\n');

  // Подтверждение.
  const confirmed = await promptConfirm(io, 'Отправить письмо?');
  if (!confirmed) {
    io.write('Отправка отменена.\n');
    return;
  }

  const sendTool = getTool('mail.send');
  if (!sendTool) {
    io.write('Тул mail.send не зарегистрирован.\n');
    return;
  }

  try {
    await sendTool.handler({
      login: account.login,
      mail: {
        to: [{ address: sendInput.to }],
        subject: sendInput.subject,
        text: sendInput.text,
      },
      confirm: true,
    });
    io.write('Письмо отправлено.\n');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    io.write(`Ошибка отправки: ${msg}\n`);
  }
}
