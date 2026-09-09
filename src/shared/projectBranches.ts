import type { ProjectWorkspaceView } from './remote';

/** No host paths; remote refs describe the last locally fetched state. */
export interface ProjectBranch {
  ref: string; name: string; kind: 'local' | 'remote'; head: string;
  current: boolean; worktreeId: string | null;
}
export interface ProjectWorktree {
  id: string; name: string; branch: string; current: boolean; available: boolean; notice: string | null;
}
export interface ProjectBranchOverview {
  workspace: ProjectWorkspaceView; head: string | null; branches: ProjectBranch[]; worktrees: ProjectWorktree[];
  dirty: boolean; blockedReason: string | null; revision: string; checkedAt: number;
}
export type ProjectBranchAction =
  | { kind: 'switch'; ref: string }
  | { kind: 'create'; name: string; baseRef: string | null; separate: boolean }
  | { kind: 'open-worktree'; worktreeId: string };
export interface ProjectBranchPreview {
  id: string; expiresAt: number; workspaceId: string; projectName: string;
  fromBranch: string; toBranch: string; separate: boolean; action: ProjectBranchAction;
}
export function validProjectBranchName(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 200 && value !== 'HEAD' && value !== '@'
    && !value.startsWith('-') && !value.endsWith('.') && !/[\s\x00-\x1f\x7f~^:?*\[\\]/.test(value)
    && !value.includes('..') && !value.includes('@{') && value.split('/').every((part) => part.length > 0 && !part.startsWith('.') && !part.endsWith('.lock'));
}
export function validProjectBranchRef(value: unknown): value is string {
  return typeof value === 'string' && /^(refs\/heads\/|refs\/remotes\/)/.test(value)
    && validProjectBranchName(value.replace(/^refs\/(heads|remotes)\//, ''));
}
export function validProjectBranchAction(value: unknown): value is ProjectBranchAction {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>; const exact = (names: string[]) => Object.keys(item).length === names.length && names.every((name) => Object.hasOwn(item, name));
  if (item.kind === 'switch') return exact(['kind', 'ref']) && validProjectBranchRef(item.ref);
  if (item.kind === 'create') return exact(['kind', 'name', 'baseRef', 'separate']) && validProjectBranchName(item.name)
    && (item.baseRef === null || validProjectBranchRef(item.baseRef)) && typeof item.separate === 'boolean';
  return item.kind === 'open-worktree' && exact(['kind', 'worktreeId']) && typeof item.worktreeId === 'string' && /^w[a-f0-9]{32}$/.test(item.worktreeId);
}
