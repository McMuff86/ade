/** Stable libraries cache independently of ADE UI changes. Keep main/preload untouched. */
export function browserChunks(id: string): string | undefined {
  const path = id.replace(/\\/g, '/');
  if (path.endsWith('/shared/i18n/messages.de.ts')) return 'locale-de';
  if (path.endsWith('/shared/i18n/messages.en.ts')) return 'locale-en';
  if (!path.includes('/node_modules/')) return;
  if (/\/node_modules\/(?:i18next|react-i18next)\//.test(path)) return 'language';
  if (/\/node_modules\/(?:react|react-dom|scheduler)\//.test(path)) return 'react';
  if (/\/node_modules\/@xterm\//.test(path)) return 'terminal';
}
