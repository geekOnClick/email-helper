/**
 * Точка входа email-helper (Фаза 5, change cli-transport).
 *
 * Собирает агента из конфигурации и запускает терминальный REPL или веб-сервер
 * (флаг `--web`, change web-interface). Ошибки конфигурации/сборки → stderr +
 * ненулевой код выхода.
 */
import { NodeConsoleIO } from './transport/cli/io.js';
import { CliRepl } from './transport/cli/repl.js';
import { bootstrap } from './transport/cli/bootstrap.js';
import { runWeb } from './transport/web/server.js';
import type { ApiContext } from './transport/web/api/handlers.js';
import { loadConfig } from './config/loader.js';

/** Разбирает аргументы CLI. */
function parseArgs(argv: string[]): { web: boolean } {
  return { web: argv.includes('--web') };
}

/**
 * Запускает веб-сервер (режим --web): bootstrap + HTTP на WEB_HOST:WEB_PORT.
 * Переиспользует bootstrap-сборку (агенты, тулы, реестр). Логирует URL в stderr.
 * Graceful-shutdown: cleanup bootstrap'а + закрытие сервера по SIGINT/SIGTERM.
 */
async function runWebMode(): Promise<void> {
  const boot = await bootstrap();
  const config = loadConfig();

  const ctx: ApiContext = {
    bootstrap: boot,
    registry: boot.registry,
    envPath: '.env',
    fallbackDays: boot.fallbackDays,
    analyzeManyMaxEmails: boot.analyzeManyMaxEmails,
  };

  const handle = await runWeb({ ctx, port: config.WEB_PORT, host: config.WEB_HOST });
  process.stderr.write(`email-helper web: ${handle.url}\n`);

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    await boot.cleanup();
    await handle.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.web) {
    await runWebMode();
    return;
  }

  const { analyzer, accounts, registry, analyzeManyMaxEmails, fallbackDays, llmClient, stats, cleanup } = await bootstrap();

  const io = new NodeConsoleIO();
  const repl = new CliRepl({
    io,
    accounts,
    registry,
    envPath: '.env',
    analyzer,
    llmClient,
    analyzeManyMaxEmails,
    fallbackDays,
    stats,
  });

  // SIGINT/SIGTERM вне исполнения → корректный выход с cleanup.
  let exiting = false;
  const onSignal = async (_signal: NodeJS.Signals) => {
    if (exiting) return;
    exiting = true;
    io.write('\n');
    await cleanup();
    io.close();
    process.exit(0);
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);

  try {
    await repl.start();
  } finally {
    await cleanup();
    io.close();
  }
}

main().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`email-helper: ${msg}\n`);
  process.exit(1);
});
