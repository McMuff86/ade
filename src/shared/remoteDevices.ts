export const REMOTE_ADMIN_SCOPES = ['host:restart', 'catalog:write', 'repositories:write', 'workspace:read', 'terminal:control', 'workspace:write', 'profiles:write', 'projects:write', 'projectGit:write', 'projectGit:publish'] as const;
export type RemoteAdminScope = typeof REMOTE_ADMIN_SCOPES[number];

/** Omitted on older devices means the existing whole-catalog grant. */
export type DeviceResourceAccess = { mode: 'all' } | { mode: 'selected'; repositoryIds: string[]; agentIds: string[] };
export function isDeviceResourceAccess(value: unknown): value is DeviceResourceAccess {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  if (item.mode === 'all') return Object.keys(item).length === 1;
  const ids = (list: unknown, cap: number): boolean => Array.isArray(list) && list.length <= cap
    && new Set(list).size === list.length && list.every((id) => typeof id === 'string' && /^[A-Za-z0-9_.:-]{1,128}$/.test(id));
  return item.mode === 'selected' && Object.keys(item).every((key) => ['mode', 'repositoryIds', 'agentIds'].includes(key))
    && ids(item.repositoryIds, 500) && ids(item.agentIds, 500);
}
export function isRemoteAdminScopes(value: unknown): value is RemoteAdminScope[] {
  return Array.isArray(value) && value.length <= REMOTE_ADMIN_SCOPES.length
    && new Set(value).size === value.length
    && value.every((scope) => (REMOTE_ADMIN_SCOPES as readonly unknown[]).includes(scope));
}

/** Desktop-only inventory. Device credentials never cross IPC or profile export. */
export interface RemoteDeviceInfo {
  id: string;
  name: string;
  createdAt: number;
  revokedAt: number | null;
  /** Missing on old stores: no administrative permissions. Granted only at the desktop. */
  adminScopes?: RemoteAdminScope[];
  resourceAccess?: DeviceResourceAccess;
}

export interface RemoteDeviceInventory {
  devices: RemoteDeviceInfo[];
  available: boolean;
  error: string | null;
}

export function isValidRemoteDeviceName(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length >= 1 && value.length <= 80 && !/[\x00-\x1f\x7f]/.test(value);
}
