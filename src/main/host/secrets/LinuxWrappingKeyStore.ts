import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import { assertNoLinks } from '../../repositories/pathDiscipline';
import type { KeyringProbe, WrappingKeyStore } from './HostSecretVault';
import type { KeyringReply, KeyringRequest } from './linuxSecretService';

/** Profile must already exist and be exclusively owned by the host. No path in OS labels. */
export function secretProfileId(profileDirectory: string): string {
  assertNoLinks(profileDirectory);
  return createHash('sha256').update('ade-host-vault-v1\0').update(realpathSync(profileDirectory)).digest('hex');
}

export interface LinuxKeyringOptions {
  /** Defaults to the sibling emitted by electron-vite, also under RunAsNode. */
  workerPath?: string;
  executable?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
}

/** Native calls live in a disposable child: even blocked native threads are bounded. */
export class LinuxWrappingKeyStore implements WrappingKeyStore {
  private revision: string | null = null;
  private closed = false;
  private active: (() => void) | null = null;
  private readonly env: NodeJS.ProcessEnv;
  private readonly timeoutMs: number;
  constructor(private readonly profileId: string, private readonly options: LinuxKeyringOptions = {}) {
    if (!/^[a-f0-9]{64}$/.test(profileId)) throw new Error('ade: invalid secret profile');
    this.timeoutMs = options.timeoutMs ?? 8000;
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs < 50 || this.timeoutMs > 30_000) throw new Error('ade: invalid keyring timeout');
    const source = options.env ?? process.env;
    // Avoid loader injection and credential-bearing ambient CLI variables.
    this.env = { ELECTRON_RUN_AS_NODE: '1', PATH: '/usr/bin:/bin' };
    for (const key of ['HOME', 'XDG_DATA_HOME', 'XDG_RUNTIME_DIR', 'DBUS_SESSION_BUS_ADDRESS']) {
      if (source[key]) this.env[key] = source[key];
    }
  }
  generation(): string | null { return this.revision; }
  async probe(): Promise<KeyringProbe> {
    const reply = await this.run({ operation: 'probe', profileId: this.profileId });
    return reply.state === 'ready' ? { state: 'ready', protection: reply.protection } : { state: reply.state };
  }
  async read(): Promise<Buffer | null> {
    const reply = await this.run({ operation: 'read', profileId: this.profileId });
    if (reply.state !== 'ready' || reply.key === undefined) throw new Error('ade: keyring unavailable');
    return reply.key === null ? null : Buffer.from(reply.key, 'base64');
  }
  async create(key: Buffer): Promise<void> {
    if (key.length !== 32) throw new Error('ade: invalid wrapping key');
    const reply = await this.run({ operation: 'create', profileId: this.profileId, key: key.toString('base64') });
    if (reply.state !== 'ready') throw new Error('ade: keyring unavailable');
  }
  close(): void { this.closed = true; this.revision = null; this.active?.(); }

  private run(request: KeyringRequest): Promise<KeyringReply> {
    if (this.closed || this.active || process.platform !== 'linux') return Promise.resolve({ state: 'unavailable' });
    return new Promise(resolve => {
      const child = spawn(this.options.executable ?? process.execPath, [this.options.workerPath ?? join(__dirname, 'keyringWorker.js')],
        { env: this.env, stdio: ['pipe', 'pipe', 'ignore'], detached: true });
      let bytes = Buffer.alloc(0); let done = false;
      const stop = () => { if (child.pid) { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* Already exited. */ } } };
      const finish = (reply: KeyringReply) => {
        if (done) return; done = true; clearTimeout(timer); stop(); this.active = null;
        this.revision = reply.state === 'ready' ? reply.revision : null;
        bytes.fill(0); resolve(reply);
      };
      const timer = setTimeout(() => finish({ state: 'unavailable' }), this.timeoutMs);
      this.active = () => finish({ state: 'unavailable' });
      child.on('error', () => finish({ state: 'unavailable' }));
      child.stdin.on('error', () => finish({ state: 'unavailable' }));
      child.stdout.on('data', (chunk: Buffer) => {
        if (bytes.length + chunk.length > 2048) return finish({ state: 'unavailable' });
        bytes = Buffer.concat([bytes, chunk]);
      });
      child.on('close', code => {
        if (done) return;
        try {
          if (code !== 0) throw new Error();
          const reply = JSON.parse(bytes.toString('utf8')) as KeyringReply;
          if (reply.state === 'locked' || reply.state === 'unavailable') return finish({ state: reply.state });
          if (reply.state !== 'ready' || !['encrypted', 'passwordless', 'unknown'].includes(reply.protection)
            || !/^[a-f0-9]{64}$/.test(reply.revision) || (reply.key !== undefined && reply.key !== null
              && (typeof reply.key !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(reply.key) || Buffer.from(reply.key, 'base64').toString('base64') !== reply.key))) throw new Error();
          finish({ state: 'ready', protection: reply.protection, revision: reply.revision,
            ...(reply.key !== undefined ? { key: reply.key } : {}) });
        } catch { finish({ state: 'unavailable' }); }
      });
      child.stdin.end(JSON.stringify(request));
    });
  }
}
