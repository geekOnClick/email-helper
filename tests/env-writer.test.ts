import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { updateAccountsInEnv, isAccountsLine, replaceOrAppendAccountsLine } from '../src/config/env-writer.js';
import { parseAccounts } from '../src/config/loader.js';
import type { MailAccount } from '../src/tools/mail/types.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'env-writer-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const envPath = () => join(dir, '.env');

/** Извлекает JSON-значение ACCOUNTS из текста .env (без кавычек) для round-trip. */
function extractAccountsJson(envContent: string): string {
  const m = envContent.match(/^ACCOUNTS=(.*)$/m);
  if (!m || m[1] === undefined) {
    throw new Error('ACCOUNTS не найден в .env');
  }
  return m[1].replace(/^"|"$/g, '');
}

const yandex: MailAccount = {
  provider: 'yandex',
  login: 'a@yandex.com',
  password: 'p1',
  authStrategy: 'basic',
};

const outlook: MailAccount = {
  provider: 'outlook',
  login: 'b@outlook.com',
  password: 'p2',
  authStrategy: 'oauth2',
};

describe('isAccountsLine', () => {
  it('распознаёт ACCOUNTS=...', () => {
    expect(isAccountsLine('ACCOUNTS=[]')).toBe(true);
  });

  it('распознаёт с пробелами вокруг =', () => {
    expect(isAccountsLine('  ACCOUNTS  = []')).toBe(true);
  });

  it('не считает комментарий', () => {
    expect(isAccountsLine('# ACCOUNTS=[]')).toBe(false);
  });

  it('не считает другую переменную', () => {
    expect(isAccountsLine('ROUTERAI_API_KEY=xxx')).toBe(false);
  });

  it('не считает пустую строку', () => {
    expect(isAccountsLine('')).toBe(false);
  });
});

describe('replaceOrAppendAccountsLine', () => {
  it('(a) дописывает ACCOUNTS в .env без строки ACCOUNTS', () => {
    const content = 'ROUTERAI_API_KEY=key\n# комментарий\nDOWNLOAD_DIR=./downloads\n';
    const result = replaceOrAppendAccountsLine(content, '"[]"');
    expect(result).toContain('ROUTERAI_API_KEY=key');
    expect(result).toContain('# комментарий');
    expect(result).toContain('DOWNLOAD_DIR=./downloads');
    expect(result).toContain('ACCOUNTS="[]"');
  });

  it('(b) заменяет существующую строку ACCOUNTS', () => {
    const content = 'ROUTERAI_API_KEY=key\nACCOUNTS=[]\nDOWNLOAD_DIR=./downloads\n';
    const result = replaceOrAppendAccountsLine(content, '"[new]"');
    expect(result).toContain('ROUTERAI_API_KEY=key');
    expect(result).toContain('ACCOUNTS="[new]"');
    expect(result).not.toContain('ACCOUNTS=[]');
    expect(result).toContain('DOWNLOAD_DIR=./downloads');
  });

  it('(c) сохраняет комментарии и прочие переменные', () => {
    const content = [
      '# === LLM ===',
      'ROUTERAI_API_KEY=key',
      '',
      '# === Аккаунты ===',
      'ACCOUNTS=[]',
      '# Комментарий после',
      'DOWNLOAD_DIR=./downloads',
    ].join('\n');
    const result = replaceOrAppendAccountsLine(content, '"[x]"');
    const lines = result.split('\n');
    expect(lines).toContain('# === LLM ===');
    expect(lines).toContain('ROUTERAI_API_KEY=key');
    expect(lines).toContain('# === Аккаунты ===');
    expect(lines).toContain('ACCOUNTS="[x]"');
    expect(lines).toContain('# Комментарий после');
    expect(lines).toContain('DOWNLOAD_DIR=./downloads');
  });
});

describe('updateAccountsInEnv', () => {
  it('(a) дописывает ACCOUNTS в .env без него, сохраняя прочее', async () => {
    await writeFile(envPath(), 'ROUTERAI_API_KEY=key\n# comment\nDOWNLOAD_DIR=./downloads\n', 'utf8');
    await updateAccountsInEnv(envPath(), [yandex]);
    const written = await readFile(envPath(), 'utf8');
    expect(written).toContain('ROUTERAI_API_KEY=key');
    expect(written).toContain('# comment');
    expect(written).toContain('DOWNLOAD_DIR=./downloads');
    expect(written).toMatch(/ACCOUNTS="\[.*\]"/);
    // Round-trip через parseAccounts возвращает тот же аккаунт.
    const m = written.match(/^ACCOUNTS=(.*)$/m);
    expect(m).not.toBeNull();
    const accountsJson = extractAccountsJson(written);
    expect(parseAccounts(accountsJson)).toEqual([yandex]);
  });

  it('(b) заменяет существующий ACCOUNTS', async () => {
    await writeFile(
      envPath(),
      'ROUTERAI_API_KEY=key\nACCOUNTS=' + JSON.stringify([yandex]) + '\nDOWNLOAD_DIR=./downloads\n',
      'utf8',
    );
    await updateAccountsInEnv(envPath(), [yandex, outlook]);
    const written = await readFile(envPath(), 'utf8');
    expect(written).toContain('ROUTERAI_API_KEY=key');
    expect(written).toContain('DOWNLOAD_DIR=./downloads');
    const m = written.match(/^ACCOUNTS=(.*)$/m);
    expect(m).not.toBeNull();
    const accountsJson = extractAccountsJson(written);
    expect(parseAccounts(accountsJson)).toEqual([yandex, outlook]);
  });

  it('(d) пароль с # и пробелами не ломает round-trip через parseAccounts', async () => {
    const tricky: MailAccount = {
      provider: 'yandex',
      login: 'c@yandex.com',
      password: 'p#ss word 123',
      authStrategy: 'basic',
    };
    await writeFile(envPath(), 'ROUTERAI_API_KEY=key\n', 'utf8');
    await updateAccountsInEnv(envPath(), [tricky]);
    const written = await readFile(envPath(), 'utf8');
    const m = written.match(/^ACCOUNTS=(.*)$/m);
    expect(m).not.toBeNull();
    const accountsJson = extractAccountsJson(written);
    const parsed = parseAccounts(accountsJson);
    expect(parsed).toEqual([tricky]);
    expect(parsed[0]?.password).toBe('p#ss word 123');
  });

  it('(e) отсутствие .env → создаётся с ACCOUNTS', async () => {
    // Файл не существует.
    await expect(access(envPath())).rejects.toThrow();
    await updateAccountsInEnv(envPath(), [yandex]);
    const written = await readFile(envPath(), 'utf8');
    expect(written).toMatch(/ACCOUNTS="\[.*\]"/);
    const m = written.match(/^ACCOUNTS=(.*)$/m);
    expect(m).not.toBeNull();
    const accountsJson = extractAccountsJson(written);
    expect(parseAccounts(accountsJson)).toEqual([yandex]);
  });

  it('атомарность: исходный файл не теряется при перезаписи', async () => {
    await writeFile(envPath(), 'ROUTERAI_API_KEY=key\nACCOUNTS=[]\n', 'utf8');
    await updateAccountsInEnv(envPath(), [outlook]);
    const written = await readFile(envPath(), 'utf8');
    // Исходные переменные сохранены.
    expect(written).toContain('ROUTERAI_API_KEY=key');
    // Новый ACCOUNTS записан.
    const m = written.match(/^ACCOUNTS=(.*)$/m);
    expect(m).not.toBeNull();
    const accountsJson = extractAccountsJson(written);
    expect(parseAccounts(accountsJson)).toEqual([outlook]);
  });
});
