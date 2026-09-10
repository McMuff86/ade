import { validProjectRemote } from './projectGit';
import { validProjectBranchName } from './projectBranches';

export type ProjectPublishAction = { kind: 'push'; remote: string }
  | { kind: 'pr'; remote: string; base: string; title: string; body: string; draft: boolean };
export interface ProjectPullRequest { number: number; url: string; head: string; base: string; draft: boolean }
export interface ProjectPublishStatus {
  workspaceId: string; projectName: string; branch: string; head: string;
  remote: string; target: string; remoteHead: string | null; provider: string | null;
  pullRequests: ProjectPullRequest[]; providerNotice: string | null; checkedAt: number;
}
export interface ProjectPublishPreview {
  id: string; workspaceId: string; status: ProjectPublishStatus; action: ProjectPublishAction;
  baseHead: string | null; changedFiles: string[]; commitCount: number; expiresAt: number;
}
/** Receipt states what was observed at completion, never a continuing sync claim. */
export interface ProjectPublication {
  kind: 'push' | 'pr'; branch: string; head: string; target: string; url: string | null; confirmedAt: number;
}
export function validProjectPublishAction(value: unknown): value is ProjectPublishAction {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const input = value as Record<string, unknown>; if (!validProjectRemote(input.remote)) return false;
  const keys = input.kind === 'push' ? ['kind', 'remote'] : ['kind', 'remote', 'base', 'title', 'body', 'draft'];
  if (Object.keys(input).length !== keys.length || !keys.every((key) => Object.hasOwn(input, key))) return false;
  return input.kind === 'push' || input.kind === 'pr' && validProjectBranchName(input.base)
    && typeof input.title === 'string' && !!input.title.trim() && input.title.length <= 160 && !/[\x00-\x1f\x7f]/.test(input.title)
    && typeof input.body === 'string' && input.body.length <= 8000 && !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(input.body)
    && typeof input.draft === 'boolean';
}

/** A persisted preview is untrusted browser data; validate all fields the UI uses. */
export function validProjectPublishPreview(value: unknown): value is ProjectPublishPreview {
  const object = (item: unknown): item is Record<string, unknown> => !!item && typeof item === 'object' && !Array.isArray(item);
  const text = (item: unknown, max: number): item is string => typeof item === 'string' && item.length <= max;
  const sha = (item: unknown) => typeof item === 'string' && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(item);
  const id = (item: unknown) => typeof item === 'string' && /^[a-f0-9-]{36}$/.test(item);
  if (!object(value) || !id(value.id) || !id(value.workspaceId) || !validProjectPublishAction(value.action) || !object(value.status)) return false;
  const state = value.status;
  return state.workspaceId === value.workspaceId && text(state.projectName, 200) && validProjectBranchName(state.branch) && sha(state.head)
    && (state.remoteHead === null || sha(state.remoteHead)) && validProjectRemote(state.remote) && text(state.target, 400)
    && (state.provider === null || text(state.provider, 201)) && (state.providerNotice === null || text(state.providerNotice, 400))
    && typeof state.checkedAt === 'number' && Number.isFinite(state.checkedAt)
    && Array.isArray(state.pullRequests) && state.pullRequests.length < 20 && state.pullRequests.every((pr) => object(pr) && Number.isInteger(pr.number)
      && text(pr.url, 500) && /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+$/.test(pr.url) && sha(pr.head) && validProjectBranchName(pr.base) && typeof pr.draft === 'boolean')
    && (value.baseHead === null || sha(value.baseHead)) && Number.isSafeInteger(value.commitCount) && Number(value.commitCount) >= 0
    && typeof value.expiresAt === 'number' && Number.isFinite(value.expiresAt)
    && Array.isArray(value.changedFiles) && value.changedFiles.length <= 500 && value.changedFiles.every((path) => text(path, 400));
}
