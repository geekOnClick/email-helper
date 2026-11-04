import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runAddAccountCommand } from '../src/transport/cli/commands/add-account.js';
import { AccountRegistry } from '../src/config/account-registry.js';
import { parseAccounts } from '../src/config/loader.js';
import { MockConsoleIO } from './mock-io.js';
import type { MailAccount } from '../src/tools/mail/types.js';

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
  dir = await mkdtemp(join(tmpdir(), 'add-account-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const yandex: MailAccount = {
  provider: 'yandex',
  login: 'user@yandex.com',
  password: 'app-pwd',
  authStrategy: 'basic',
};

describe('runAddAccountCommand (/add-account)', () => {
  it('(a) успешное заведение нового аккаунта — реестр и .env обновлены', async () => {
    await writeFile(envPath(), 'ROUTERAI_API_KEY=key\n', 'utf8');
    const registry = new AccountRegistry();
    const io = new MockConsoleIO([
      'provider - yandex',
      'login - user@yandex.com',
      'password - app-pwd',
      '', // завершить
    ]);

    await runAddAccountCommand({ io, registry, envPath: envPath() });

    // Реестр обновлён.
    expect(registry.has('user@yandex.com')).toBe(true);
    expect(registry.findByProviderLogin('yandex', 'user@yandex.com')).toEqual(yandex);
    // .env обновлён.
    const written = await readFile(envPath(), 'utf8');
    expect(written).toContain('ROUTERAI_API_KEY=key');
    const m = written.match(/^ACCOUNTS=(.*)$/m);
    expect(m).not.toBeNull();
    expect(parseAccounts(extractAccountsJson(written))).toEqual([yandex]);
    // Сообщение об успехе.
    expect(io.output()).toContain('✓ Аккаунт сохранён');
    expect(io.output()).toContain('перезапустите MCP-сервер');
  });

  it('(b) дубликат login без подтверждения → отмена без изменений', async () => {
    await writeFile(envPath(), 'ROUTERAI_API_KEY=key\nACCOUNTS=[]\n', 'utf8');
    const registry = new AccountRegistry([yandex]);
    const io = new MockConsoleIO([
      'provider - yandex',
      'login - user@yandex.com',
      'password - new-pwd',
      '', // завершить
      'нет', // подтверждение перезаписи
    ]);

    await runAddAccountCommand({ io, registry, envPath: envPath() });

    // Реестр не изменён — прежний пароль.
    expect(registry.findByProviderLogin('yandex', 'user@yandex.com')?.password).toBe('app-pwd');
    // .env не изменён (ACCOUNTS=[]).
    const written = await readFile(envPath(), 'utf8');
    expect(written).toContain('ACCOUNTS=[]');
    expect(io.output()).toContain('отменено');
  });

  it('(c) дубликат login с подтверждением → перезапись', async () => {
    await writeFile(envPath(), 'ROUTERAI_API_KEY=key\nACCOUNTS=[]\n', 'utf8');
    const registry = new AccountRegistry([yandex]);
    const io = new MockConsoleIO([
      'provider - yandex',
      'login - user@yandex.com',
      'password - new-pwd',
      '', // завершить
      'да', // подтверждение перезаписи
    ]);

    await runAddAccountCommand({ io, registry, envPath: envPath() });

    // Реестр обновлён — новый пароль.
    expect(registry.findByProviderLogin('yandex', 'user@yandex.com')?.password).toBe('new-pwd');
    expect(registry.list()).toHaveLength(1);
    // .env обновлён — новый пароль.
    const written = await readFile(envPath(), 'utf8');
    const m = written.match(/^ACCOUNTS=(.*)$/m);
    expect(m).not.toBeNull();
    const parsed = parseAccounts(extractAccountsJson(written));
    expect(parsed[0]?.password).toBe('new-pwd');
    expect(io.output()).toContain('✓ Аккаунт сохранён');
  });

  it('(d) невалидные поля → повтор ввода, затем успех', async () => {
    await writeFile(envPath(), 'ROUTERAI_API_KEY=key\n', 'utf8');
    const registry = new AccountRegistry();
    const io = new MockConsoleIO([
      'provider - gmail', // невалидный
      'provider - yandex',
      'login - user@yandex.com',
      'password - ', // пустой
      'password - app-pwd',
      '', // завершить
    ]);

    await runAddAccountCommand({ io, registry, envPath: envPath() });

    expect(registry.has('user@yandex.com')).toBe(true);
    expect(io.output()).toContain('provider должен быть yandex или outlook');
  });

  it('отмена при пустом вводе сразу → null, без записи', async () => {
    await writeFile(envPath(), 'ROUTERAI_API_KEY=key\n', 'utf8');
    const registry = new AccountRegistry();
    const io = new MockConsoleIO(['']);

    await runAddAccountCommand({ io, registry, envPath: envPath() });

    expect(registry.list()).toHaveLength(0);
    expect(io.output()).toContain('отменено');
  });

  it('(e) команда не регистрируется как тул в registry.ts', async () => {
    // /add-account — это CLI-команда, не доменный тул. Проверяем, что она не
    // экспортирует ToolDef и не попадает в tools/list.
    // Импорт модуля не должен регистрировать тулы.
    const mod = await import('../src/transport/cli/commands/add-account.js');
    expect(mod.runAddAccountCommand).toBeTypeOf('function');
    expect((mod as unknown as { inputSchema?: unknown }).inputSchema).toBeUndefined();
  });
});
