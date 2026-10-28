import type { MessageStructureObject } from 'imapflow';
import type { AttachmentMeta } from '../../types/email.js';

/**
 * Рекурсивно извлекает метаданные вложений из bodyStructure.
 * Вложение — узел с disposition 'attachment' (или с filename в dispositionParameters/parameters).
 * Возвращает массив AttachmentMeta (part, filename, contentType, size).
 */
export function extractAttachments(struct: MessageStructureObject | undefined): AttachmentMeta[] {
  if (!struct) return [];
  const result: AttachmentMeta[] = [];
  walk(struct, result);
  return result;
}

function walk(node: MessageStructureObject, out: AttachmentMeta[]): void {
  // Сначала обход дочерних (multipart)
  if (node.childNodes && node.childNodes.length > 0) {
    for (const child of node.childNodes) {
      walk(child, out);
    }
  }

  const isAttachment = (node.disposition ?? '').toLowerCase() === 'attachment';
  const filename = findFilename(node);
  // Листовой узел с вложением или именем файла
  if (isAttachment || filename) {
    const part = node.part ?? '';
    out.push({
      part,
      filename: filename ?? `attachment-${part || 'unknown'}`,
      contentType: node.type ?? 'application/octet-stream',
      size: node.size,
    });
  }
}

/** Извлекает имя файла из Content-Disposition или Content-Type parameters. */
function findFilename(node: MessageStructureObject): string | undefined {
  const dp = node.dispositionParameters;
  if (dp && (dp.filename || dp.name)) {
    return String(dp.filename ?? dp.name);
  }
  const ct = node.parameters;
  if (ct && (ct.name || ct.filename)) {
    return String(ct.name ?? ct.filename);
  }
  return undefined;
}