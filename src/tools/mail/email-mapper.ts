import type { FetchMessageObject, MessageEnvelopeObject, MessageAddressObject } from 'imapflow';
import type { EmailAddress, EmailMessage } from '../../types/email.js';

/**
 * Преобразует FetchMessageObject imapflow в доменный EmailMessage (без тела).
 * folder задаётся вызывающим (папка, в которой шёл поиск).
 */
export function toEmailMessage(row: FetchMessageObject, folder: string): EmailMessage {
  const env = row.envelope;
  return {
    uid: row.uid,
    subject: env?.subject ?? '',
    from: env?.from?.[0] ? toAddress(env.from[0]) : undefined,
    to: env?.to?.map(toAddress),
    date: row.internalDate instanceof Date ? row.internalDate : new Date(0),
    flags: row.flags ? Array.from(row.flags) : [],
    size: row.size,
    folder,
  };
}

function toAddress(a: MessageAddressObject): EmailAddress {
  return { name: a.name || undefined, address: a.address || '' };
}

/** Извлекает subject из конверта (хелпер для тестов). */
export function envelopeSubject(env?: MessageEnvelopeObject): string {
  return env?.subject ?? '';
}