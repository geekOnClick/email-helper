import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfigWithAccounts } from '../../src/config/loader.js';
import { YandexMailProvider } from '../../src/tools/mail/providers/yandex.js';
import type { MailProvider } from '../../src/tools/mail/mail-provider.js';

/**
 * Интеграционный тест mail.fetch / mail.downloadAttachments на Яндекс-ящике.
 * Только при INTEGRATION_TEST=1; иначе skipped.
 *
 * Берёт первое письмо из INBOX, делает fetch, и если есть вложения — скачивает.
 */
const enabled = process.env.INTEGRATION_TEST === '1';

describe.skipIf(!enabled)('yandex fetch/attachments (integration)', () => {
  let provider: MailProvider;
  let uid: number;
  let dir: string;

  beforeAll(async () => {
    const { accounts } = loadConfigWithAccounts();
    const yandex = accounts.filter((a) => a.provider === 'yandex')[0];
    if (!yandex) return;
    provider = new YandexMailProvider({ account: yandex });
    await provider.connect();
    dir = await mkdtemp(join(tmpdir(), 'yandex-att-'));
  });

  afterAll(async () => {
    if (provider) await provider.dispose();
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it('находит письмо и делает fetch тела', async () => {
    if (!provider) return;
    // ищем любое письмо во входящих
    const search = await provider.search({ direction: 'incoming', limit: 1 });
    if (search.messages.length === 0) {
      console.log('[yandex-att] нет писем во входящих — проверка fetch пропущена');
      expect(true).toBe(true);
      return;
    }
    const first = search.messages[0];
    if (!first) { expect.fail('должно быть письмо'); return; }
    uid = first.uid;
    const full = await provider.fetch(uid);
    expect(full.uid).toBe(uid);
    expect(full).toHaveProperty('body');
    expect(full).toHaveProperty('attachments');
  });

  it('скачивает вложения если есть', async () => {
    if (!provider || !uid) {
      console.log('[yandex-att] нет uid — пропуск скачивания');
      return;
    }
    const full = await provider.fetch(uid);
    if (full.attachments.length === 0) {
      console.log('[yandex-att] у письма нет вложений — пропуск');
      expect(true).toBe(true);
      return;
    }
    const res = await provider.downloadAttachments(uid, dir);
    expect(res.paths.length).toBeGreaterThan(0);
    for (const p of res.paths) {
      const s = await stat(p);
      expect(s.size).toBeGreaterThan(0);
    }
  });
});