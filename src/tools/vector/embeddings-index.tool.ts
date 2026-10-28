/**
 * Тул embeddings.index: индексация письма в векторное хранилище.
 * Фаза 3b, change semantic-search.
 *
 * Читает письмо через sessionStore (как mail.fetch), строит embedding
 * объединения «тема + тело» и сохраняет в FalkorDB.
 * Контракт — см. `openspec/changes/semantic-search/specs/mail/semantic-search/spec.md`.
 */
import type { ToolDef } from '../registry.js';
import type { EmailFull } from '../../types/email.js';
import type { MailSessionStore } from '../mail/session-store.js';
import type { EmbeddingsClient } from '../../llm/embeddings.js';
import type { FalkorClient } from './falkor.js';
import { ConnectError } from '../mail/providers/abstract-imap-provider.js';

export interface EmbeddingsIndexArgs {
  login: string;
  uid: number;
  folder?: string;
}

export interface EmbeddingsIndexDeps {
  sessionStore: MailSessionStore;
  embeddingsClient: EmbeddingsClient;
  falkorClient: FalkorClient;
}

/** Длина сниппета тела для хранения в графе. */
const SNIPPET_MAX = 500;

/**
 * Объединяет тему и тело в текст для embedding.
 * При пустом теле — только тема.
 */
export function buildIndexText(subject: string, body: string, hasBody: boolean): string {
  const subjectPart = subject ?? '';
  if (!hasBody || !body || body.length === 0) return subjectPart;
  return `${subjectPart}\n${body}`;
}

/** Формирует сниппет тела для хранения в графе. */
export function buildSnippet(body: string, hasBody: boolean): string {
  if (!hasBody || !body || body.length === 0) return '';
  return body.length > SNIPPET_MAX ? body.slice(0, SNIPPET_MAX) : body;
}

/**
 * Тул embeddings.index: индексация письма (тема+тело → embedding → FalkorDB).
 * Idempotent (MERGE в FalkorDB).
 */
export function createEmbeddingsIndexTool(deps: EmbeddingsIndexDeps): ToolDef<EmbeddingsIndexArgs> {
  return {
    name: 'embeddings.index',
    description:
      'Индексация письма в векторное хранилище: читает письмо по login+uid (требует mail.connect), строит embedding «тема + тело» и сохраняет в FalkorDB. Idempotent (повторный вызов обновляет).',
    inputSchema: {
      type: 'object',
      properties: {
        login: { type: 'string', description: 'логин аккаунта' },
        uid: { type: 'integer', description: 'UID письма' },
        folder: { type: 'string', description: 'папка (иначе направление incoming → \\Inbox)' },
      },
      required: ['login', 'uid'],
    },
    handler: async (args) => {
      const { login, uid, folder } = args;
      if (typeof login !== 'string') {
        throw new ConnectError('embeddings.index: требуется параметр login');
      }
      if (typeof uid !== 'number' || !Number.isFinite(uid)) {
        throw new ConnectError('embeddings.index: требуется параметр uid (число)');
      }

      const provider = deps.sessionStore.get(login);
      if (!provider) {
        throw new ConnectError(`embeddings.index: подключение не установлено для ${login}`);
      }

      const email: EmailFull = await provider.fetch(uid, folder);

      const text = buildIndexText(email.subject, email.body, email.hasBody);
      const vectors = await deps.embeddingsClient.embed([text]);
      const embedding = vectors[0];
      if (!embedding) {
        throw new ConnectError('embeddings.index: embeddings-клиент не вернул вектор');
      }

      const emailId = `${login}:${email.folder}:${uid}`;
      await deps.falkorClient.indexEmail({
        emailId,
        login,
        folder: email.folder,
        uid,
        subject: email.subject,
        from: email.from?.address ?? '',
        date: email.date.toISOString(),
        snippet: buildSnippet(email.body, email.hasBody),
        embedding,
      });

      return { indexed: true, emailId, login, folder: email.folder, uid };
    },
  };
}