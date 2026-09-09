import type { ProjectWorkspaceCommand, ProjectWorkspaceQuery } from './remote';

const workspaceId = (value: unknown): boolean => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
function keys(value: Record<string, unknown>, expected: string[]): boolean {
  return Object.keys(value).length === expected.length && expected.every((key) => Object.hasOwn(value, key));
}
export function validProjectWorkspaceQuery(value: unknown): value is ProjectWorkspaceQuery {
  const input = object(value); if (!input) return false;
  return input.operation === 'directory' ? keys(input, ['operation'])
    : input.operation === 'workspace' && keys(input, ['operation', 'workspaceId']) && workspaceId(input.workspaceId);
}
export function validProjectWorkspaceCommand(value: unknown): value is ProjectWorkspaceCommand {
  const input = object(value); if (!input) return false;
  return input.operation === 'open' && keys(input, ['operation', 'entryId']) && typeof input.entryId === 'string' && /^p[a-f0-9]{32}$/.test(input.entryId);
}
