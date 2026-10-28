import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

/**
 * Загрузчик системного промпта роли из файла-скила.
 * Читает skills/<roleName>.md от cwd проекта как единую строку.
 * Фаза 2, change orchestrator; переиспользуется будущими агентами.
 */

/**
 * Загружает содержимое файла скила роли.
 * @param roleName имя роли (напр. 'orchestrator') → skills/<roleName>.md
 * @returns текст системного промпта
 * @throws Error с ожидаемым путём, если файл не найден/нечитаем.
 */
export async function loadSkill(roleName: string): Promise<string> {
  const skillPath = resolve(process.cwd(), 'skills', `${roleName}.md`);
  try {
    return await readFile(skillPath, 'utf8');
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Не удалось загрузить скил роли '${roleName}' из ${skillPath}: ${reason}`,
      { cause: err },
    );
  }
}