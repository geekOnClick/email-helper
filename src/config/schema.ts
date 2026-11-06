import { z } from 'zod';

export const AuthStrategySchema = z.enum(['basic', 'oauth2']);
export type AuthStrategy = z.infer<typeof AuthStrategySchema>;

/**
 * Описание одного почтового аккаунта.
 * provider — тип провайдера: 'yandex' | 'outlook' | 'mail'
 * authStrategy — стратегия аутентификации: 'basic' (логин+пароль) | 'oauth2' (XOAUTH2)
 */
export const AccountSchema = z.object({
  provider: z.enum(['yandex', 'outlook', 'mail']),
  login: z.string().min(1),
  password: z.string().min(1),
  authStrategy: AuthStrategySchema.default('basic'),
});
export type Account = z.infer<typeof AccountSchema>;

/**
 * Развёрнутая схема конфигурации проекта email-helper.
 * Валидирует .env и даёт типобезопасный конфиг для всех фаз.
 */
export const ConfigSchema = z.object({
  // === LLM-провайдер RouterAI ===
  ROUTERAI_API_KEY: z.string().min(1, 'ROUTERAI_API_KEY обязателен'),
  ROUTERAI_BASE_URL: z.string().url().default('https://routerai.ru/api/v1'),

  // Модели (по умолчанию — решения из PLAN.md раздел 8.1)
  MODEL_ORCHESTRATOR: z.string().default('z-ai/glm-5.2'),
  MODEL_ANALYZER: z.string().default('z-ai/glm-5.2'),
  MODEL_HELPER: z.string().default('z-ai/glm-5.3-flash'),

  // === LLM-клиент: ретраи и таймауты (Фаза 2, llm-client) ===
  LLM_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(60000),
  LLM_RETRIES: z.coerce.number().int().nonnegative().default(3),
  LLM_RETRY_BASE_MS: z.coerce.number().int().positive().default(1000),

  // === Агенты: границы цикла tool-calling (Фаза 2, orchestrator) ===
  AGENT_MAX_ITERATIONS: z.coerce.number().int().positive().default(10),
  AGENT_MAX_TOOL_RESULT_CHARS: z.coerce.number().int().positive().default(20000),

  // === Аккаунты и пути ===
  // ACCOUNTS — JSON-строка с массивом объектов {provider, login, password, authStrategy}
  ACCOUNTS: z.string().default('[]'),
  DOWNLOAD_DIR: z.string().default('./downloads'),

  // === Устойчивость IMAP-операций (mail-search-robustness) ===
  // Общий таймаут одной попытки для всех IMAP-тулов (search/fetch/downloadAttachments/listFolders).
  MAIL_OP_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),
  // Число повторов с переподключением при сетевом обрыве/таймауте.
  MAIL_OP_MAX_RETRIES: z.coerce.number().int().nonnegative().default(2),
  // SINCE по умолчанию (в днях) для subject-only поиска — bounded client-side фолбэкк.
  MAIL_SEARCH_FALLBACK_DAYS: z.coerce.number().int().positive().default(180),
  // === Команды CLI (cli-smart-commands) ===
  // Потолок числа писем для /analyze-many (фетч тел + анализ). При превышении —
  // анализ первых N с предупреждением об усечении.
  ANALYZE_MANY_MAX_EMAILS: z.coerce.number().int().positive().default(10),

  // === Веб-транспорт (transport/web) ===
  // Порт HTTP-сервера веб-интерфейса. По умолчанию 3000.
  WEB_PORT: z.coerce.number().int().positive().default(3000),
  // Хост веб-сервера. По умолчанию 127.0.0.1 (localhost-only, как MCP HTTP).
  WEB_HOST: z.string().default('127.0.0.1'),

  // === Microsoft identity (OAuth2 для Outlook, Phase 1) ===
  // Public client (без секрета), tenant 'consumers' для личных @outlook.com
  MS_CLIENT_ID: z.string().default(''),
  MS_TENANT: z.string().default('consumers'),
  // Локальное хранилище OAuth2-токенов (refresh token). Вне git.
  OAUTH_TOKEN_STORE_PATH: z.string().default('./.tokens/oauth.json'),
});

export type Config = z.infer<typeof ConfigSchema>;
