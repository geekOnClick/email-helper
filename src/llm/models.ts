import type { Config } from '../config/schema.js';
import type { AgentRole } from './types.js';

export interface ResolveModelOptions {
  /** Роль агента (определяет модель по умолчанию). */
  role?: AgentRole;
  /** Явный идентификатор модели — приоритет над role. */
  model?: string;
}

/**
 * Разрешает идентификатор модели для запроса.
 * Приоритет: явный `model` → модель роли из конфига → модель помощника (fallback).
 */
export function resolveModel(config: Config, opts: ResolveModelOptions = {}): string {
  if (opts.model && opts.model.trim().length > 0) {
    return opts.model;
  }

  if (opts.role) {
    switch (opts.role) {
      case 'orchestrator':
        return config.MODEL_ORCHESTRATOR;
      case 'analyzer':
        return config.MODEL_ANALYZER;
      case 'helper':
        return config.MODEL_HELPER;
    }
  }

  // По умолчанию — модель помощника (дешёвая, для безопасного дефолта).
  return config.MODEL_HELPER;
}
