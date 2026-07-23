/**
 * Encrypted-at-rest API keys for first-class harness CLIs.
 *
 * Keys are write-only across IPC: the renderer can store, replace or delete
 * a key and read only boolean status. Plaintext exists in main-process
 * memory only while a session environment is assembled. Storage uses
 * Electron's safeStorage (DPAPI on Windows, Keychain on macOS, libsecret on
 * Linux); when OS encryption is unavailable ADE refuses to store keys
 * instead of falling back to plaintext. Keys live in their own file next to
 * config.json so `config:get` can never leak credential material.
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type {
  HarnessKeyStatus,
  RuntimeId,
  ServiceKeyScope,
  ServiceKeyStatus,
} from '../../shared/types';
import { HARNESS_API_KEY_ENV } from '../../shared/runtimes';

/** Printable ASCII without spaces; rejects control chars and env injection. */
const API_KEY_PATTERN = /^[\x21-\x7E]{1,512}$/;
const SERVICE_VALUE_PATTERN = /^[\x21-\x7E]{1,1024}$/;
const SERVICE_NAME_PATTERN = /^[A-Z][A-Z0-9_]{2,63}$/;
const MAX_SERVICE_KEYS = 50;
const SECURE_LINUX_STORAGE_BACKENDS = new Set([
  'gnome_libsecret', 'kwallet', 'kwallet5', 'kwallet6',
]);
const RUNTIME_IDS: readonly RuntimeId[] = [
  'claude', 'codex', 'opencode', 'grok', 'gemini', 'ollama', 'shell', 'custom',
];
/**
 * Names a stored service key must never claim: process/loader control
 * variables, ADE's own contract variables and the harness API-key slots
 * (those belong to the dedicated harness section).
 */
const RESERVED_ENV_NAMES = new Set([
  'PATH', 'PATHEXT', 'TERM', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA',
  'TMP', 'TEMP', 'SYSTEMROOT', 'COMSPEC', 'SHELL', 'PSMODULEPATH', 'WSLENV',
  'NODE_OPTIONS', 'NODE_PATH', 'ELECTRON_RUN_AS_NODE',
  ...Object.values(HARNESS_API_KEY_ENV) as string[],
]);

export interface HarnessKeyEncryptor {
  available(): boolean;
  encrypt(plain: string): Buffer;
  decrypt(encrypted: Buffer): string;
}

/** Linux fails closed unless Electron selected a known OS-backed secret store. */
export function isSafeStorageSecure(
  encryptionAvailable: boolean,
  platform: NodeJS.Platform,
  selectedBackend: string,
): boolean {
  return encryptionAvailable && (
    platform !== 'linux' || SECURE_LINUX_STORAGE_BACKENDS.has(selectedBackend)
  );
}

interface StoredCredential {
  encrypted: string;
  savedAt: number;
}

interface StoredServiceKey extends StoredCredential {
  scope: ServiceKeyScope;
}

interface CredentialFile {
  version: 1;
  credentials: Partial<Record<RuntimeId, StoredCredential>>;
  serviceKeys: Record<string, StoredServiceKey>;
}

/** Lazily binds Electron safeStorage so tests can inject a fake encryptor. */
function electronEncryptor(): HarnessKeyEncryptor {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { safeStorage } = require('electron') as typeof import('electron');
  return {
    available: () => isSafeStorageSecure(
      safeStorage.isEncryptionAvailable(),
      process.platform,
      process.platform === 'linux' ? safeStorage.getSelectedStorageBackend() : 'unknown',
    ),
    encrypt: (plain) => safeStorage.encryptString(plain),
    decrypt: (encrypted) => safeStorage.decryptString(encrypted),
  };
}

export class HarnessCredentialService {
  private readonly filePath: string;
  private encryptor: HarnessKeyEncryptor | null;

  constructor(userDataDir: string, encryptor?: HarnessKeyEncryptor) {
    this.filePath = join(userDataDir, 'ade', 'harness-credentials.json');
    this.encryptor = encryptor ?? null;
  }

  available(): boolean {
    try {
      return this.crypto().available();
    } catch {
      return false;
    }
  }

  /** Boolean-only status for every key-capable harness. */
  status(): HarnessKeyStatus[] {
    const stored = this.read().credentials;
    return (Object.keys(HARNESS_API_KEY_ENV) as RuntimeId[]).map((runtime) => {
      const record = stored[runtime];
      return {
        runtime,
        hasStoredKey: Boolean(record),
        ...(record ? { savedAt: record.savedAt } : {}),
      };
    });
  }

  set(runtime: RuntimeId, apiKey: string): void {
    if (!HARNESS_API_KEY_ENV[runtime]) {
      throw new Error(`ade: harness "${runtime}" does not accept a stored API key`);
    }
    if (typeof apiKey !== 'string' || !API_KEY_PATTERN.test(apiKey)) {
      // Never echo key material back, not even partially.
      throw new Error('ade: API keys must be 1-512 printable characters without spaces');
    }
    if (!this.available()) {
      throw new Error('ade: secure key storage is unavailable on this system; the key was not saved');
    }
    const file = this.read();
    file.credentials[runtime] = {
      encrypted: this.crypto().encrypt(apiKey).toString('base64'),
      savedAt: Date.now(),
    };
    this.persist(file);
  }

  clear(runtime: RuntimeId): void {
    if (!HARNESS_API_KEY_ENV[runtime]) {
      throw new Error(`ade: harness "${runtime}" does not accept a stored API key`);
    }
    const file = this.read();
    if (!file.credentials[runtime]) return;
    delete file.credentials[runtime];
    this.persist(file);
  }

  /** Value-free status of every stored generic service key. */
  serviceKeyStatus(): ServiceKeyStatus[] {
    return Object.entries(this.read().serviceKeys)
      .map(([name, record]) => ({ name, savedAt: record.savedAt, scope: record.scope }))
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  setServiceKey(name: string, value: string, scope: ServiceKeyScope): void {
    if (typeof name !== 'string' || !SERVICE_NAME_PATTERN.test(name)) {
      throw new Error('ade: service key names must be UPPER_SNAKE_CASE (3-64 characters)');
    }
    if (RESERVED_ENV_NAMES.has(name) || name.startsWith('ADE_')) {
      throw new Error(`ade: "${name}" is reserved and cannot be a stored service key`);
    }
    if (typeof value !== 'string' || !SERVICE_VALUE_PATTERN.test(value)) {
      // Never echo the submitted value back.
      throw new Error('ade: service key values must be 1-1024 printable characters without spaces');
    }
    const normalizedScope = normalizeScope(scope);
    if (!this.available()) {
      throw new Error('ade: secure key storage is unavailable on this system; the key was not saved');
    }
    const file = this.read();
    if (!file.serviceKeys[name] && Object.keys(file.serviceKeys).length >= MAX_SERVICE_KEYS) {
      throw new Error(`ade: at most ${MAX_SERVICE_KEYS} service keys can be stored`);
    }
    file.serviceKeys[name] = {
      encrypted: this.crypto().encrypt(value).toString('base64'),
      savedAt: Date.now(),
      scope: normalizedScope,
    };
    this.persist(file);
  }

  clearServiceKey(name: string): void {
    const file = this.read();
    if (!file.serviceKeys[name]) return;
    delete file.serviceKeys[name];
    this.persist(file);
  }

  /**
   * Environment for one launching session: scoped service keys first, then
   * the harness API key (reserved names guarantee they cannot collide).
   * Main-process only — never expose over IPC. Undecryptable records (OS key
   * changed, copied profile) fail closed to an absent variable instead of
   * blocking the launch.
   */
  envFor(runtime: RuntimeId): Record<string, string> {
    if (!this.available()) return {};
    const file = this.read();
    const env: Record<string, string> = {};
    for (const [name, record] of Object.entries(file.serviceKeys)) {
      if (record.scope !== 'all' && !record.scope.includes(runtime)) continue;
      const plain = this.decryptRecord(record, `service key ${name}`);
      if (plain !== null && SERVICE_VALUE_PATTERN.test(plain)) env[name] = plain;
    }
    const envName = HARNESS_API_KEY_ENV[runtime];
    const record = envName ? file.credentials[runtime] : undefined;
    if (envName && record) {
      const plain = this.decryptRecord(record, `${runtime} API key`);
      if (plain !== null && API_KEY_PATTERN.test(plain)) env[envName] = plain;
    }
    return env;
  }

  private decryptRecord(record: StoredCredential, label: string): string | null {
    try {
      return this.crypto().decrypt(Buffer.from(record.encrypted, 'base64'));
    } catch {
      console.warn(`[ade] stored ${label} could not be decrypted; launching without it`);
      return null;
    }
  }

  private crypto(): HarnessKeyEncryptor {
    if (!this.encryptor) this.encryptor = electronEncryptor();
    return this.encryptor;
  }

  private read(): CredentialFile {
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, 'utf8')) as Partial<CredentialFile>;
      const credentials: CredentialFile['credentials'] = {};
      const serviceKeys: CredentialFile['serviceKeys'] = {};
      if (parsed.version === 1 && parsed.credentials && typeof parsed.credentials === 'object') {
        for (const runtime of Object.keys(HARNESS_API_KEY_ENV) as RuntimeId[]) {
          const record = (parsed.credentials as Record<string, unknown>)[runtime];
          if (isStoredCredential(record)) {
            credentials[runtime] = { encrypted: record.encrypted, savedAt: record.savedAt };
          }
        }
      }
      if (parsed.version === 1 && parsed.serviceKeys && typeof parsed.serviceKeys === 'object') {
        for (const [name, record] of Object.entries(parsed.serviceKeys as Record<string, unknown>)) {
          if (Object.keys(serviceKeys).length >= MAX_SERVICE_KEYS) break;
          if (!SERVICE_NAME_PATTERN.test(name) || RESERVED_ENV_NAMES.has(name)
              || name.startsWith('ADE_') || !isStoredCredential(record)) continue;
          const scope = normalizeStoredScope((record as Partial<StoredServiceKey>).scope);
          if (!scope) continue;
          serviceKeys[name] = { encrypted: record.encrypted, savedAt: record.savedAt, scope };
        }
      }
      return { version: 1, credentials, serviceKeys };
    } catch {
      return { version: 1, credentials: {}, serviceKeys: {} };
    }
  }

  private persist(file: CredentialFile): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const temp = `${this.filePath}.tmp`;
    writeFileSync(temp, `${JSON.stringify(file, null, 2)}\n`, 'utf8');
    renameSync(temp, this.filePath);
  }
}

function isStoredCredential(value: unknown): value is StoredCredential {
  return Boolean(value) && typeof value === 'object'
    && typeof (value as StoredCredential).encrypted === 'string'
    && (value as StoredCredential).encrypted.length <= 10_000
    && Number.isSafeInteger((value as StoredCredential).savedAt);
}

/** Strict scope for incoming writes; throws on anything malformed. */
function normalizeScope(scope: ServiceKeyScope): ServiceKeyScope {
  const normalized = normalizeStoredScope(scope);
  if (!normalized) throw new Error('ade: service key scope must be "all" or a list of runtimes');
  return normalized;
}

/** Lenient scope for stored records; null drops the record instead of throwing. */
function normalizeStoredScope(scope: unknown): ServiceKeyScope | null {
  if (scope === 'all') return 'all';
  if (!Array.isArray(scope) || scope.length === 0 || scope.length > RUNTIME_IDS.length) return null;
  const unique = [...new Set(scope)];
  return unique.every((item): item is RuntimeId => RUNTIME_IDS.includes(item as RuntimeId))
    ? unique
    : null;
}
