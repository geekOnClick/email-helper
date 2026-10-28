import type { Folder } from './types.js';
import type { SearchCriteria } from '../../types/email.js';

/**
 * Разрешает папку для поиска по критериям.
 * Явная папка (criteria.folder) приоритетнее направления.
 * direction: 'incoming' → папка с флагом \Inbox, 'outgoing' → \Sent.
 * По умолчанию (без folder и direction) — incoming.
 */
export function resolveFolder(criteria: SearchCriteria, folders: Folder[]): string {
  if (criteria.folder) return criteria.folder;

  const direction = criteria.direction ?? 'incoming';
  const flag = direction === 'outgoing' ? '\\Sent' : '\\Inbox';
  const found = folders.find((f) => f.flags.includes(flag));
  if (found) return found.path;

  // fallback по имени
  const byName = direction === 'outgoing' ? 'Sent' : 'INBOX';
  const byNameFound = folders.find((f) => f.name === byName || f.path === byName);
  return byNameFound?.path ?? byName;
}