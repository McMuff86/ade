/**
 * Proposes import targets for bundle repositories by looking at the clones in
 * one folder the user picked (typically their projects root).
 *
 * A proposal is only ever a pre-filled field: it still goes through target
 * authorization and the planner's repository probe, which re-checks the
 * clone and its origin. This module therefore optimises for "the obvious
 * clone is suggested" rather than for proof, and never suggests one clone for
 * two repositories.
 */

import { existsSync, lstatSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { normalizeRepositoryRemote } from './WorkspaceBundleExporter';
import { remoteIdentitiesMatch } from './WorkspaceImportPlanner';

export interface CloneCandidate {
  /** Bundle repository id. */
  sourceId: string;
  name: string;
  remoteIdentity?: string;
  /** Leaf folder name of the clone on the source host. */
  sourceLeafName?: string;
}

export interface LocalClone {
  path: string;
  leaf: string;
  /** Normalised origin identity, when the clone has a readable origin. */
  remoteIdentity?: string;
}

export interface CloneMatch {
  sourceId: string;
  path: string;
  /** `remote`: origin identities agree. `name`: folder name agrees and no origin contradicts it. */
  via: 'remote' | 'name';
}

/** Case-, space- and punctuation-insensitive: "Knuckles Pi" == "knuckles-pi". */
export function nameKey(value: string): string {
  return value.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

export function matchClones(candidates: readonly CloneCandidate[], clones: readonly LocalClone[]): CloneMatch[] {
  const matches: CloneMatch[] = [];
  const usedClones = new Set<string>();
  const matched = new Set<string>();

  // Pass 1: origin identity. Unambiguous by construction of the identity.
  for (const candidate of candidates) {
    if (!candidate.remoteIdentity) continue;
    // The planner's own comparison, so a proposal by origin is one it accepts.
    const clone = clones.find((item) => !usedClones.has(item.path)
      && item.remoteIdentity !== undefined && remoteIdentitiesMatch(item.remoteIdentity, candidate.remoteIdentity!));
    if (!clone) continue;
    matches.push({ sourceId: candidate.sourceId, path: clone.path, via: 'remote' });
    usedClones.add(clone.path);
    matched.add(candidate.sourceId);
  }

  // Pass 2: folder name, preferring the source's own leaf name over the
  // display name. A clone whose origin names a different repository is never
  // matched by name, and a name that fits several clones is left open rather
  // than guessed.
  for (const candidate of candidates) {
    if (matched.has(candidate.sourceId)) continue;
    const keys = [candidate.sourceLeafName, candidate.name].filter((key): key is string => Boolean(key)).map(nameKey);
    for (const key of keys) {
      const fits = clones.filter((clone) => !usedClones.has(clone.path)
        && nameKey(clone.leaf) === key
        && (!candidate.remoteIdentity || !clone.remoteIdentity
          || remoteIdentitiesMatch(clone.remoteIdentity, candidate.remoteIdentity)));
      if (fits.length !== 1) continue;
      matches.push({ sourceId: candidate.sourceId, path: fits[0]!.path, via: 'name' });
      usedClones.add(fits[0]!.path);
      matched.add(candidate.sourceId);
      break;
    }
  }
  return matches;
}

const MAX_SCANNED_ENTRIES = 500;

/**
 * The root itself and its direct children that are Git clones (a `.git`
 * directory, or a `.git` file for linked worktrees). Symlinks are skipped so
 * the scan cannot be steered outside the picked folder.
 */
export async function listClones(
  root: string,
  readOrigin: (path: string) => Promise<string | null>,
): Promise<LocalClone[]> {
  const isClone = (path: string): boolean => existsSync(join(path, '.git'));
  const paths: string[] = [];
  if (isClone(root)) paths.push(root);
  for (const entry of readdirSync(root, { withFileTypes: true }).slice(0, MAX_SCANNED_ENTRIES)) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const path = join(root, entry.name);
    if (lstatSync(path).isSymbolicLink()) continue;
    if (isClone(path)) paths.push(path);
  }
  return Promise.all(paths.map(async (path) => {
    const origin = await readOrigin(path).catch(() => null);
    const remoteIdentity = normalizeRepositoryRemote(origin);
    return {
      path,
      leaf: path.split(/[\\/]/).filter(Boolean).pop() ?? path,
      ...(remoteIdentity ? { remoteIdentity } : {}),
    };
  }));
}
