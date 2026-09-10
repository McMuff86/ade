import type { ProjectWorkspaceView } from './remote';
import { validProjectBranchRef } from './projectBranches';

export interface ProjectGitFile { path: string; index: string; working: string; conflict: boolean; selectable: boolean; notice: string | null }
export interface ProjectGitOverview {
  workspace: ProjectWorkspaceView; head: string | null; files: ProjectGitFile[]; refs: Array<{ ref: string; head: string }>;
  remotes: string[]; merge: boolean; blockedReason: string | null; revision: string; checkedAt: number; fetchedAt: number | null;
}
export type ProjectGitAction = { kind: 'commit'; paths: string[]; message: string }
  | { kind: 'fetch'; remote: string } | { kind: 'pull'; remote: string; ref: string }
  | { kind: 'merge'; ref: string } | { kind: 'resolve'; paths: string[] }
  | { kind: 'continue' | 'abort' };
export interface ProjectGitPreview {
  id: string; workspaceId: string; projectName: string; branch: string; head: string | null;
  action: ProjectGitAction; targetHead: string | null; affected: string[]; expiresAt: number;
}
export interface ProjectGitDiff { path: string; text: string; limited: boolean }
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const keys = (value: Record<string, unknown>, names: string[]) => Object.keys(value).length === names.length && names.every((key) => Object.hasOwn(value, key));
export const validProjectGitPath = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 400
  && !/[\\:\x00-\x1f\x7f]/.test(value) && !value.startsWith('/') && value.split('/').every((part) => !!part && part !== '.' && part !== '..');
export const validProjectRemote = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(value);
export function validProjectGitAction(value: unknown): value is ProjectGitAction {
  if (!object(value)) return false;
  const paths = () => Array.isArray(value.paths) && value.paths.length > 0 && value.paths.length <= 500
    && new Set(value.paths).size === value.paths.length && value.paths.every(validProjectGitPath);
  switch (value.kind) {
    case 'commit': return keys(value, ['kind', 'paths', 'message']) && paths() && typeof value.message === 'string'
      && !!value.message.trim() && value.message.length <= 2000 && !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value.message);
    case 'resolve': return keys(value, ['kind', 'paths']) && paths();
    case 'fetch': return keys(value, ['kind', 'remote']) && validProjectRemote(value.remote);
    case 'pull': return keys(value, ['kind', 'remote', 'ref']) && validProjectRemote(value.remote) && validProjectBranchRef(value.ref)
      && (value.ref as string).startsWith(`refs/remotes/${value.remote}/`);
    case 'merge': return keys(value, ['kind', 'ref']) && validProjectBranchRef(value.ref);
    case 'continue': case 'abort': return keys(value, ['kind']);
    default: return false;
  }
}
