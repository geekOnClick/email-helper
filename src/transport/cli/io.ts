/**
 * Абстракция ввода/вывода терминала (Фаза 5, change cli-transport).
 *
 * Единственная поверхность, через которую REPL взаимодействует с потоками.
 * Продакшен-реализация NodeConsoleIO обёртывает readline/promises над
 * stdin/stdout; в тестах — MockConsoleIO с очередью строк и буферами.
 *
 * TTY-детект: ANSI-цвет/управляющие коды применяются только при isTTY stdout,
 * чтобы вывод в пайп/файл оставался plain-text.
 */
import * as readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

/** Контракт ввода/вывода REPL. */
export interface ConsoleIO {
  /** Читает строку ввода. Возвращает null при EOF. */
  readline(): Promise<string | null>;
  /** Пишет строку в stdout (без перевода строки). */
  write(text: string): void;
  /** Пишет строку в stderr (без перевода строки). */
  writeErr(text: string): void;
  /** Очищает экран (ANSI clear). */
  clear(): void;
  /** Поддерживает ли stdout ANSI-цвет/управление (TTY). */
  isTTY(): boolean;
}

/** ANSI-код очистки экрана + курсор в 0,0. */
const CLEAR_SCREEN = '\x1B[2J\x1B[0f';

/**
 * Продакшен-реализация ConsoleIO поверх node:readline/promises.
 * Один экземпляр — один интерфейс; close() закрывает readline.
 */
export class NodeConsoleIO implements ConsoleIO {
  private readonly rl: readline.Interface;

  constructor() {
    this.rl = readline.createInterface({
      input: stdin,
      output: stdout,
      terminal: stdout.isTTY,
    });
  }

  readline(): Promise<string | null> {
    return this.rl.question('');
  }

  write(text: string): void {
    stdout.write(text);
  }

  writeErr(text: string): void {
    process.stderr.write(text);
  }

  clear(): void {
    if (this.isTTY()) {
      stdout.write(CLEAR_SCREEN);
    } else {
      // Не-TTY: просто разделитель вместо очистки.
      stdout.write('---\n');
    }
  }

  isTTY(): boolean {
    return stdout.isTTY === true;
  }

  /** Закрывает readline (освобождает stdin). */
  close(): void {
    this.rl.close();
  }
}
