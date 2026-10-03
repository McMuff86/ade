/** Private bus without service directories. Never inherits the user's bus/control socket. */
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
export class IsolatedSecretService {
  readonly root = mkdtempSync('/tmp/ade-h2-');
  readonly env: NodeJS.ProcessEnv;
  private bus: ChildProcess | null = null;
  private daemon: ChildProcess | null = null;
  constructor() {
    for (const dir of ['home', 'data', 'run', 'control']) mkdirSync(join(this.root, dir), { mode: 0o700 });
    this.env = { PATH: '/usr/bin:/bin', HOME: join(this.root, 'home'), XDG_DATA_HOME: join(this.root, 'data'),
      XDG_RUNTIME_DIR: join(this.root, 'run'), GNOME_KEYRING_CONTROL: join(this.root, 'control') };
  }
  async startBus(): Promise<void> {
    const config = join(this.root, 'bus.conf');
    writeFileSync(config, `<busconfig><type>session</type><listen>unix:path=${this.root}/bus</listen>
      <policy context="default"><allow send_destination="*"/><allow receive_sender="*"/><allow own="*"/></policy></busconfig>`, { mode: 0o600 });
    this.bus = spawn('/usr/bin/dbus-daemon', ['--nofork', '--print-address=1', `--config-file=${config}`], { env: this.env, stdio: ['ignore', 'pipe', 'ignore'] });
    this.env.DBUS_SESSION_BUS_ADDRESS = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Private bus timed out')), 3000);
      this.bus!.on('error', () => { clearTimeout(timer); reject(new Error('Private bus failed')); });
      this.bus!.stdout!.once('data', chunk => { clearTimeout(timer); resolve(String(chunk).trim()); });
    });
    if (!this.env.DBUS_SESSION_BUS_ADDRESS.startsWith(`unix:path=${this.root}/bus`)) throw new Error('Private bus address mismatch');
  }
  async startDaemon(password: string): Promise<void> {
    this.daemon = spawn('/usr/bin/gnome-keyring-daemon', ['--foreground', '--unlock', '--components=secrets', `--control-directory=${this.env.GNOME_KEYRING_CONTROL}`],
      { env: this.env, stdio: ['pipe', 'ignore', 'ignore'] });
    this.daemon.stdin!.end(password || 'initial-fixture-password');
    await this.waitFor(() => this.call('call', 'org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus', 'NameHasOwner', 's', 'org.freedesktop.secrets').data[0] === true);
    await this.waitFor(() => { try { return this.collection() !== '/'; } catch { return false; } });
    if (password === '') this.master('change', 'initial-fixture-password');
  }
  call<T = unknown[]>(...args: string[]): { type: string; data: T } {
    const output = execFileSync('/usr/bin/busctl', ['--user', '--timeout=1', '--auto-start=no', '--json=short', ...args],
      { env: this.env, timeout: 1500, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return output.trim() ? JSON.parse(output) : { type: '', data: [] as T };
  }
  collection(): string { return this.call('call', 'org.freedesktop.secrets', '/org/freedesktop/secrets', 'org.freedesktop.Secret.Service', 'ReadAlias', 's', 'default').data[0] as string; }
  lock(): void { this.call('call', 'org.freedesktop.secrets', '/org/freedesktop/secrets', 'org.freedesktop.Secret.Service', 'Lock', 'ao', '1', this.collection()); }
  duplicate(profileId: string): string {
    return execFileSync('/usr/bin/python3', ['-c', `import dbus, sys
bus = dbus.SessionBus()
service = dbus.Interface(bus.get_object('org.freedesktop.secrets', '/org/freedesktop/secrets'), 'org.freedesktop.Secret.Service')
_, session = service.OpenSession('plain', dbus.String('', variant_level=1))
collection = dbus.Interface(bus.get_object('org.freedesktop.secrets', service.ReadAlias('default')), 'org.freedesktop.Secret.Collection')
properties = dbus.Dictionary({'org.freedesktop.Secret.Item.Label': dbus.String('ADE duplicate fixture'), 'org.freedesktop.Secret.Item.Attributes': dbus.Dictionary({'service': 'com.adimuff.ade.host-vault.v1', 'username': sys.stdin.read()}, signature='ss')}, signature='sv')
secret = dbus.Struct((session, dbus.ByteArray(b''), dbus.ByteArray(b'duplicate-fixture-only'), 'text/plain'), signature='oayays')
item, prompt = collection.CreateItem(properties, secret, False)
assert str(prompt) == '/'
print(item)
`], { input: profileId, env: this.env, timeout: 3000, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  }
  async unlock(password: string): Promise<void> {
    this.master('unlock', password);
    await this.waitFor(() => this.call<boolean>('get-property', 'org.freedesktop.secrets', this.collection(), 'org.freedesktop.Secret.Collection', 'Locked').data === false);
  }
  replaceKey(profileId: string, key: Buffer): void {
    execFileSync('/usr/bin/python3', ['-c', `import dbus, sys, json
request = json.load(sys.stdin)
bus = dbus.SessionBus()
service = dbus.Interface(bus.get_object('org.freedesktop.secrets', '/org/freedesktop/secrets'), 'org.freedesktop.Secret.Service')
_, session = service.OpenSession('plain', dbus.String('', variant_level=1))
items, locked = service.SearchItems(dbus.Dictionary({'service': 'com.adimuff.ade.host-vault.v1', 'username': request['id']}, signature='ss'))
assert len(items) == 1 and len(locked) == 0
secret = dbus.Struct((session, dbus.ByteArray(b''), dbus.ByteArray(request['key'].encode('ascii')), 'text/plain'), signature='oayays')
dbus.Interface(bus.get_object('org.freedesktop.secrets', items[0]), 'org.freedesktop.Secret.Item').SetSecret(secret)
`], { input: JSON.stringify({ id: profileId, key: key.toString('base64') }), env: this.env, timeout: 3000, stdio: ['pipe', 'ignore', 'pipe'] });
  }
  private master(action: 'unlock' | 'change', password: string): void {
    // Test-only GNOME API, never shipped. The plain session carries a fixture
    // password on this private bus; no password in argv or inherited session.
    execFileSync('/usr/bin/python3', ['-c', `import dbus, sys
bus = dbus.SessionBus()
obj = bus.get_object('org.freedesktop.secrets', '/org/freedesktop/secrets')
service = dbus.Interface(obj, 'org.freedesktop.Secret.Service')
_, session = service.OpenSession('plain', dbus.String('', variant_level=1))
secret = dbus.Struct((session, dbus.ByteArray(b''), dbus.ByteArray(sys.stdin.buffer.read()), 'text/plain'), signature='oayays')
internal = dbus.Interface(obj, 'org.gnome.keyring.InternalUnsupportedGuiltRiddenInterface')
if '${action}' == 'unlock': internal.UnlockWithMasterPassword(service.ReadAlias('default'), secret)
else: internal.ChangeWithMasterPassword(service.ReadAlias('default'), secret, dbus.Struct((session, dbus.ByteArray(b''), dbus.ByteArray(b''), 'text/plain'), signature='oayays'))
`], { input: password, env: this.env, timeout: 3000, stdio: ['pipe', 'ignore', 'pipe'] });
  }
  async stopDaemon(): Promise<void> { await this.stop(this.daemon); this.daemon = null; }
  async close(): Promise<void> { await this.stopDaemon(); await this.stop(this.bus); this.bus = null; rmSync(this.root, { recursive: true, force: true }); }
  private async stop(child: ChildProcess | null): Promise<void> {
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    child.kill('SIGTERM');
    await new Promise<void>(resolve => { const timer = setTimeout(() => { child.kill('SIGKILL'); }, 2000); child.once('close', () => { clearTimeout(timer); resolve(); }); });
  }
  private async waitFor(predicate: () => boolean): Promise<void> {
    const deadline = Date.now() + 4000;
    while (Date.now() < deadline) { if (predicate()) return; await delay(40); }
    throw new Error('Private keyring not ready');
  }
}
