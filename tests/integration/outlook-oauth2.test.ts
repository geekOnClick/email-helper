import { describe, it, expect, vi } from 'vitest';
import { writeFileSync } from 'node:fs';
import { loadConfigWithAccounts } from '../../src/config/loader.js';
import { createMailProvider } from '../../src/tools/mail/providers/factory.js';

/**
 * Интеграционный тест Outlook OAuth2 (device code flow / refresh token).
 *
 * Запускается ТОЛЬКО при INTEGRATION_TEST=1 и MS_CLIENT_ID в .env:
 *   INTEGRATION_TEST=1 npx vitest run tests/integration/outlook-oauth2.test.ts
 *
 * Первый запуск требует ручной авторизации пользователя в браузере:
 * тест выведет URL + user code, нужно завершить вход. Полученный refresh token
 * сохраняется в OAUTH_TOKEN_STORE_PATH и переиспользуется при последующих запусках.
 *
 * Без флага тест skipped.
 */
const enabled = process.env.INTEGRATION_TEST === '1';

describe.skipIf(!enabled)('outlook oauth2 (integration)', () => {
  it('подключается к outlook.office365.com:993 и listFolders содержит \\Inbox', async () => {
    const { config, accounts } = loadConfigWithAccounts();
    const outlook = accounts.filter((a) => a.provider === 'outlook' && a.authStrategy === 'oauth2')[0];

    if (!outlook) {
      console.log('[outlook-oauth2] нет outlook+oauth2 аккаунта в .env — пропуск');
      expect(true).toBe(true);
      return;
    }
    if (!config.MS_CLIENT_ID) {
      throw new Error('INTEGRATION_TEST=1, но MS_CLIENT_ID не задан (задача 5.6)');
    }

    const prompt = (msg: string) => {
      // Дублируем в файл, чтобы было видно даже если vitest глушит stdout.
      writeFileSync('/tmp/outlook-oauth2-prompt.txt', msg + '\n');
      console.log(msg);
    };

    const provider = createMailProvider(outlook, {
      oauth2: {
        clientId: config.MS_CLIENT_ID,
        tenant: config.MS_TENANT || 'consumers',
      },
      tokenStorePath: config.OAUTH_TOKEN_STORE_PATH,
      prompt,
    });

    try {
      const res = await provider.connect();
      expect(res.connected).toBe(true);
      expect(res.provider).toBe('outlook');

      const folders = await provider.listFolders();
      expect(folders.some((f) => f.flags.includes('\\Inbox'))).toBe(true);
    } finally {
      await provider.dispose();
    }
    void vi;
  });
});