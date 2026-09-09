export const REMOTE_ADMIN_SCOPES = ['host:restart', 'catalog:write', 'repositories:write', 'workspace:read', 'terminal:control', 'workspace:write', 'profiles:write', 'projects:write'] as const;
export type RemoteAdminScope = typeof REMOTE_ADMIN_SCOPES[number];
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
}

export interface RemoteDeviceInventory {
  devices: RemoteDeviceInfo[];
  available: boolean;
  error: string | null;
}

export function isValidRemoteDeviceName(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length >= 1 && value.length <= 80 && !/[\x00-\x1f\x7f]/.test(value);
}
