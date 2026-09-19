/** Add languages here and provide their catalog; persisted values remain stable. */
export const APP_LOCALES = [
  { id: 'de', name: 'Deutsch', intl: 'de-CH', direction: 'ltr' },
  { id: 'en', name: 'English', intl: 'en-GB', direction: 'ltr' },
] as const;
export type AppLocale = typeof APP_LOCALES[number]['id'];
export const DEFAULT_LOCALE: AppLocale = 'de';
export const FALLBACK_LOCALE: AppLocale = 'en';
export const LANGUAGE_STORAGE_KEY = 'ade:language';
export function isAppLocale(value: unknown): value is AppLocale { return APP_LOCALES.some(locale => locale.id === value); }
export function localeDefinition(locale: AppLocale) { return APP_LOCALES.find(item => item.id === locale)!; }
