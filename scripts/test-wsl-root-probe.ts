import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { WslRootProbe } from '../src/main/application/WslRootProbe';
import { ExecutionBackendService } from '../src/main/execution/ExecutionBackendService';
import { RemoteApiError } from '../src/main/application/AdeApplicationService';
import { randomUUID } from 'node:crypto';

let passed = 0; let failed = 0;
const check = (name: string, ok: boolean) => { if (ok) { passed++; console.log(`  ok  ${name}`); } else { failed++; console.error(`FAIL  ${name}`); } };
const refused = async (name: string, result: Promise<unknown>) => {
  try { await result; check(name, false); } catch (error) { check(name, error instanceof RemoteApiError && !error.message.includes('/private')); }
};
void (async () => {
  const children: Array<ChildProcessWithoutNullStreams & { stdout: PassThrough; stderr: PassThrough; requests: Array<{ id: number; root: string }>; killedByOwner: boolean }> = [];
  const launches: Array<{ file: string; args: readonly string[] }> = [];
  const execution = new ExecutionBackendService('win32', ((file: string, args: readonly string[]) => {
    launches.push({ file, args });
    const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(),
      requests: [] as Array<{ id: number; root: string }>, killedByOwner: false,
      kill() { this.killedByOwner = true; return true; } }) as unknown as typeof children[number];
    child.stdin.on('data', (data: Buffer) => child.requests.push(JSON.parse(data.toString())));
    children.push(child); return child;
  }) as unknown as ConstructorParameters<typeof ExecutionBackendService>[1]);
  const pool = new WslRootProbe(execution);
  try {
    const a = pool.probe('wsl:Ubuntu', '/private/a'); const b = pool.probe('wsl:Ubuntu', '/private/b');
    const child = children[0]!;
    check('paths wait for the worker readiness handshake', child.requests.length === 0);
    child.stdout.write('{"ready":true}\n');
    check('same distro shares one fixed worker with paths only in stdin', launches.length === 1 && /(?:^|[\\/])wsl\.exe$/.test(launches[0]!.file) && !launches[0]!.args.join(' ').includes('/private') && child.requests.length === 2);
    child.stdout.write(JSON.stringify({ id: child.requests[1]!.id, identity: '1:2' }) + '\n');
    child.stdout.write(JSON.stringify({ id: child.requests[0]!.id, identity: '1:1' }) + '\n');
    check('concurrent root probes match responses by request identity', await a === '1:1' && await b === '1:2');
    const fresh = pool.probe('wsl:Ubuntu', '/private/a');
    child.stdout.write(JSON.stringify({ id: child.requests[2]!.id, identity: '1:9' }) + '\n');
    check('root identity is never reused from a previous request', await fresh === '1:9' && child.requests.length === 3);
    const missing = pool.probe('wsl:Ubuntu', '/private/missing');
    child.stdout.write(JSON.stringify({ id: child.requests[3]!.id, identity: null }) + '\n');
    check('absent root has an explicit empty result', await missing === null);
    const bad = pool.probe('wsl:Ubuntu', '/private/link');
    child.stdout.write(JSON.stringify({ id: child.requests[4]!.id, error: true }) + '\n');
    await refused('unsafe root rejects without exposing paths', bad);
    const crash = pool.probe('wsl:Ubuntu', '/private/a'); child.stderr.write('/private/sensitive diagnostic');
    await refused('worker failure rejects all outstanding work without stderr', crash);
    check('failed worker is terminated', child.killedByOwner);
    const recovered = pool.probe('wsl:Ubuntu', '/private/a'); const replacement = children[1]!;
    replacement.stdout.write('{"ready":true}\n');
    replacement.stdout.write(JSON.stringify({ id: replacement.requests[0]!.id, identity: '1:3' }) + '\n');
    check('a new request starts a fresh worker after failure', await recovered === '1:3' && launches.length === 2);
    await refused('oversized path is refused before serialization', pool.probe('wsl:Ubuntu', '/' + 'a'.repeat(4096)));
    const overflow = pool.probe('wsl:Ubuntu', '/private/a'); replacement.stdout.write('x'.repeat(16385));
    await refused('oversized worker output fails closed', overflow);
    const malformed = pool.probe('wsl:Ubuntu', '/private/a'); children[2]!.stdout.write('{"id":1,"identity":"/private/secret"}\n');
    await refused('malformed identity cannot leave the worker boundary', malformed);
    const waiting = Array.from({ length: 64 }, () => pool.probe('wsl:Ubuntu', '/private/a').catch(() => null));
    await refused('outstanding workspace probes have a hard bound', pool.probe('wsl:Ubuntu', '/private/a'));
    const pendingChild = children.at(-1)!;
    pendingChild.stdout.write('{"ready":true}\n');
    for (const request of pendingChild.requests) pendingChild.stdout.write(JSON.stringify({ id: request.id, identity: '1:4' }) + '\n');
    check('queue saturation preserves all accepted requests in the worker', (await Promise.all(waiting)).every((identity) => identity === '1:4'));
    const closing = pool.probe('wsl:Ubuntu', '/private/a'); pool.dispose();
    await refused('shutdown rejects in-flight checks and stops workers', closing);
    await refused('late caller cannot restart a disposed pool', pool.probe('wsl:Ubuntu', '/private/a'));
  } finally { pool.dispose(); }

  if (process.argv.includes('--wsl')) {
    const backend = 'wsl:Ubuntu'; const real = new ExecutionBackendService(); const probe = new WslRootProbe(real);
    const root = `/tmp/ade-root-probe-${randomUUID()}`;
    const command = (code: string) => real.checked(backend, 'python3', ['-I', '-c', code], { input: JSON.stringify(root) });
    try {
      await command('import os,sys,json; p=json.load(sys.stdin); os.mkdir(p); os.mkdir(p+"/home"); os.symlink(p+"/home",p+"/link")');
      const first = await probe.probe(backend, root + '/home');
      await refused('real WSL root traversal refuses symbolic links', probe.probe(backend, root + '/link'));
      await command('import os,sys,json; p=json.load(sys.stdin); os.rename(p+"/home",p+"/old"); os.mkdir(p+"/home")');
      const second = await probe.probe(backend, root + '/home');
      check('real WSL replacement is detected by the already-running worker', !!first && !!second && first !== second);
      const start = performance.now(); for (let i = 0; i < 20; i++) await probe.probe(backend, root + '/home');
      const duration = Math.round(performance.now() - start);
      check(`20 fresh WSL probes avoid repeated process startup (${duration} ms)`, duration < 500);
    } finally {
      probe.dispose();
      await command('import sys,json,re,shutil; p=json.load(sys.stdin); assert re.fullmatch(r"/tmp/ade-root-probe-[a-f0-9-]{36}",p); shutil.rmtree(p)');
    }
  }
})().catch((error) => { failed++; console.error(error); }).finally(() => { console.log(`WSL root probe: ${passed} passed, ${failed} failed`); process.exitCode = failed ? 1 : 0; });
