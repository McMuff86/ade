/** Runs only in the bounded keyring child. Native exceptions never leave it. */
import { Entry } from '@napi-rs/keyring';
import { execFileSync } from 'node:child_process';
import { constants, closeSync, fstatSync, openSync, readSync, readlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, isAbsolute, join } from 'node:path';
import { createHash } from 'node:crypto';
import { assertNoLinks } from '../../repositories/pathDiscipline';
import type { KeyringProbe } from './HostSecretVault';

export const KEYRING_SERVICE = 'com.adimuff.ade.host-vault.v1';
const SERVICE = 'org.freedesktop.secrets';
const ROOT = '/org/freedesktop/secrets';
const COLLECTION = 'org.freedesktop.Secret.Collection';
const ITEM = 'org.freedesktop.Secret.Item';
export type KeyringRequest = { operation: 'probe' | 'read' | 'create'; profileId: string; key?: string };
export type KeyringReply = { state: 'locked' | 'unavailable' } | {
  state: 'ready'; protection: 'encrypted' | 'passwordless' | 'unknown'; revision: string; key?: string | null;
};
interface Snapshot { owner: string; collection: string; item: string | null; locked: boolean; revision: string }

/** busctl sees metadata only: secrets are NEVER passed in argv or stderr. */
function bus(args: string[], signature: string): unknown {
  const output = execFileSync('/usr/bin/busctl', ['--user', '--json=short', '--timeout=2', '--auto-start=no', ...args],
    { timeout: 2500, maxBuffer: 32 * 1024, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const parsed = JSON.parse(output) as { type: string; data: unknown };
  if (parsed.type !== signature) throw new Error();
  return parsed.data;
}
const call = (owner: string, path: string, iface: string, method: string, signature: string, args: string[], result: string): unknown[] => {
  const data = bus(['call', owner, path, iface, method, signature, ...args], result);
  if (!Array.isArray(data)) throw new Error(); return data;
};
const ownerOf = () => {
  const owner = call('org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus', 'GetNameOwner', 's', [SERVICE], 's')[0];
  if (typeof owner !== 'string' || !/^:\d+\.\d+$/.test(owner)) throw new Error(); return owner;
};
function property(owner: string, path: string, iface: string, name: string, type: string): unknown {
  return bus(['get-property', owner, path, iface, name], type);
}
function paths(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 128 || !value.every(path => typeof path === 'string' && /^\/[A-Za-z0-9_/]{1,1023}$/.test(path))) throw new Error();
  return value as string[];
}
function locked(owner: string, path: string, iface: string): boolean {
  const value = property(owner, path, iface, 'Locked', 'b'); if (typeof value !== 'boolean') throw new Error(); return value;
}

/** Search both unlocked and locked items; never infer absence from unlocked alone. */
function inspect(profileId: string): Snapshot {
  const owner = ownerOf();
  const found = call(owner, ROOT, 'org.freedesktop.Secret.Service', 'SearchItems', 'a{ss}',
    ['2', 'service', KEYRING_SERVICE, 'username', profileId], 'aoao');
  const unlocked = paths(found[0]); const sealed = paths(found[1]);
  if (unlocked.length + sealed.length > 1) throw new Error();
  const item = [...unlocked, ...sealed][0] ?? null;
  let collection: string;
  if (item) {
    // Item paths need not be children of their collection in other providers.
    const collections = paths(property(owner, ROOT, 'org.freedesktop.Secret.Service', 'Collections', 'ao'));
    const matches = collections.filter(path => paths(call(owner, path, COLLECTION, 'SearchItems', 'a{ss}',
      ['2', 'service', KEYRING_SERVICE, 'username', profileId], 'ao')[0]).includes(item));
    if (matches.length !== 1) throw new Error(); collection = matches[0];
  } else {
    const alias = call(owner, ROOT, 'org.freedesktop.Secret.Service', 'ReadAlias', 's', ['default'], 'o')[0];
    if (typeof alias !== 'string' || alias === '/' || !/^\/[A-Za-z0-9_/]{1,1023}$/.test(alias)) throw new Error(); collection = alias;
  }
  // The session collection is deliberately non-durable, even if it is default.
  const session = call(owner, ROOT, 'org.freedesktop.Secret.Service', 'ReadAlias', 's', ['session'], 'o')[0];
  if (collection === session || collection === `${ROOT}/collection/session`) throw new Error();
  const isLocked = locked(owner, collection, COLLECTION) || sealed.length > 0 || Boolean(item && locked(owner, item, ITEM));
  const modified = item ? property(owner, item, ITEM, 'Modified', 't') : 0;
  if (typeof modified !== 'number' || !Number.isSafeInteger(modified) || modified < 0 || ownerOf() !== owner) throw new Error();
  const revision = createHash('sha256').update(JSON.stringify([owner, collection, item, modified])).digest('hex');
  return { owner, collection, item, locked: isLocked, revision };
}

/** Only the identified GNOME collection's 16-byte header is inspected. */
function protection(snapshot: Snapshot): 'encrypted' | 'passwordless' | 'unknown' {
  try {
    const pid = call('org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus', 'GetConnectionUnixProcessID', 's', [snapshot.owner], 'u')[0];
    if (!Number.isSafeInteger(pid) || basename(readlinkSync(`/proc/${pid}/exe`)) !== 'gnome-keyring-daemon') return 'unknown';
    const encoded = /^\/org\/freedesktop\/secrets\/collection\/([A-Za-z0-9_]+)$/.exec(snapshot.collection)?.[1];
    if (!encoded) return 'unknown';
    const name = encoded.replace(/_([0-9a-fA-F]{2})/g, (_, byte: string) => String.fromCharCode(parseInt(byte, 16)));
    if (!/^[A-Za-z0-9_. -]{1,128}$/.test(name) || name === '.' || name === '..') return 'unknown';
    const data = process.env.XDG_DATA_HOME;
    const file = join(data && isAbsolute(data) ? data : join(homedir(), '.local', 'share'), 'keyrings', `${name}.keyring`);
    assertNoLinks(file); const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const stat = fstatSync(fd); if (!stat.isFile() || stat.nlink !== 1 || stat.uid !== process.getuid!()) return 'unknown';
      const header = Buffer.alloc(16); const length = readSync(fd, header, 0, 16, 0);
      if (header.subarray(0, length).subarray(0, 9).equals(Buffer.from('[keyring]'))) return 'passwordless';
      if (header.subarray(0, length).equals(Buffer.from('GnomeKeyring\n\r\0\n', 'binary'))) return 'encrypted';
      return 'unknown';
    } finally { closeSync(fd); }
  } catch { return 'unknown'; }
}

export function linuxKeyringOperation(request: KeyringRequest): KeyringReply {
  try {
    if (process.platform !== 'linux' || !request || !/^[a-f0-9]{64}$/.test(request.profileId)
      || !['probe', 'read', 'create'].includes(request.operation)) throw new Error();
    const before = inspect(request.profileId);
    if (before.locked) return { state: 'locked' };
    // Pin the native backend: the package's default would fall back to keyutils.
    const entry = request.operation === 'probe' && !before.item ? null
      : new Entry(KEYRING_SERVICE, request.profileId, { linux: { store: 'secret-service' } });
    if (request.operation === 'create') {
      if (before.item || typeof request.key !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(request.key)
        || Buffer.from(request.key, 'base64').toString('base64') !== request.key) throw new Error();
      const again = inspect(request.profileId);
      if (again.locked) return { state: 'locked' };
      if (again.revision !== before.revision || again.item) throw new Error();
      entry!.setPassword(request.key);
    }
    const value = request.operation !== 'create' && !before.item ? null : entry!.getPassword();
    const after = inspect(request.profileId);
    if (after.locked) return { state: 'locked' };
    if (after.owner !== before.owner || after.collection !== before.collection
      || (request.operation !== 'create' && after.revision !== before.revision)
      || (request.operation === 'create' && (!after.item || value !== request.key))) throw new Error();
    if (value !== null && (typeof value !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(value)
      || Buffer.from(value, 'base64').toString('base64') !== value)) throw new Error();
    // Modified has only second resolution. Include the high-entropy key digest
    // so replacing it twice in one second cannot preserve cached availability.
    const revision = createHash('sha256').update(after.revision).update(value ?? '').digest('hex');
    return { state: 'ready', protection: protection(after), revision,
      ...(request.operation === 'read' ? { key: value } : {}) };
  } catch { return { state: 'unavailable' }; }
}

export function publicProbe(reply: KeyringReply): KeyringProbe {
  return reply.state === 'ready' ? { state: 'ready', protection: reply.protection } : { state: reply.state };
}
