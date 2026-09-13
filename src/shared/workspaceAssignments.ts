import type { WorkspaceAssignmentCommand, WorkspaceAssignmentQuery } from './remote';
const id = (value: unknown) => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,128}$/.test(value);
export function validAssignmentRequest(value: unknown, command: boolean): value is WorkspaceAssignmentQuery | WorkspaceAssignmentCommand {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const input = value as Record<string, unknown>;
  const keys = command ? ['agentId', 'previewId'] : input.operation === 'project-preview' ? ['operation', 'agentId', 'entryId']
    : ['operation', 'agentId', 'repositoryId', ...(input.operation === 'preview' ? ['candidateId'] : [])];
  return Object.keys(input).length === keys.length && keys.every((key) => Object.hasOwn(input, key)) && id(input.agentId)
    && (command ? typeof input.previewId === 'string' && /^[a-f0-9-]{36}$/.test(input.previewId)
      : input.operation === 'project-preview' ? typeof input.entryId === 'string' && /^p[a-f0-9]{32}$/.test(input.entryId)
        : id(input.repositoryId) && (input.operation === 'overview' || input.operation === 'preview'
          && (input.candidateId === 'ade' || typeof input.candidateId === 'string' && /^w[a-f0-9]{32}$/.test(input.candidateId))));
}
