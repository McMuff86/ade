import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface MobileAsset { body: Buffer; contentType: string }
const TYPES: Record<string, string> = { html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8', webmanifest: 'application/manifest+json', svg: 'image/svg+xml', png: 'image/png' };

/** Read the public build once into a bounded exact-path allowlist; never serve arbitrary disk paths. */
export function loadMobileAssets(root: string): ReadonlyMap<string, MobileAsset> {
  const assets = new Map<string, MobileAsset>();
  let total = 0;
  const walk = (dir: string, prefix: string): void => {
    if (lstatSync(dir).isSymbolicLink()) throw new Error('ade: mobile assets refuse links');
    for (const item of readdirSync(dir, { withFileTypes: true })) {
      if (item.isSymbolicLink()) throw new Error('ade: mobile assets refuse links');
      if (item.isDirectory() && !prefix) { walk(join(dir, item.name), `/${item.name}`); continue; }
      if (!item.isFile()) continue;
      const type = TYPES[item.name.split('.').at(-1) ?? ''];
      if (!type) continue;
      const file = join(dir, item.name);
      const size = lstatSync(file).size;
      total += size;
      if (size > 2 * 1024 * 1024 || total > 8 * 1024 * 1024 || assets.size >= 100) throw new Error('ade: mobile asset bound exceeded');
      assets.set(`${prefix}/${item.name}`, { body: readFileSync(file), contentType: type });
    }
  };
  walk(root, '');
  const index = assets.get('/index.html');
  if (!index || !assets.has('/sw.js')) throw new Error('ade: mobile build unavailable; run pnpm build');
  assets.set('/', index);
  return assets;
}
