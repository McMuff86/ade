import type { ProjectWorkspaceCommand, ProjectWorkspaceQuery } from './remote';
import { validProjectBranchAction } from './projectBranches';
import { validProjectGitAction, validProjectGitPath } from './projectGit';
import { validProjectRemote } from './projectGit';
import { validProjectPublishAction } from './projectPublish';

const workspaceId = (value: unknown): boolean => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
export const validWorkspaceSelection = (input: Record<string, unknown>): boolean =>
  input.projectWorkspaceId !== undefined
    ? workspaceId(input.projectWorkspaceId) && !Object.hasOwn(input, 'agentId') && !Object.hasOwn(input, 'repositoryId')
    : typeof input.agentId === 'string' && /^[A-Za-z0-9_.:-]{1,128}$/.test(input.agentId)
      && (input.repositoryId === null || typeof input.repositoryId === 'string' && /^[A-Za-z0-9_.:-]{1,128}$/.test(input.repositoryId));
function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
function keys(value: Record<string, unknown>, expected: string[]): boolean {
  return Object.keys(value).length === expected.length && expected.every((key) => Object.hasOwn(value, key));
}
export function validProjectWorkspaceQuery(value: unknown): value is ProjectWorkspaceQuery {
  const input = object(value); if (!input) return false;
  return input.operation === 'directory' ? keys(input, ['operation'])
    : input.operation === 'publish-status' ? keys(input, ['operation', 'workspaceId', 'remote']) && workspaceId(input.workspaceId) && validProjectRemote(input.remote)
    : input.operation === 'publish-preview' ? keys(input, ['operation', 'workspaceId', 'action']) && workspaceId(input.workspaceId) && validProjectPublishAction(input.action)
    : input.operation === 'git-preview' ? keys(input, ['operation', 'workspaceId', 'action']) && workspaceId(input.workspaceId) && validProjectGitAction(input.action)
      : input.operation === 'git-diff' ? keys(input, ['operation', 'workspaceId', 'path']) && workspaceId(input.workspaceId) && validProjectGitPath(input.path)
    : input.operation === 'branch-preview' ? keys(input, ['operation', 'workspaceId', 'action']) && workspaceId(input.workspaceId) && validProjectBranchAction(input.action)
      : ['workspace', 'branches', 'git'].includes(String(input.operation)) && keys(input, ['operation', 'workspaceId']) && workspaceId(input.workspaceId);
}
export function validProjectWorkspaceCommand(value: unknown): value is ProjectWorkspaceCommand {
  const input = object(value); if (!input) return false;
  return input.operation === 'branch-apply' || input.operation === 'git-apply' || input.operation === 'publish-apply' ? keys(input, ['operation', 'previewId']) && workspaceId(input.previewId)
    : input.operation === 'open' && keys(input, ['operation', 'entryId']) && typeof input.entryId === 'string' && /^p[a-f0-9]{32}$/.test(input.entryId);
}
