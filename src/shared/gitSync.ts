import type { ExecutionBackendId } from './executionBackends';

/** Path-free desktop contract, suitable for a future explicit mobile read projection. */
export interface GitSyncTarget {
  id: string;
  name: string;
  kind: 'repository' | 'agent';
  branch: string;
  headSha: string | null;
  changedFiles: number | null;
  ahead: number | null;
  behind: number | null;
  blockedReason: string | null;
}
export interface GitSyncOverview {
  repositoryId: string;
  repositoryName: string;
  executionBackend: ExecutionBackendId;
  checkedAt: number;
  remoteCheckedAt: number | null;
  sourceRef: string;
  sourceSha: string;
  refs: Array<{ ref: string; label: string }>;
  targets: GitSyncTarget[];
}
export interface GitSyncPreview {
  id: string;
  expiresAt: number;
  overview: GitSyncOverview;
  target: GitSyncTarget;
}
export interface GitSyncRequest { repositoryId: string; sourceRef?: string }

export function validSyncRef(value: string): boolean {
  return value.length <= 300 && /^(refs\/heads\/|refs\/remotes\/origin\/)[^\s\x00-\x1f\x7f]+$/.test(value)
    && !value.includes('..') && !/[~^:?*\[\\]/.test(value) && !value.includes('@{');
}
