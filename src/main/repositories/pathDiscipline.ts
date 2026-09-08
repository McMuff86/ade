import { lstatSync } from 'node:fs';
import { join, parse, resolve } from 'node:path';

/** Check every existing component; future components are permitted for creation. */
export function assertNoLinks(file: string): void {
  const absolute = resolve(file); let current = parse(absolute).root;
  for (const part of absolute.slice(current.length).split(/[\\/]/).filter(Boolean)) {
    current = join(current, part);
    try { if (lstatSync(current).isSymbolicLink()) throw new Error('ade: Pfad enthält eine Verknüpfung oder Umleitung.'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
}
