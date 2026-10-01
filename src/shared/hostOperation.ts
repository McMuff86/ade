/** Local desktop preferences, never remotely writable or portable. */
export interface HostOperationPreferences { keepAwake: boolean; keepInTray: boolean }
export type HostOperationChange = { setting: 'autostart' | 'keepAwake' | 'keepInTray'; enabled: boolean };
export interface HostOperationStatus extends HostOperationPreferences {
  autostart: boolean;
  autostartSupported: boolean;
  autostartError: string | null;
  activeSessions: number;
  sleepPrevention: 'off' | 'idle' | 'requested' | 'error';
}
