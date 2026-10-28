/**
 * Реализации почтовых провайдеров: Yandex, Outlook.
 */
export type { MailProvider, AuthStrategy } from '../mail-provider.js';
export { createMailProvider } from './factory.js';
export { YandexMailProvider } from './yandex.js';
export { OutlookMailProvider } from './outlook.js';