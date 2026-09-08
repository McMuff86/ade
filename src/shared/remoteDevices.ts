/** Desktop-only inventory. Device credentials never cross IPC or profile export. */
export interface RemoteDeviceInfo {
  id: string;
  name: string;
  createdAt: number;
  revokedAt: number | null;
}

export interface RemoteDeviceInventory {
  devices: RemoteDeviceInfo[];
  available: boolean;
  error: string | null;
}

export function isValidRemoteDeviceName(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length >= 1 && value.length <= 80 && !/[\x00-\x1f\x7f]/.test(value);
}
