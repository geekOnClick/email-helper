/**
 * Реэкспорт чистых доменных функций команд (change web-interface, design D1).
 *
 * Transport-агностичный слой: каждая команда выделена в чистую функцию, принимающую
 * DTO и возвращающую структурированный результат. CLI-обработчики и веб-API
 * вызывают эти функции, не дублируя логику.
 */
export { runSmartSearch } from './smart-search.js';
export type { SmartSearchDeps, SmartSearchResult, ParsedCriteria } from './smart-search.js';

export { runAnalyze } from './analyze.js';
export type { AnalyzeDeps, AnalyzeResult } from './analyze.js';

export { runAnalyzeMany } from './analyze-many.js';
export type { AnalyzeManyDeps, AnalyzeManyResult } from './analyze-many.js';

export { runAnalyzeAttachments } from './analyze-attachments.js';
export type { AnalyzeAttachmentsDeps, AnalyzeAttachmentsResult } from './analyze-attachments.js';

export { generateSmartSendBody, sendSmartSend } from './smart-send.js';
export type {
  GenerateSendBodyDeps,
  SendEmailDeps,
  SendEmailResult,
} from './smart-send.js';

export { saveAccount } from './add-account.js';
export type { SaveAccountDeps, SaveAccountResult } from './add-account.js';

export { fetchEmail } from './fetch-email.js';
export type { FetchEmailDeps } from './fetch-email.js';
