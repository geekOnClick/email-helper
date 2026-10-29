/**
 * Слой сборки агента (Фаза 2, change helper-agent).
 *
 * Единая точка инициализации: регистрирует mail-тулы в реестре (shared
 * `MailSessionStore`), строит обоих субагентов и возвращает готовый
 * `Orchestrator` с `subagents: [analyzer, helper]`. Вызывается транспортом
 * (Фаза 5+) для создания агента из конфига + аккаунтов.
 *
 * Регистрация тулов — side-effect `registerMailConnectTools` (throws на
 * дубликат); `composeAgents` вызывается один раз за процесс. В тестах
 * `resetTools()` в beforeEach.
 */
import { Orchestrator } from './orchestrator.js';
import { createAnalyzer } from './analyzer.js';
import { createHelper } from './helper.js';
import { registerMailConnectTools, getSharedSessionStore } from '../tools/mail/register-tools.js';
import { registerVectorTools } from '../tools/vector/register-tools.js';
import type { MailAccount } from '../tools/mail/types.js';
import type { CreateMailProviderOptions } from '../tools/mail/providers/factory.js';
import type { SmtpTransportFactory } from '../tools/mail/smtp-client.js';
import type { RouterAiClient } from '../llm/routerai-client.js';
import type { EmbeddingsClient } from '../llm/embeddings.js';
import type { FalkorClient } from '../tools/vector/falkor.js';
import type { Config } from '../config/schema.js';

/** Опции сборки агента. */
export interface ComposeAgentsOptions {
  /** LLM-клиент. */
  client: RouterAiClient;
  /** Конфиг (источник лимитов по умолчанию). */
  config: Config;
  /** Почтовые аккаунты для регистрации тулa mail.connect. */
  accounts: MailAccount[];
  /** Конфиг OAuth2 (MS_CLIENT_ID/MS_TENANT) для Outlook. */
  oauth2?: CreateMailProviderOptions['oauth2'];
  /** Путь к локальному хранилищу OAuth2-токенов. */
  tokenStorePath?: string;
  /** Каталог по умолчанию для скачивания вложений. */
  downloadDir?: string;
  /** Инжектируемая фабрика SMTP-транспорта для mail.send (по умолчанию — nodemailer). */
  smtpTransportFactory?: SmtpTransportFactory;
  /** Клиент embeddings для векторных тулов (опц.). Если передан — регистрируются embeddings.index/vector.search. */
  embeddingsClient?: EmbeddingsClient;
  /** Клиент FalkorDB для векторных тулов (опц.). Если передан — регистрируются embeddings.index/vector.search. */
  falkorClient?: FalkorClient;
  /** Переопределение лимита итераций (иначе config.AGENT_MAX_ITERATIONS). */
  maxIterations?: number;
  /** Переопределение лимита символов результата тулa. */
  maxToolResultChars?: number;
}

/**
 * Собирает агента: регистрирует mail-тулы (shared-сессия), строит
 * анализатора и помощника, возвращает Orchestrator с обоими субагентами.
 *
 * Регистрирует тулы через `registerMailConnectTools` на shared
 * `MailSessionStore`; повторный вызов за процесс не предполагается
 * (`registerTool` throws на дубликат).
 */
export async function composeAgents(opts: ComposeAgentsOptions): Promise<Orchestrator> {
  // 1. Регистрация рутинных тулов на shared-сессии.
  registerMailConnectTools({
    accounts: opts.accounts,
    oauth2: opts.oauth2,
    tokenStorePath: opts.tokenStorePath,
    sessionStore: getSharedSessionStore(),
    downloadDir: opts.downloadDir,
    smtpTransportFactory: opts.smtpTransportFactory,
  });

  // 1b. Регистрация векторных тулов — только если оба клиента переданы.
  if (opts.embeddingsClient && opts.falkorClient) {
    registerVectorTools({
      sessionStore: getSharedSessionStore(),
      embeddingsClient: opts.embeddingsClient,
      falkorClient: opts.falkorClient,
    });
  }

  // 2. Субагенты: анализатор + помощник.
  const analyzer = await createAnalyzer({ client: opts.client, config: opts.config });
  const helper = await createHelper({ client: opts.client, config: opts.config });

  // 3. Оркестратор с обоими субагентами → delegate доступен оркестратору.
  return Orchestrator.create({
    client: opts.client,
    config: opts.config,
    subagents: [analyzer, helper],
    maxIterations: opts.maxIterations,
    maxToolResultChars: opts.maxToolResultChars,
  });
}