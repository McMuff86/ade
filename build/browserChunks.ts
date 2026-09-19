/** Stable libraries cache independently of ADE UI changes. Keep main/preload untouched. */
export function browserChunks(id: string): string | undefined {
  const path = id.replace(/\\/g, '/');
  if (!path.includes('/node_modules/')) return;
  if (/\/node_modules\/(?:react|react-dom|scheduler)\//.test(path)) return 'react';
  if (/\/node_modules\/@xterm\//.test(path)) return 'terminal';
}
