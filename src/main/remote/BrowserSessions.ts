import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { MobilePairingChallenge } from '../../shared/mobileAccess';
import type { MobilePairInput, MobileSessionInfo } from '../../shared/remote';
import { isValidRemoteDeviceName } from '../../shared/remoteDevices';
import { RemoteApiError } from '../application/AdeApplicationService';
import { isValidDeviceId, isValidDeviceSecret, sha256Hex } from './authorization';
import type { RemoteDeviceStore } from './RemoteDeviceStore';

export const SESSION_COOKIE = '__Host-ade-session';
export const SESSION_TTL_MS = 30 * 60_000;
export const PAIRING_TTL_MS = 5 * 60_000;
const token = (): string => randomBytes(32).toString('base64url');
const same = (a: string, b: string): boolean => {
  const left = Buffer.from(a); const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};
interface Session extends MobileSessionInfo { digest: string }

/** All sessions/challenges die on host restart. Paired keys remain in the OS vault. */
export class BrowserSessions {
  private challenge: { digest: string; expiresAt: number } | null = null;
  private readonly sessions = new Map<string, Session>();
  private readonly unsubscribe: () => void;
  private readonly expiryListeners = new Set<(digest: string) => void>();

  constructor(private readonly devices: RemoteDeviceStore, private readonly now = (): number => Date.now()) {
    this.unsubscribe = devices.onRevoked((id) => {
      for (const [digest, session] of this.sessions) if (id === null || session.deviceId === id) this.remove(digest);
      if (id === null) this.challenge = null;
    });
  }

  beginPairing(origin: string): MobilePairingChallenge {
    if (!this.devices.inventory().available) throw new Error('ade: secure device storage unavailable');
    const code = token();
    const expiresAt = this.now() + PAIRING_TTL_MS;
    this.audit('desktop', 'pairing:begin');
    this.challenge = { digest: sha256Hex(code), expiresAt };
    return { url: `${origin}/#pair=${code}`, code, expiresAt };
  }

  cancelPairing(): void { this.challenge = null; }

  pair(payload: unknown): { info: MobileSessionInfo; cookie: string } {
    const input = payload as MobilePairInput;
    if (!input || typeof input !== 'object' || Array.isArray(input)
      || Object.keys(input).sort().join(',') !== 'challenge,deviceId,name,secret'
      || typeof input.challenge !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(input.challenge)
      || typeof input.deviceId !== 'string' || !isValidDeviceId(input.deviceId)
      || typeof input.secret !== 'string' || !isValidDeviceSecret(input.secret)
      || !isValidRemoteDeviceName(input.name)) throw new RemoteApiError(400, 'invalid_payload', 'Invalid pairing request');
    if (!this.challenge || this.challenge.expiresAt <= this.now()
      || !same(this.challenge.digest, sha256Hex(input.challenge))) {
      throw new RemoteApiError(401, 'pairing_expired', 'Start a new pairing on the desktop');
    }
    // Consume synchronously before persistence so parallel/replayed requests cannot enroll twice.
    this.challenge = null;
    this.devices.enroll(input.deviceId, input.name, input.secret);
    return this.issue(input.deviceId);
  }

  issue(deviceId: string, previousCookie?: string): { info: MobileSessionInfo; cookie: string } {
    if (!this.devices.activeDevices().some((device) => device.id === deviceId)) {
      throw new RemoteApiError(401, 'unknown_device', 'Pair this device again');
    }
    this.prune();
    this.audit(deviceId, 'session:authenticate');
    const previous = this.get(previousCookie, deviceId);
    if (previous) this.remove(previous.digest);
    // Bound sessions per device as well as globally (separate browser tabs share cookies).
    for (const [digest, session] of this.sessions) if (session.deviceId === deviceId) this.remove(digest);
    if (this.sessions.size >= 100) throw new RemoteApiError(429, 'rate_limited', 'Session limit reached');
    const value = token();
    const session: Session = { digest: sha256Hex(value), deviceId, csrf: token(), expiresAt: this.now() + SESSION_TTL_MS };
    this.sessions.set(session.digest, session);
    return { info: this.info(session), cookie: `${SESSION_COOKIE}=${value}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${SESSION_TTL_MS / 1000}` };
  }

  get(cookie: string | undefined, deviceId: string): Session | null {
    this.prune();
    if (!cookie || cookie.length > 4096) return null;
    const values = cookie.split(';').map((part) => part.trim()).filter((part) => part.startsWith(`${SESSION_COOKIE}=`));
    if (values.length !== 1) return null;
    const value = values[0]!.slice(SESSION_COOKIE.length + 1);
    if (!/^[A-Za-z0-9_-]{43}$/.test(value)) return null;
    const session = this.sessions.get(sha256Hex(value));
    if (!session || session.deviceId !== deviceId || !this.devices.activeDevices().some((device) => device.id === deviceId)) return null;
    return session;
  }

  info(session: Session): MobileSessionInfo {
    return { deviceId: session.deviceId, csrf: session.csrf, expiresAt: session.expiresAt };
  }

  requireCsrf(session: Session, csrf: string | undefined): void {
    if (!csrf || !same(session.csrf, csrf)) throw new RemoteApiError(403, 'csrf_required', 'Session confirmation required');
  }

  logout(session: Session): string {
    this.audit(session.deviceId, 'session:logout');
    this.remove(session.digest);
    return `${SESSION_COOKIE}=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0`;
  }

  onExpired(listener: (digest: string) => void): () => void {
    this.expiryListeners.add(listener);
    return () => { this.expiryListeners.delete(listener); };
  }

  dispose(): void {
    this.unsubscribe();
    this.challenge = null;
    for (const digest of this.sessions.keys()) this.remove(digest);
  }

  private remove(digest: string): void {
    this.sessions.delete(digest);
    for (const listener of this.expiryListeners) listener(digest);
  }
  private prune(): void {
    for (const [digest, session] of this.sessions) if (session.expiresAt <= this.now()) this.remove(digest);
  }
  private audit(id: string, channel: string): void {
    this.devices.audit({ at: this.now(), principalId: id, principalKind: id === 'desktop' ? 'desktop' : 'device',
      channel, requestId: randomUUID(), target: null, outcome: 'authenticated' });
  }
}
