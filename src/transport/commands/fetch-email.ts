/**
 * Чистая доменная функция чтения тела письма (change web-interface, design D7).
 *
 * Новая операция для веб-транспорта: фетчит полное письмо (метаданные + тело +
 * вложения) через существующий тул `mail.fetch`. В CLI отдельной команды нет
 * (тело открывается через /smart-search или /analyze), но в вебе макет почтового
 * клиента требует показа тела по клику. Переиспользует готовый тул без новой
 * доменной логики.
 */
import type { ToolDef } from '../../tools/registry.js';
import type { EmailFull } from '../../types/email.js';

/** DTO чтения тела письма. */
export interface FetchEmailDeps {
  /** Логин аккаунта. */
  accountLogin: string;
  /** UID письма. */
  uid: number;
  /** Папка письма (опц.). */
  folder?: string;
  /** Тул `mail.fetch`. */
  fetchTool: ToolDef;
}

/**
 * Фетчит полное письмо (тело + метаданные + вложения) через `mail.fetch`.
 *
 * @throws Error при ошибке фетча.
 */
export async function fetchEmail(deps: FetchEmailDeps): Promise<EmailFull> {
  const { accountLogin, uid, fetchTool } = deps;
  return (await fetchTool.handler({
    login: accountLogin,
    uid,
    ...(deps.folder ? { folder: deps.folder } : {}),
  })) as EmailFull;
}
