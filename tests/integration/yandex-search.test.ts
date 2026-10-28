import { describe, it, expect } from 'vitest';
import { loadConfigWithAccounts } from '../../src/config/loader.js';
import { YandexMailProvider } from '../../src/tools/mail/providers/yandex.js';

/**
 * Интеграционный тест mail.search на Яндекс-ящике.
 * Только при INTEGRATION_TEST=1; иначе skipped.
 */
const enabled = process.env.INTEGRATION_TEST === '1';

describe.skipIf(!enabled)('yandex search (integration)', () => {
  it('подключается и ищет во входящих (хотя бы пустой/непустой результат)', async () => {
    const { accounts } = loadConfigWithAccounts();
    const yandex = accounts.filter((a) => a.provider === 'yandex')[0];
    if (!yandex) {
      console.log('[yandex-search] нет яндекс-аккаунта в .env — пропуск');
      expect(true).toBe(true);
      return;
    }

    const provider = new YandexMailProvider({ account: yandex });
    try {
      await provider.connect();
      // поиск всех (subject не задан) — должен вернуть либо письма, либо пусто
      const res = await provider.search({ direction: 'incoming', limit: 10 });
      expect(res).toHaveProperty('messages');
      expect(res).toHaveProperty('total');
      expect(res).toHaveProperty('hasMore');
      // метаданные без body
      for (const m of res.messages) {
        expect(m).not.toHaveProperty('body');
        expect(typeof m.uid).toBe('number');
        expect(m.folder).toBe('INBOX');
      }
    } finally {
      await provider.dispose();
    }
  });
});