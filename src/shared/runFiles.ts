import { validProjectGitPath } from './projectGit';

/** Main-owned digests, never file contents. Retained/pruned with their task. */
export interface RunFileSnapshot {
  capturedAt: number; workspaceVersion: string; limited: boolean;
  files: Array<{ path: string; bytes: number; sha256: string }>;
}
export interface RunFileTracking { before?: RunFileSnapshot; after?: RunFileSnapshot; notice: string | null }
export type RunFileChangeKind = 'created' | 'modified' | 'deleted' | 'reported' | 'unknown' | 'unchanged';
export interface RunFileChange { path: string; change: RunFileChangeKind; sha256?: string }
export interface RunFileChanges { files: RunFileChange[]; source: 'observed' | 'reported' | 'unknown'; limited: boolean; notice: string | null }

export function taskFileChanges(tracking: RunFileTracking | undefined, reported: string[] = []): RunFileChanges {
  const before = tracking?.before; const after = tracking?.after;
  if (!before || !after || before.workspaceVersion !== after.workspaceVersion) return { files: reported.slice(0, 100).map((path) => ({ path, change: 'reported' })),
    source: reported.length ? 'reported' : 'unknown', limited: reported.length > 100, notice: tracking?.notice ?? 'Kein vollständiger Vorher-/Nachher-Vergleich für diese frühere Aufgabe. Gemeldete Dateien sind keine unabhängig geprüfte Zuordnung.' };
  const old = new Map(before.files.map((file) => [file.path, file])); const current = new Map(after.files.map((file) => [file.path, file]));
  const files: RunFileChange[] = [];
  for (const file of after.files) { const prior = old.get(file.path);
    if (!prior) files.push({ path: file.path, change: before.limited ? 'unknown' : 'created', sha256: file.sha256 });
    else if (prior.sha256 !== file.sha256) files.push({ path: file.path, change: 'modified', sha256: file.sha256 });
  }
  if (!after.limited) for (const file of before.files) if (!current.has(file.path)) files.push({ path: file.path, change: 'deleted' });
  return { files, source: 'observed', limited: before.limited || after.limited,
    notice: tracking?.notice ?? 'Änderungen zwischen Aufgabenstart und Prozessende. Parallele Änderungen können enthalten sein; Downloads verwenden die aktuell vorhandene Datei.' };
}

export function validRunFileTracking(value: unknown): value is RunFileTracking {
  const obj = (input: unknown): input is Record<string, unknown> => !!input && typeof input === 'object' && !Array.isArray(input);
  const sha = (input: unknown) => typeof input === 'string' && /^[a-f0-9]{64}$/.test(input);
  if (!obj(value) || Object.keys(value).some((key) => !['before', 'after', 'notice'].includes(key)) || !(value.notice === null || typeof value.notice === 'string' && value.notice.length <= 500)) return false;
  return [value.before, value.after].every((snapshot) => snapshot === undefined || obj(snapshot)
    && Object.keys(snapshot).length === 4 && ['capturedAt', 'workspaceVersion', 'limited', 'files'].every((key) => Object.hasOwn(snapshot, key))
    && typeof snapshot.capturedAt === 'number' && Number.isFinite(snapshot.capturedAt) && sha(snapshot.workspaceVersion) && typeof snapshot.limited === 'boolean'
    && Array.isArray(snapshot.files) && snapshot.files.length <= 1000 && new Set(snapshot.files.map((file) => obj(file) ? file.path : undefined)).size === snapshot.files.length
    && snapshot.files.every((file) => obj(file) && Object.keys(file).length === 3 && validProjectGitPath(file.path) && sha(file.sha256)
      && Number.isSafeInteger(file.bytes) && Number(file.bytes) >= 0 && Number(file.bytes) <= 16 * 1024 * 1024));
}
