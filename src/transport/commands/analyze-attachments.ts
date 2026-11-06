/**
 * Чистая доменная функция команды /analyze-attachments (change web-interface, design D1).
 *
 * Выделена из `src/transport/cli/commands/analyze-attachments.ts`. Принимает DTO
 * (login + uid), скачивает вложения во временную папку, извлекает текст, передаёт
 * анализатору. Возвращает отчёт + список вложений. Удаляет временную папку ВСЕГДА.
 *
 * В отличие от CLI-команды, не выполняет поиск/выбор UID (это делает вызывающая
 * сторона — CLI через мастер, веб через выбор письма из списка).
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { ToolDef } from '../../tools/registry.js';
import type { Subagent } from '../../agents/subagent.js';
import type { DownloadResult } from '../../types/email.js';
import { extractAttachmentText } from '../cli/commands/attachment-text.js';

/** DTO команды /analyze-attachments (без ConsoleIO). */
export interface AnalyzeAttachmentsDeps {
  /** Логин аккаунта. */
  accountLogin: string;
  /** UID письма. */
  uid: number;
  /** Тул `mail.downloadAttachments`. */
  downloadTool: ToolDef;
  /** Субагент-анализатор (LLM). */
  analyzer: Subagent;
  /** Базовая папка для временных файлов (по умолчанию — os.tmpdir()). */
  tmpDir?: string;
}

/** Результат анализа вложений. */
export interface AnalyzeAttachmentsResult {
  /** Отчёт анализатора (саммари каждого поддержанного вложения). Пусто, если
   *  анализатор не вызывался или завершился ошибкой. */
  analysis: string;
  /** Число скачанных вложений. */
  attachmentCount: number;
  /** Имена пропущенных (неподдерживаемых) вложений с причинами. */
  skipped: { filename: string; reason?: string }[];
  /** Ошибка анализатора (если анализ завершился ошибкой). Анализ пытается
   *  выполниться; при ошибке отчёт пуст, но вложения уже скачаны и пропуски
   *  известны — вызывающая сторона рендерит ошибку и пропуски. */
  analysisError?: string;
}

/**
 * Скачивает вложения письма, извлекает текст, анализирует через анализатора.
 * Удаляет временную папку всегда (в `finally`).
 *
 * @throws Error при ошибке скачивания. Возвращает `attachmentCount: 0`, если
 *   письмо без вложений.
 */
export async function runAnalyzeAttachments(
  deps: AnalyzeAttachmentsDeps,
): Promise<AnalyzeAttachmentsResult> {
  const { accountLogin, uid, downloadTool, analyzer } = deps;

  const baseTmp = deps.tmpDir ?? os.tmpdir();
  const tmpDir = path.join(baseTmp, `email-helper-attachments-${Date.now()}-${process.pid}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  try {
    let result: DownloadResult;
    try {
      result = (await downloadTool.handler({
        login: accountLogin,
        uid,
        targetDir: tmpDir,
      })) as DownloadResult;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`ошибка скачивания вложений: ${msg}`, { cause: err });
    }

    if (!result.paths || result.paths.length === 0) {
      return { analysis: '', attachmentCount: 0, skipped: [] };
    }

    const extracted = [];
    for (const filePath of result.paths) {
      const r = await extractAttachmentText(filePath);
      extracted.push(r);
    }

    const supported = extracted.filter((e) => !e.skipped);
    const skipped = extracted.filter((e) => e.skipped);

    if (supported.length === 0) {
      return {
        analysis: '',
        attachmentCount: result.paths.length,
        skipped: skipped.map((s) => ({ filename: s.filename, reason: s.reason })),
      };
    }

    const parts: string[] = [
      'Проанализируй следующие вложения письма. Для каждого дай краткое саммари содержимого.',
      '',
    ];
    supported.forEach((e, i) => {
      parts.push(`--- Вложение ${i + 1}: ${e.filename} ---`);
      parts.push(e.text ?? '(текст недоступен)');
      parts.push('');
    });

    let analysis = '';
    let analysisError: string | undefined;
    try {
      analysis = await analyzer.run(parts.join('\n'));
    } catch (err) {
      // Анализатор упал — не роняем операцию: вложения скачаны, пропуски известны.
      // Вызывающая сторона рендерит ошибку и пропуски; tmp чистится в finally.
      analysisError = err instanceof Error ? err.message : String(err);
    }
    return {
      analysis,
      attachmentCount: result.paths.length,
      skipped: skipped.map((s) => ({ filename: s.filename, reason: s.reason })),
      ...(analysisError !== undefined ? { analysisError } : {}),
    };
  } finally {
    await cleanupDir(tmpDir);
  }
}

/** Рекурсивно удаляет каталог. */
async function cleanupDir(dir: string): Promise<void> {
  try {
    await fs.promises.rm(dir, { recursive: true, force: true });
  } catch {
    // Ошибка удаления tmp — не роняем операцию.
  }
}
