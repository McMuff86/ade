/** Trusted desktop controls. Pairing material is short-lived and never logged. */
export const MOBILE_HTTPS_PORTS = [443, 8443, 10000] as const;
export type MobileHttpsPort = typeof MOBILE_HTTPS_PORTS[number];
export function isMobileHttpsPort(value: unknown): value is MobileHttpsPort {
  return MOBILE_HTTPS_PORTS.some(port => port === value);
}

export interface MobileAccessStatus {
  httpsPort: MobileHttpsPort;
  enabled: boolean;
  listening: boolean;
  https: 'pending' | 'verified' | 'unreachable';
  url: string | null;
  tailscale: 'ready' | 'offline' | 'missing' | 'conflict' | 'unavailable';
  message: string;
}

export interface MobilePairingChallenge {
  url: string;
  code: string;
  expiresAt: number;
}
