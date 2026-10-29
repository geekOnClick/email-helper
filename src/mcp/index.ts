/**
 * Точка входа MCP-сервера (Фаза 6, change mcp-server).
 *
 * Собирает агента из конфигурации (bootstrap — переиспользование из CLI), на
 * основе реестра тулов создаёт MCP-сервер и запускает его по stdio (по
 * умолчанию) или Streamable HTTP (флаг --http). Ошибки конфигурации/сборки →
 * stderr + ненулевой код выхода.
 *
 * MCP-сервер экспонирует доменные тулы внешним клиентам (pi, Claude Desktop и
 * др.) по стандарту Model Context Protocol, не ведёт историю диалога (слой
 * тулов, не чат — см. design Non-Goals).
 */
import { bootstrap } from '../transport/cli/bootstrap.js';
import { listTools } from '../tools/registry.js';
import { createMcpServer } from './adapters.js';
import { runStdio } from './stdio.js';
import { runHttp } from './http.js';

interface CliArgs {
  http: boolean;
  port?: number;
  host?: string;
}

/** Разбирает флаги CLI: --http, --port <n>, --host <h>. */
function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { http: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--http') {
      args.http = true;
    } else if (a === '--port') {
      const v = argv[i + 1];
      const n = v ? Number(v) : NaN;
      if (!Number.isFinite(n)) {
        throw new Error(`--port: ожидается число, получено «${v ?? ''}»`);
      }
      args.port = n;
      i++;
    } else if (a === '--host') {
      const v = argv[i + 1];
      if (!v) throw new Error('--host: значение не указано');
      args.host = v;
      i++;
    } else if (a === '--help' || a === '-h') {
      process.stderr.write(
        [
          'email-helper MCP-сервер',
          '',
          'Использование:',
          '  tsx src/mcp/index.ts              запуск по stdio (по умолчанию)',
          '  tsx src/mcp/index.ts --http       запуск по Streamable HTTP',
          '',
          'Флаги HTTP-режима:',
          '  --port <число>   порт (по умолчанию 3000)',
          '  --host <хост>    хост (по умолчанию 127.0.0.1 — localhost only)',
          '',
        ].join('\n'),
      );
      process.exit(0);
    } else {
      throw new Error(`неизвестный аргумент: ${a}`);
    }
  }
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  // Сборка агента: грузит конфиг + аккаунты, composeAgents регистрирует тулы
  // в реестре (side-effect). orchestrator не используется (слой тулов, не чат).
  const { cleanup } = await bootstrap();
  const tools = listTools();

  let exiting = false;
  const onSignal = async (_signal: NodeJS.Signals) => {
    if (exiting) return;
    exiting = true;
    await cleanup();
    process.exit(0);
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);

  if (args.http) {
    const handle = await runHttp({
      createServer: () =>
        createMcpServer(
          { name: 'email-helper', version: '0.1.0' },
          tools,
        ),
      port: args.port,
      host: args.host,
    });
    process.stderr.write(`MCP HTTP-сервер слушает: ${handle.url}\n`);
    // HTTP-сервер держит процесс; выход — по сигналу или ошибке.
    process.stdin.on('close', async () => {
      await handle.close();
      await cleanup();
      process.exit(0);
    });
  } else {
    const server = createMcpServer(
      { name: 'email-helper', version: '0.1.0' },
      tools,
    );
    // server.connect блокирует до закрытия stdio-транспорта (EOF).
    await runStdio(server);
    await cleanup();
  }
}

main().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`email-helper-mcp: ${msg}\n`);
  process.exit(1);
});
