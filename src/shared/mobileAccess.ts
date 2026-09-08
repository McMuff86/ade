/** Trusted desktop controls. Pairing material is short-lived and never logged. */
export interface MobileAccessStatus {
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
