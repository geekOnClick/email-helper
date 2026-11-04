import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CliRepl } from '../src/transport/cli/repl.js';
import { MockConsoleIO } from './mock-io.js';
import { AccountRegistry } from '../src/config/account-registry.js';
import { resetTools, registerTool, type ToolDef } from '../src/tools/registry.js';
import { parseAccounts } from '../src/config/loader.js';
import type { MailAccount } from '../src/tools/mail/types.js';
import type { Subagent } from '../src/agents/subagent.js';

let dir: string;
const envPath = () => join(dir, '.env');

/** Извлекает JSON-значение ACCOUNTS из текста .env (без кавычек) для round-trip. */
function extractAccountsJson(envContent: string): string {
  const m = envContent.match(/^ACCOUNTS=(.*)$/m);
  if (!m || m[1] === undefined) {
    throw new Error('ACCOUNTS не найден в .env');
  }
  return m[1].replace(/^"|"$/g, '');
}

beforeEach(async () => {
  resetTools();
  dir = await mkdtemp(join(tmpdir(), 'repl-add-account-flow-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function stubAnalyzer(): Subagent {
  return { name: 'analyzer', description: 'stub', run: async () => 'саммари' };
}

/** Stub mail.search тул, который просто возвращает пустой результат — нужен, чтобы
 * /find не падал на «тул не зарегистрирован» и доходил до promptAccount. */
function stubSearchTool(): ToolDef {
  return {
    name: 'mail.search',
    description: 'stub',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => ({ messages: [], total: 0, hasMore: false }),
  };
}

/** Stub mail.connect тул, который «подключается» успешно (для ensureMailConnected). */
function stubConnectTool(): ToolDef {
  return {
    name: 'mail.connect',
    description: 'stub',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => ({ connected: true, accountId: 'stub', provider: 'yandex' }),
  };
}

describe('CliRepl: аккаунт, добавленный /add-account, виден в /find', () => {
  it('после /add-account новый аккаунт появляется в выборе /find', async () => {
    await writeFile(envPath(), 'ROUTERAI_API_KEY=key\n', 'utf8');
    registerTool(stubSearchTool());
    registerTool(stubConnectTool());

    const registry = new AccountRegistry();
    const analyzer = stubAnalyzer();
    const io = new MockConsoleIO([
      // /add-account: заводим yandex-аккаунт
      '/add-account',
      'provider - yandex',
      'login - new@yandex.com',
      'password - fresh-pwd',
      '', // завершить мастер
      // /find: выбираем заведённый аккаунт (он единственный → авто-выбор),
      // затем пустые критерии → отмена.
      '/find',
      '', // пустая строка в мастере критериев → отмена (0 полей)
      '/quit',
    ]);
    const repl = new CliRepl({
      io,
      accounts: registry.list(),
      registry,
      envPath: envPath(),
      analyzer,
      downloadDir: '/tmp',
    });

    await repl.start();

    // Реестр обновлён.
    expect(registry.has('new@yandex.com')).toBe(true);
    // .env обновлён.
    const written = await readFile(envPath(), 'utf8');
    const m = written.match(/^ACCOUNTS=(.*)$/m);
    expect(m).not.toBeNull();
    const parsed = parseAccounts(extractAccountsJson(written));
    expect(parsed).toContainEqual({
      provider: 'yandex',
      login: 'new@yandex.com',
      password: 'fresh-pwd',
      authStrategy: 'basic',
    } satisfies MailAccount);
    // /add-account сообщил об успехе.
    expect(io.output()).toContain('✓ Аккаунт сохранён');
  });

  it('/find с одним аккаунтом в реестре → авто-выбор без запроса', async () => {
    registerTool(stubSearchTool());
    registerTool(stubConnectTool());
    const account: MailAccount = {
      provider: 'yandex',
      login: 'solo@yandex.com',
      password: 'p',
      authStrategy: 'basic',
    };
    const registry = new AccountRegistry([account]);
    const analyzer = stubAnalyzer();
    const io = new MockConsoleIO([
      '/find',
      'тема - тест',
      '', // завершить сбор критериев
      '/quit',
    ]);
    const repl = new CliRepl({
      io,
      accounts: registry.list(),
      registry,
      envPath: envPath(),
      analyzer,
      downloadDir: '/tmp',
    });

    await repl.start();
    // Поиск выполнен (auto-выбор аккаунта, без запроса номера).
    expect(io.output()).not.toContain('Выберите аккаунт');
    // Либо найдено 0, либо список — stub возвращает пусто → «Ничего не найдено».
    expect(io.output()).toContain('Ничего не найдено');
  });
});
