import { describe, it, expect } from 'vitest';
import { loadConfigWithAccounts } from '../../src/config/loader.js';
import { probeOutlookBasicAuth } from '../../src/tools/mail/providers/outlook-probe.js';

/**
 * Интеграционный зонд basic-auth для Outlook (риск PLAN.md 3.0).
 *
 * Запускается ТОЛЬКО при INTEGRATION_TEST=1 и наличии outlook-аккаунта в .env:
 *   INTEGRATION_TEST=1 npx vitest run tests/integration/outlook-basic-auth-probe.test.ts
 *
 * Без флага тест skipped — не падает в CI без аккаунтов.
 */
const enabled = process.env.INTEGRATION_TEST === '1';

describe.skipIf(!enabled)('outlook basic-auth probe (integration)', () => {
  it('печатает наблюдённый статус basic-auth для outlook-аккаунта', async () => {
    const { accounts } = loadConfigWithAccounts();
    const outlook = accounts.filter((a) => a.provider === 'outlook');

    if (outlook.length === 0) {
      console.log('[outlook-probe] Нет outlook-аккаунта в .env — тест пропущен');
      expect(true).toBe(true);
      return;
    }

    for (const acc of outlook) {
      const res = await probeOutlookBasicAuth(acc);
      console.log(`[outlook-probe] ${acc.login}: works=${res.works} error=${res.error ?? '-'}`);
      expect(res).toHaveProperty('works');
    }
  });
});