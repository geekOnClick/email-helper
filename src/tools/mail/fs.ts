import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

/**
 * Создаёт каталог (и промежуточные), если не существует. Идемпотентно.
 * @param dir путь к каталогу
 */
export async function ensureDir(dir: string): Promise<string> {
  const abs = resolve(dir);
  await mkdir(abs, { recursive: true });
  return abs;
}