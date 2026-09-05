/**
 * Remote authorization primitives for the Goal 7 host API. Pure module (no
 * Electron, no HTTP) so the contract tests exercise it directly and the
 * application service can enforce channel requirements transport-neutrally.
 *
 * Two layers, deliberately separate:
 * - Authentication of the listener client: the bearer token. It yields the
 *   `bootstrap-token` principal with the `read` scope only.
 * - Authorization of a command: a device principal proves possession of a
 *   device secret per request (HMAC over method, path, timestamp, idempotency
 *   key and body digest). Only device principals can hold `runs:write`.
 *
 * In this slice the single device comes from `ADE_HOST_API_COMMAND_DEVICE`
 * at startup; Goal 8 replaces that bootstrap with the paired, revocable
 * device store without changing the verification contract below.
 */

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { RemoteScope } from '../ipcPolicy';

export const REMOTE_SIGNATURE_VERSION = 'v1';
export const REMOTE_SIGNATURE_PREAMBLE = 'ADE-HTTP-V1';
/** Accepted clock skew between the client timestamp and the host, in ms. */
export const REMOTE_TIMESTAMP_WINDOW_MS = 5 * 60 * 1_000;
export const MIN_IDEMPOTENCY_KEY_CHARS = 8;
export const MAX_IDEMPOTENCY_KEY_CHARS = 64;
export const MIN_DEVICE_SECRET_CHARS = 32;
export const MAX_DEVICE_SECRET_CHARS = 128;
export const MAX_DEVICE_ID_CHARS = 64;

const URL_SAFE = /^[A-Za-z0-9_-]+$/;
const HEX_64 = /^[0-9a-f]{64}$/;

export type RemotePrincipalKind = 'bootstrap-token' | 'device';

export interface RemotePrincipal {
  /** Stable, path-free identifier for audit lines. */
  id: string;
  kind: RemotePrincipalKind;
  scopes: ReadonlySet<RemoteScope>;
  /** Strongest proof this principal presented for the current request. */
  proof: 'bearer' | 'device-signature';
}

export interface RemoteDevice {
  id: string;
  secret: string;
  scopes: readonly RemoteScope[];
}

export interface SignedRequest {
  method: string;
  path: string;
  timestamp: string;
  idempotencyKey: string;
  bodySha256: string;
}

export type SignatureVerdict =
  | { ok: true; principal: RemotePrincipal }
  | { ok: false; reason: 'unknown_device' | 'invalid_timestamp' | 'stale_timestamp' | 'invalid_signature' };

export function isValidDeviceId(value: string): boolean {
  return value.length >= 1 && value.length <= MAX_DEVICE_ID_CHARS && URL_SAFE.test(value);
}

export function isValidDeviceSecret(value: string): boolean {
  return value.length >= MIN_DEVICE_SECRET_CHARS
    && value.length <= MAX_DEVICE_SECRET_CHARS
    && URL_SAFE.test(value);
}

export function isValidIdempotencyKey(value: string): boolean {
  return value.length >= MIN_IDEMPOTENCY_KEY_CHARS
    && value.length <= MAX_IDEMPOTENCY_KEY_CHARS
    && URL_SAFE.test(value);
}

/** `<id>:<secret>` as accepted from the startup environment. */
export function parseCommandDevice(value: string | undefined): RemoteDevice | null {
  if (value === undefined || value === '') return null;
  const separator = value.indexOf(':');
  if (separator <= 0) {
    throw new Error('ade: host API command device must have the form <device-id>:<device-secret>');
  }
  const id = value.slice(0, separator);
  const secret = value.slice(separator + 1);
  if (!isValidDeviceId(id)) {
    throw new Error(`ade: host API device id must be 1-${MAX_DEVICE_ID_CHARS} URL-safe ASCII characters`);
  }
  if (!isValidDeviceSecret(secret)) {
    throw new Error(
      `ade: host API device secret must be ${MIN_DEVICE_SECRET_CHARS}-${MAX_DEVICE_SECRET_CHARS} URL-safe ASCII characters`,
    );
  }
  return { id, secret, scopes: ['read', 'runs:write'] };
}

export function sha256Hex(body: Buffer | string): string {
  return createHash('sha256').update(body).digest('hex');
}

/** Canonical string every party signs; newline-separated, no trailing newline. */
export function signingString(request: SignedRequest): string {
  return [
    REMOTE_SIGNATURE_PREAMBLE,
    request.method.toUpperCase(),
    request.path,
    request.timestamp,
    request.idempotencyKey,
    request.bodySha256,
  ].join('\n');
}

export function signRequest(secret: string, request: SignedRequest): string {
  const digest = createHmac('sha256', secret).update(signingString(request)).digest('hex');
  return `${REMOTE_SIGNATURE_VERSION}=${digest}`;
}

function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}

export const BOOTSTRAP_PRINCIPAL: RemotePrincipal = {
  id: 'bootstrap-token',
  kind: 'bootstrap-token',
  scopes: new Set<RemoteScope>(['read']),
  proof: 'bearer',
};

/**
 * Holds the listener token and the configured devices. Nothing here reads the
 * environment; the composition root passes consumed values in.
 */
export class RemoteAuthorizer {
  private readonly devices: ReadonlyMap<string, RemoteDevice>;

  constructor(
    private readonly bearerToken: string,
    devices: readonly RemoteDevice[] = [],
    private readonly now: () => number = () => Date.now(),
  ) {
    const map = new Map<string, RemoteDevice>();
    for (const device of devices) {
      if (map.has(device.id)) throw new Error(`ade: duplicate host API device id "${device.id}"`);
      map.set(device.id, device);
    }
    this.devices = map;
  }

  /** How many device identities may currently authorize commands. */
  deviceCount(): number {
    return this.devices.size;
  }

  /** Bearer header → bootstrap principal, or null when the token is wrong. */
  authenticateBearer(header: string | undefined): RemotePrincipal | null {
    if (!header) return null;
    return constantTimeEquals(header, `Bearer ${this.bearerToken}`) ? BOOTSTRAP_PRINCIPAL : null;
  }

  /**
   * Verify a per-request device signature. The timestamp must be an integer
   * millisecond epoch inside the skew window, the body digest must be the
   * hex SHA-256 the server computed itself, and the signature must match the
   * device secret over the canonical string.
   */
  verifyDeviceSignature(
    deviceId: string,
    signature: string,
    request: SignedRequest,
  ): SignatureVerdict {
    const device = this.devices.get(deviceId);
    // Unknown device: still run the HMAC against a fixed secret so timing
    // does not reveal whether an id exists.
    const secret = device?.secret ?? `${'0'.repeat(MIN_DEVICE_SECRET_CHARS)}`;
    if (!/^\d{1,16}$/.test(request.timestamp)) return this.deny(device, 'invalid_timestamp');
    const timestamp = Number(request.timestamp);
    if (Math.abs(this.now() - timestamp) > REMOTE_TIMESTAMP_WINDOW_MS) {
      return this.deny(device, 'stale_timestamp');
    }
    if (!HEX_64.test(request.bodySha256)) return this.deny(device, 'invalid_signature');
    const expected = signRequest(secret, request);
    if (!constantTimeEquals(signature, expected)) return this.deny(device, 'invalid_signature');
    if (!device) return { ok: false, reason: 'unknown_device' };
    return {
      ok: true,
      principal: {
        id: device.id,
        kind: 'device',
        scopes: new Set(device.scopes),
        proof: 'device-signature',
      },
    };
  }

  private deny(device: RemoteDevice | undefined, reason: Exclude<SignatureVerdict, { ok: true }>['reason']): SignatureVerdict {
    return { ok: false, reason: device ? reason : 'unknown_device' };
  }
}
