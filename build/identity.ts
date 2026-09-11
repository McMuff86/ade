import { createHash } from 'node:crypto';
import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { MobileBuildInfo } from '../src/shared/remote';

/** Same source/dependency fingerprint in Electron and Mobile; never git paths or env values. */
export function buildIdentity(root = process.cwd(), now = new Date()): MobileBuildInfo {
  const paths = ['package.json', 'pnpm-lock.yaml', 'electron.vite.config.ts', 'vite.mobile.config.ts',
    'tsconfig.node.json', 'tsconfig.web.json', 'build/identity.ts'];
  const walk = (path: string) => {
    for (const entry of readdirSync(join(root, path), { withFileTypes: true })) {
      const child = `${path}/${entry.name}`;
      if (entry.isSymbolicLink()) throw new Error('Build inputs must not contain links');
      if (entry.isDirectory()) walk(child); else if (entry.isFile()) paths.push(child);
    }
  };
  if (lstatSync(resolve(root, 'src')).isSymbolicLink()) throw new Error('Build source must not be a link');
  walk('src');
  const digest = createHash('sha256');
  for (const path of paths.sort()) digest.update(path).update('\0').update(readFileSync(join(root, path))).update('\0');
  return { sourceId: digest.digest('hex').slice(0, 20), builtAt: now.toISOString() };
}
