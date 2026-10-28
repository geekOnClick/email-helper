import { z } from 'zod';

export const AuthStrategySchema = z.enum(['basic', 'oauth2']);
export type AuthStrategy = z.infer<typeof AuthStrategySchema>;

/**
 * Описание одного почтового аккаунта.
 * provider — тип провайдера: 'yandex' | 'outlook'
 * authStrategy — стратегия аутентификации: 'basic' (логин+пароль) | 'oauth2' (XOAUTH2)
 */
export const AccountSchema = z.object({
  provider: z.enum(['yandex', 'outlook']),
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
  EMBEDDINGS_MODEL: z.string().default('baai/bge-m3'),

  // === FalkorDB ===
  FALKORDB_HOST: z.string().default('localhost'),
  FALKORDB_PORT: z.coerce.number().int().positive().default(6379),
  FALKORDB_PASSWORD: z.string().default(''),

  // === Аккаунты и пути ===
  // ACCOUNTS — JSON-строка с массивом объектов {provider, login, password, authStrategy}
  ACCOUNTS: z.string().default('[]'),
  DOWNLOAD_DIR: z.string().default('./downloads'),

  // === Microsoft identity (OAuth2 для Outlook, Phase 1) ===
  // Public client (без секрета), tenant 'consumers' для личных @outlook.com
  MS_CLIENT_ID: z.string().default(''),
  MS_TENANT: z.string().default('consumers'),
  // Локальное хранилище OAuth2-токенов (refresh token). Вне git.
  OAUTH_TOKEN_STORE_PATH: z.string().default('./.tokens/oauth.json'),
});

export type Config = z.infer<typeof ConfigSchema>;
