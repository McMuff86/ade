/** Native Linux source-checkout activation. Never signals or replaces a busy owner. */
import { appendFileSync, cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, realpathSync, renameSync, rmSync, writeFileSync, openSync, closeSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { join, resolve } from 'node:path';
import { hostname } from 'node:os';

export interface LinuxActivationOptions {
  repo: string; profile: string; backupRoot: string; staged: string; electron: string;
  label: string; rollback?: boolean; env: NodeJS.ProcessEnv;
  gate(): Promise<void>;
  readyTimeoutMs?: number;
}
const delay = (ms: number) => new Promise<void>(done => setTimeout(done, ms));
function alive(pid: number): boolean {
  try { return readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1]?.[0] !== 'Z'; } catch { return false; }
}
function noLink(path: string): void {
  if (existsSync(path) && lstatSync(path).isSymbolicLink()) throw new Error(`Activation refuses linked path: ${path}`);
}
export function profileOwner(profile: string): number | null {
  let lock: string;
  try { lock = readlinkSync(join(profile, 'SingletonLock')); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
  const separator = lock.lastIndexOf('-');
  if (lock.slice(0, separator) !== hostname()) throw new Error('Profile is locked by a different host; activation refused.');
  const pid = Number(lock.slice(separator + 1));
  if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('Unrecognized profile lock; activation refused.');
  return alive(pid) ? pid : null;
}
function descendants(root: number): number[] {
  const pairs = readdirSync('/proc').filter(p => /^\d+$/.test(p)).flatMap(p => {
    try { const stat = readFileSync(`/proc/${p}/stat`, 'utf8').split(') ')[1]!.split(' '); return [{ pid: Number(p), parent: Number(stat[1]) }]; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
  });
  const ids = new Set([root]); let size: number;
  do { size = ids.size; for (const p of pairs) if (ids.has(p.parent)) ids.add(p.pid); } while (ids.size !== size);
  return [...ids].filter(p => p !== root);
}
export function assertIdleOwner(profile: string, electron: string): number | null {
  const owner = profileOwner(profile);
  if (!owner) return null;
  const executable = realpathSync(electron);
  if (readlinkSync(`/proc/${owner}/exe`) !== executable) throw new Error('Profile owner is not the expected Electron executable.');
  for (const pid of descendants(owner)) {
    try {
      const exe = readlinkSync(`/proc/${pid}/exe`);
      const argv = readFileSync(`/proc/${pid}/cmdline`, 'utf8').split(/[\0 ]+/);
      // Only Chromium internals are exempt; another Node/Electron agent still blocks.
      if (exe === executable && argv.some(arg => /^--type=(zygote|renderer|gpu-process|utility|broker)$/.test(arg))) continue;
      throw new Error(`ADE still owns terminal or agent work (PID ${pid}, ${exe.split('/').at(-1)}, type ${argv.find(arg => arg.startsWith('--type=')) ?? 'none'}); activation preserves all sessions.`);
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  return owner;
}
/** Confirm the loopback socket belongs to the new owner, not another host. */
function ownsListener(pid: number, port: number): boolean {
  try {
    const sockets = new Set(readdirSync(`/proc/${pid}/fd`).flatMap(fd => {
      try { return [readlinkSync(`/proc/${pid}/fd/${fd}`)]; } catch { return []; }
    }));
    const local = `0100007F:${port.toString(16).toUpperCase().padStart(4, '0')}`;
    return readFileSync(`/proc/${pid}/net/tcp`, 'utf8').split('\n').some(line => {
      const columns = line.trim().split(/\s+/);
      return columns[1] === local && columns[3] === '0A' && sockets.has(`socket:[${columns[9]}]`);
    });
  } catch { return false; }
}
export async function activateLinux(options: LinuxActivationOptions): Promise<{ pid: number; backup: string; sourceId: string }> {
  const o = options; const repo = realpathSync(o.repo); const profile = resolve(o.profile);
  if (!/^[A-Za-z0-9-]{1,40}$/.test(o.label)) throw new Error('Label: 1-40 letters, digits or dashes.');
  const out = join(repo, 'out'); const previous = join(repo, 'out.prev'); const next = join(repo, 'out.activate');
  for (const path of [out, previous, next, profile, o.staged]) noLink(path);
  mkdirSync(join(repo, 'test-results'), { recursive: true });
  const lock = join(repo, 'test-results', 'activation.lock');
  // A leftover activation lock requires inspection; do not infer a safe swap state.
  const descriptor = openSync(lock, 'wx', 0o600); writeFileSync(descriptor, String(process.pid));
  const env: NodeJS.ProcessEnv = { ...o.env, ADE_USER_DATA_DIR: profile }; delete env.ELECTRON_RUN_AS_NODE;
  const launch = (args: string[]) => {
    const child = spawn(o.electron, [repo, ...args], { cwd: repo, env, detached: true, stdio: 'ignore' });
    child.on('error', error => console.error('ADE launch failed:', error.message)); child.unref(); return child;
  };
  const quit = async (pid: number) => {
    assertIdleOwner(profile, o.electron);
    // Old builds cannot make the atomic busy check. Require a deliberate tray quit.
    if (!readFileSync(join(out, 'main/index.js'), 'utf8').includes('--ade-activate-quit')) {
      throw new Error('Existing build has no guarded activation quit. Quit ADE through its tray after finishing work, then retry; build unchanged.');
    }
    launch(['--ade-activate-quit']);
    const deadline = Date.now() + 30_000;
    while (alive(pid) && Date.now() < deadline) await delay(150);
    if (alive(pid)) throw new Error('ADE refused activation or did not quit within 30 s; sessions and build preserved.');
  };
  const mobilePort = Number(env.ADE_MOBILE_PORT ?? '4317');
  let requireListener = false;
  const start = async () => {
    const started = Date.now(); const child = launch([]);
    const deadline = started + (o.readyTimeoutMs ?? 90_000);
    while (Date.now() < deadline) {
      await delay(200);
      if (!child.pid || !alive(child.pid)) throw new Error('ADE exited before reporting ready.');
      let lines = '';
      try { lines = readFileSync(join(profile, 'ade/logs/main.log'), 'utf8').slice(-64 * 1024); } catch { /* not ready */ }
      if ((!requireListener || ownsListener(child.pid, mobilePort)) && profileOwner(profile) === child.pid && lines.split('\n').some(line => line.includes('[ade] app ready') && Date.parse(line.slice(0, 24)) >= started)) return child.pid;
    }
    throw new Error('ADE did not report ready in time.');
  };
  let backup = ''; let oldOwner: number | null = null; let ownsNext = false;
  const parking = join(repo, 'out.activation-previous');
  let buildLock: number | undefined;
  const buildLockPath = join(repo, 'test-results/verify/verify.lock');
  try {
    noLink(parking);
    if (existsSync(next)) throw new Error('out.activate already exists; inspect the interrupted activation before retrying.');
    if (existsSync(parking)) throw new Error('Previous activation recovery directory exists.');
    assertIdleOwner(profile, o.electron);
    if (!o.rollback) await o.gate();
    mkdirSync(join(repo, 'test-results/verify'), { recursive: true });
    buildLock = openSync(buildLockPath, 'wx', 0o600); writeFileSync(buildLock, String(process.pid));
    const source = o.rollback ? previous : o.staged;
    for (const file of ['main/index.js', 'preload/index.js', 'renderer/index.html', 'mobile/index.html']) {
      if (!existsSync(join(source, file))) throw new Error(`Checked build is incomplete: ${file}`);
    }
    ownsNext = true;
    cpSync(source, next, { recursive: true, errorOnExist: true, force: false });
    oldOwner = assertIdleOwner(profile, o.electron);
    const devices = join(profile, 'ade/remote/devices.json');
    requireListener = existsSync(devices) && JSON.parse(readFileSync(devices, 'utf8')).mobileEnabled === true;
    backup = join(o.backupRoot, `Activate-${o.label}-${new Date().toISOString().replace(/[:.]/g, '-')}`);
    mkdirSync(backup, { recursive: true, mode: 0o700 });
    const copyProfile = (name: string) => {
      if (existsSync(profile)) cpSync(profile, join(backup, name), { recursive: true,
        filter: path => !['SingletonLock', 'SingletonCookie', 'SingletonSocket'].includes(path.split('/').at(-1)!) });
    };
    copyProfile('before-quit');
    if (oldOwner) await quit(oldOwner);
    // The second snapshot includes graceful-shutdown writes and stable browser storage.
    try { copyProfile('profile'); }
    catch (error) { if (oldOwner && !profileOwner(profile)) await start(); throw error; }
    if (profileOwner(profile)) throw new Error('Another ADE owner appeared; activation refused.');
    const oldBuild = existsSync(out);
    let moved = false; let installed = false;
    try {
      if (oldBuild) { renameSync(out, parking); moved = true; }
      renameSync(next, out); installed = true;
      const pid = await start();
      rmSync(previous, { recursive: true, force: true });
      if (moved) renameSync(parking, previous);
      const sourceId = createHash('sha256').update(readFileSync(join(out, 'main/index.js'))).digest('hex').slice(0, 20);
      appendFileSync(join(repo, 'test-results/activations.jsonl'), JSON.stringify({ at: new Date().toISOString(), platform: 'linux', label: o.label,
        gate: o.rollback ? 'rollback' : 'passed', pid, previousPid: oldOwner, sourceId, backup }) + '\n');
      console.log(`ADE ready: PID ${pid}, source ${sourceId}; backup ${backup}`);
      return { pid, backup, sourceId };
    } catch (error) {
      const current = profileOwner(profile);
      if (current) await quit(current); // Never force a new session down, even during recovery.
      if (installed) rmSync(out, { recursive: true, force: true });
      if (moved) renameSync(parking, out);
      if (moved) { await start(); console.error('Activation failed; previous build restored and ready.'); }
      throw error;
    }
  } finally {
    if (ownsNext) rmSync(next, { recursive: true, force: true });
    if (buildLock !== undefined) { closeSync(buildLock); rmSync(buildLockPath, { force: true }); }
    closeSync(descriptor); rmSync(lock, { force: true });
  }
}
