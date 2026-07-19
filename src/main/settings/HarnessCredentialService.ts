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
import type { HarnessKeyStatus, RuntimeId } from '../../shared/types';
import { HARNESS_API_KEY_ENV } from '../../shared/runtimes';

/** Printable ASCII without spaces; rejects control chars and env injection. */
const API_KEY_PATTERN = /^[\x21-\x7E]{1,512}$/;

export interface HarnessKeyEncryptor {
  available(): boolean;
  encrypt(plain: string): Buffer;
  decrypt(encrypted: Buffer): string;
}

interface StoredCredential {
  encrypted: string;
  savedAt: number;
}

interface CredentialFile {
  version: 1;
  credentials: Partial<Record<RuntimeId, StoredCredential>>;
}

/** Lazily binds Electron safeStorage so tests can inject a fake encryptor. */
function electronEncryptor(): HarnessKeyEncryptor {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { safeStorage } = require('electron') as typeof import('electron');
  return {
    available: () => safeStorage.isEncryptionAvailable(),
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

  /**
   * Environment for one launching session. Main-process only — never expose
   * over IPC. Undecryptable records (OS key changed, copied profile) fail
   * closed to an empty environment instead of blocking the launch.
   */
  envFor(runtime: RuntimeId): Record<string, string> {
    const envName = HARNESS_API_KEY_ENV[runtime];
    if (!envName) return {};
    const record = this.read().credentials[runtime];
    if (!record) return {};
    try {
      const plain = this.crypto().decrypt(Buffer.from(record.encrypted, 'base64'));
      return API_KEY_PATTERN.test(plain) ? { [envName]: plain } : {};
    } catch {
      console.warn(`[ade] stored ${runtime} API key could not be decrypted; launching without it`);
      return {};
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
      if (parsed.version === 1 && parsed.credentials && typeof parsed.credentials === 'object') {
        for (const runtime of Object.keys(HARNESS_API_KEY_ENV) as RuntimeId[]) {
          const record = (parsed.credentials as Record<string, unknown>)[runtime];
          if (record && typeof record === 'object'
              && typeof (record as StoredCredential).encrypted === 'string'
              && (record as StoredCredential).encrypted.length <= 10_000
              && Number.isSafeInteger((record as StoredCredential).savedAt)) {
            credentials[runtime] = {
              encrypted: (record as StoredCredential).encrypted,
              savedAt: (record as StoredCredential).savedAt,
            };
          }
        }
      }
      return { version: 1, credentials };
    } catch {
      return { version: 1, credentials: {} };
    }
  }

  private persist(file: CredentialFile): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const temp = `${this.filePath}.tmp`;
    writeFileSync(temp, `${JSON.stringify(file, null, 2)}\n`, 'utf8');
    renameSync(temp, this.filePath);
  }
}
