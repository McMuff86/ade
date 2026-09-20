import { createInstance, type i18n as I18nInstance, type TOptions } from 'i18next';
import { en } from './en';
import { de } from './de';
import { APP_LOCALES, DEFAULT_LOCALE, FALLBACK_LOCALE, isAppLocale, localeDefinition, type AppLocale } from './locales';

export type MessageKey = keyof typeof en;
export const i18n: I18nInstance = createInstance();
void i18n.init({
  lng: DEFAULT_LOCALE, fallbackLng: FALLBACK_LOCALE, supportedLngs: APP_LOCALES.map(locale => locale.id),
  resources: { en: { translation: en }, de: { translation: de } },
  initAsync: false, keySeparator: false, nsSeparator: false,
  interpolation: { escapeValue: false, skipOnVariables: true },
  returnNull: false, returnEmptyString: false,
});
export function currentLocale(): AppLocale { return isAppLocale(i18n.language) ? i18n.language : DEFAULT_LOCALE; }
export function changeLocale(locale: AppLocale): void { if (isAppLocale(locale)) void i18n.changeLanguage(locale); }
export function t(key: MessageKey, values?: TOptions): string { return i18n.t(key, values) as string; }
export function intlLocale(): string { return localeDefinition(currentLocale()).intl; }
export function formatNumber(value: number, options?: Intl.NumberFormatOptions): string { return new Intl.NumberFormat(intlLocale(), options).format(value); }
export function formatDate(value: Date | number, options?: Intl.DateTimeFormatOptions): string { return new Intl.DateTimeFormat(intlLocale(), options).format(value); }
