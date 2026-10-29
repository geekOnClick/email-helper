/**
 * Точка входа email-helper (Фаза 5, change cli-transport).
 *
 * Собирает агента из конфигурации и запускает терминальный REPL.
 * Ошибки конфигурации/сборки → stderr + ненулевой код выхода.
 */
import { NodeConsoleIO } from './transport/cli/io.js';
import { CliRepl } from './transport/cli/repl.js';
import { bootstrap } from './transport/cli/bootstrap.js';

async function main(): Promise<void> {
  const { analyzer, accounts, downloadDir, stats, cleanup } = await bootstrap();

  const io = new NodeConsoleIO();
  const repl = new CliRepl({ io, accounts, analyzer, downloadDir, stats });

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
