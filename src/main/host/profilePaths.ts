/**
 * Profile locations derived from one user-data directory (Goal 34.6, H1c).
 *
 * The desktop passes Electron's userData (honouring ADE_USER_DATA_DIR) once;
 * nothing below the host asks Electron for a path. The derivations are exactly
 * the ones each store used before, so the personal profile (~/.config/ade on
 * Linux) does not move; scripts/test-profile-paths.ts pins that.
 */
import { join } from 'node:path';
import type { ProfilePaths } from './ports';

export function profilePaths(userData: string): ProfilePaths {
  if (!userData) throw new Error('ade: the profile needs an explicit user-data directory');
  return { userData, profileDir: join(userData, 'ade') };
}

/** `<userData>/ade/config.json`, the catalog and run journal. */
export function configPath(paths: ProfilePaths): string {
  return join(paths.profileDir, 'config.json');
}

/** `<userData>/ade/photos`, served to the desktop as `ade-photo://`. */
export function photosDir(paths: ProfilePaths): string {
  return join(paths.profileDir, 'photos');
}
