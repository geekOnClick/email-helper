import { describe, it, expect } from 'vitest';
import { loadConfigWithAccounts } from '../../src/config/loader.js';
import { YandexMailProvider } from '../../src/tools/mail/providers/yandex.js';

/**
 * Интеграционный тест подключения к Яндекс-ящику.
 * Только при INTEGRATION_TEST=1; иначе skipped.
 */
const enabled = process.env.INTEGRATION_TEST === '1';

describe.skipIf(!enabled)('yandex connect (integration)', () => {
  it('подключается к imap.yandex.ru:993 и listFolders содержит \\Inbox', async () => {
    const { accounts } = loadConfigWithAccounts();
    const yandex = accounts.filter((a) => a.provider === 'yandex')[0];
    if (!yandex) {
      console.log('[yandex] нет яндекс-аккаунта в .env — пропуск');
      expect(true).toBe(true);
      return;
    }

    const provider = new YandexMailProvider({ account: yandex });
    try {
      const res = await provider.connect();
      expect(res.connected).toBe(true);
      expect(res.provider).toBe('yandex');

      const folders = await provider.listFolders();
      const hasInbox = folders.some((f) => f.flags.includes('\\Inbox'));
      expect(hasInbox).toBe(true);
    } finally {
      await provider.dispose();
    }
  });
});