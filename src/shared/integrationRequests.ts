import type { IntegrationCommand, IntegrationQuery } from './remote';
import { validProjectGitPath } from './projectGit';

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const exact = (value: Record<string, unknown>, fields: string[]) => Object.keys(value).length === fields.length && fields.every((field) => Object.hasOwn(value, field));
const id = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/.test(value);
export function validIntegrationQuery(value: unknown): value is IntegrationQuery {
  if (!record(value)) return false;
  switch (value.operation) {
    case 'diff': return exact(value, ['operation', 'previewId', 'path']) && id(value.previewId) && validProjectGitPath(value.path);
    case 'sources': return exact(value, ['operation', 'repositoryId']) && id(value.repositoryId);
    case 'preview': return exact(value, ['operation', 'repositoryId', 'sourceId']) && id(value.repositoryId) && id(value.sourceId);
    case 'report': return exact(value, ['operation', 'integrationId']) && id(value.integrationId);
    default: return false;
  }
}
export function validIntegrationCommand(value: unknown): value is IntegrationCommand {
  if (!record(value)) return false;
  switch (value.operation) {
    case 'prepare': return exact(value, ['operation', 'previewId', 'paths']) && id(value.previewId)
      && Array.isArray(value.paths) && value.paths.length > 0 && value.paths.length <= 200
      && new Set(value.paths).size === value.paths.length && value.paths.every(validProjectGitPath);
    case 'test': return exact(value, ['operation', 'integrationId']) && id(value.integrationId);
    case 'integrate': return exact(value, ['operation', 'integrationId', 'revision', 'message']) && id(value.integrationId)
      && typeof value.revision === 'string' && /^[a-f0-9]{64}$/.test(value.revision)
      && typeof value.message === 'string' && value.message.trim().length > 0 && value.message.length <= 2000
      && !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value.message);
    default: return false;
  }
}
