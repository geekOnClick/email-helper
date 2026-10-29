/**
 * Мок ConsoleIO для тестов REPL (Фаза 5, change cli-transport).
 *
 * Очередь строк ввода + буферы out/err. readline() выдаёт строки по очереди;
 * при исчерпании — null (EOF). Не зависит от реальных потоков/таймеров —
 * синхронный и детерминированный.
 */
import type { ConsoleIO } from '../src/transport/cli/io.js';

export class MockConsoleIO implements ConsoleIO {
  private readonly inputs: string[];
  private inputIdx = 0;
  readonly outBuf: string[] = [];
  readonly errBuf: string[] = [];
  readonly tty: boolean;
  public cleared = false;

  constructor(inputs: string[], tty = false) {
    this.inputs = inputs;
    this.tty = tty;
  }

  async readline(): Promise<string | null> {
    if (this.inputIdx >= this.inputs.length) return null;
    return this.inputs[this.inputIdx++];
  }

  write(text: string): void {
    this.outBuf.push(text);
  }

  writeErr(text: string): void {
    this.errBuf.push(text);
  }

  clear(): void {
    this.cleared = true;
  }

  isTTY(): boolean {
    return this.tty;
  }

  /** Склеенный stdout-вывод. */
  output(): string {
    return this.outBuf.join('');
  }

  /** Склеенный stderr-вывод. */
  errorOutput(): string {
    return this.errBuf.join('');
  }
}
