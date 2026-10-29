/**
 * Bootstrap-сборка агента из конфигурации (Фаза 5, change cli-transport).
 *
 * Грузит конфиг + аккаунты, строит клиенты (RouterAiClient, опц.
 * EmbeddingsClient/FalkorClient), вызывает composeAgents. Возвращает готовый
 * оркестратор и фабрику (для /reset) + cleanup (disposeAll mail-сессий).
 *
 * Ошибки конфига/сборки → throw с читаемым сообщением; main() ловит и
 * завершает процесс с ненулевым кодом, не входя в REPL.
 */
import { loadConfigWithAccounts } from '../../config/loader.js';
import { RouterAiClient } from '../../llm/routerai-client.js';
import { EmbeddingsClient } from '../../llm/embeddings.js';
import { FalkorClient } from '../../tools/vector/falkor.js';
import { composeAgents } from '../../agents/compose.js';
import { getSharedSessionStore } from '../../tools/mail/register-tools.js';
import type { Orchestrator } from '../../agents/orchestrator.js';
import type { Config } from '../../config/schema.js';
import type { MailAccount } from '../../tools/mail/types.js';
import type { CreateMailProviderOptions } from '../../tools/mail/providers/factory.js';

/** Опции bootstrap (для тестов — инжектируемый конфиг/env). */
export interface BootstrapOptions {
  /** Инжектируемый env (по умолчанию process.env). */
  env?: NodeJS.ProcessEnv;
  /** Путь к хранилищу OAuth2-токенов (пробрасывается в composeAgents). */
  tokenStorePath?: string;
  /** Инжектируемый fetch (для тестов клиентов). */
  fetch?: typeof globalThis.fetch;
  /** Пропустить инициализацию FalkorDB (для тестов/окружений без БД). */
  skipFalkor?: boolean;
}

/** Результат bootstrap: готовый агент и cleanup. */
export interface BootstrapResult {
  orchestrator: Orchestrator;
  /** Освобождает занятые ресурсы (mail-сессии, FalkorDB). */
  cleanup: () => Promise<void>;
}

/**
 * Собирает агента из конфигурации проекта.
 * @throws Error с читаемым сообщением при невалидной конфигурации/сборке.
 */
export async function bootstrap(opts: BootstrapOptions = {}): Promise<BootstrapResult> {
  let config: Config;
  let accounts: MailAccount[];

  try {
    ({ config, accounts } = loadConfigWithAccounts(opts.env ?? process.env));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Не удалось загрузить конфигурацию: ${msg}`, { cause: err });
  }

  // OAuth2-конфиг для Outlook (public client, consumers tenant).
  const oauth2: CreateMailProviderOptions['oauth2'] | undefined =
    config.MS_CLIENT_ID.length > 0
      ? { clientId: config.MS_CLIENT_ID, tenant: config.MS_TENANT }
      : undefined;

  const result = await buildAgent(config, accounts, oauth2, opts);
  return result;
}

/** Внутренняя сборка: вынесена для переиспользования в createAgent. */
async function buildAgent(
  config: Config,
  accounts: MailAccount[],
  oauth2: CreateMailProviderOptions['oauth2'] | undefined,
  opts: BootstrapOptions,
): Promise<BootstrapResult> {
  const client = new RouterAiClient(
    opts.fetch ? { config, fetch: opts.fetch } : { config },
  );

  // Векторные клиенты — опциональны (только если FalkorDB доступен).
  let embeddingsClient: EmbeddingsClient | undefined;
  let falkorClient: FalkorClient | undefined;
  if (!opts.skipFalkor) {
    try {
      embeddingsClient = new EmbeddingsClient(
        opts.fetch ? { config, fetch: opts.fetch } : { config },
      );
      falkorClient = new FalkorClient({ config });
      await falkorClient.connect();
    } catch {
      // FalkorDB недоступен — агент работает без векторных тулов.
      falkorClient = undefined;
      embeddingsClient = undefined;
    }
  }

  const orchestrator = await composeAgents({
    client,
    config,
    accounts,
    oauth2,
    tokenStorePath: opts.tokenStorePath ?? config.OAUTH_TOKEN_STORE_PATH,
    downloadDir: config.DOWNLOAD_DIR,
    embeddingsClient,
    falkorClient,
  });

  /** Cleanup: закрывает mail-сессии и FalkorDB. */
  const cleanup = async (): Promise<void> => {
    await getSharedSessionStore().disposeAll();
    if (falkorClient) await falkorClient.close();
  };

  return { orchestrator, cleanup };
}
