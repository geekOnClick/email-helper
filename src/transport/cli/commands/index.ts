/** Обработчики guided-команд (change guided-commands). */
export { runAnalyzeCommand, type AnalyzeCommandDeps } from './analyze.js';
export { runAnalyzeManyCommand, type AnalyzeManyCommandDeps } from './analyze-many.js';
export { runAnalyzeAttachmentsCommand, type AnalyzeAttachmentsCommandDeps } from './analyze-attachments.js';
export { runSmartSendCommand, type SmartSendCommandDeps } from './smart-send.js';
export { runSmartSearchCommand, type SmartSearchCommandDeps } from './smart-search.js';
export { ensureMailConnected } from './connect.js';
// shared-утилита批量-поиска (переиспользуется /analyze-many и тестами).
export {
  collectAllMessages,
  type CollectAllMessagesResult,
  type CollectAllMessagesOptions,
} from './search-aggregator.js';
