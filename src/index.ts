import { loadConfig } from './config/loader.js';

/**
 * Точка входа email-helper.
 * На этапе bootstrap (Фаза 0) — только подтверждает, что скелет собирается.
 * Полная инициализация агента — в Фазе 2.
 */
function main(): void {
  try {
    const config = loadConfig();
    console.log('email-helper skeleton ready');
    console.log(`  orchestrator: ${config.MODEL_ORCHESTRATOR}`);
    console.log(`  helper:       ${config.MODEL_HELPER}`);
    console.log(`  embeddings:   ${config.EMBEDDINGS_MODEL}`);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

main();