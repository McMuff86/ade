import './language.css';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { changeLocale, currentLocale, i18n, t } from '../../shared/i18n';
import { APP_LOCALES, DEFAULT_LOCALE, isAppLocale, LANGUAGE_STORAGE_KEY, localeDefinition, type AppLocale } from '../../shared/i18n/locales';

export function useLocale(): AppLocale { useTranslation(undefined, { i18n }); return currentLocale(); }
export function applyBrowserLocale(locale: AppLocale): boolean {
  changeLocale(locale); document.documentElement.lang = locale; document.documentElement.dir = localeDefinition(locale).direction;
  try { localStorage.setItem(LANGUAGE_STORAGE_KEY, locale); return true; } catch { return false; }
}
export function initializeBrowserLocale(): void {
  let locale: AppLocale = DEFAULT_LOCALE;
  try { const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY); if (isAppLocale(stored)) locale = stored; } catch { /* Session-only preference. */ }
  changeLocale(locale); document.documentElement.lang = locale; document.documentElement.dir = localeDefinition(locale).direction;
  window.addEventListener('storage', event => { if (event.key === LANGUAGE_STORAGE_KEY && isAppLocale(event.newValue)) {
    changeLocale(event.newValue); document.documentElement.lang = event.newValue; document.documentElement.dir = localeDefinition(event.newValue).direction;
  } });
}

/** Does not reload or remount the application; open editors and terminals retain state. */
export function LanguageSetting({ desktop = false }: { desktop?: boolean }) {
  const language = useLocale(); const [error, setError] = useState('');
  const select = async (value: string) => {
    if (!isAppLocale(value)) return;
    const saved = applyBrowserLocale(value); setError(saved ? '' : t('language.storageUnavailable'));
    if (desktop) try { await window.ade.invoke('config:save', { settings: { language: value } }); }
    catch { setError(t('language.savedLocally')); }
  };
  return <section className="ade-language-setting"><label>{t('language.title')}
    <select aria-label={t('language.title')} value={language} onChange={event => void select(event.target.value)}>
      {APP_LOCALES.map(locale => <option key={locale.id} value={locale.id} lang={locale.id}>{locale.name}</option>)}
    </select></label><p>{t('language.description')}</p>{error && <p role="status">{error}</p>}
  </section>;
}
