import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import type { ExecutionBackendId } from '../../shared/executionBackends';
import type { ExecutionBackendService } from '../execution/ExecutionBackendService';
import { RemoteApiError } from './AdeApplicationService';

const unavailable = () => new RemoteApiError(422, 'command_rejected', 'WSL-Workspace nicht verfügbar. Ordner, Python 3 und Zugriffsrechte am PC prüfen. Verknüpfungen sind gesperrt.');
interface Pending { resolve: (identity: string | null) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout>; data: string }

/** One fixed, read-only worker per active distro; identities are checked afresh, never cached. */
export class WslRootProbe {
  private readonly workers = new Map<ExecutionBackendId, ProbeWorker>();
  private disposed = false;
  constructor(private readonly execution: ExecutionBackendService) {}
  probe(backend: ExecutionBackendId, root: string): Promise<string | null> {
    if (this.disposed) return Promise.reject(unavailable());
    let worker = this.workers.get(backend);
    if (!worker) {
      if (this.workers.size >= 8) return Promise.reject(unavailable());
      try {
        worker = new ProbeWorker(this.execution.start(backend, 'python3', ['-I', '-u', '-c', ROOT_PROBE]), () => {
          if (this.workers.get(backend) === worker) this.workers.delete(backend);
        });
        this.workers.set(backend, worker);
      } catch { return Promise.reject(unavailable()); }
    }
    return worker.probe(root);
  }
  dispose(): void { this.disposed = true; for (const worker of this.workers.values()) worker.dispose(); this.workers.clear(); }
}

class ProbeWorker {
  private readonly pending = new Map<number, Pending>();
  private sequence = 0;
  private buffer = '';
  private dead = false;
  private ready = false;
  private idle?: ReturnType<typeof setTimeout>;
  constructor(private readonly process: ChildProcessWithoutNullStreams, private readonly removed: () => void) {
    process.stdout.setEncoding('utf8');
    process.stdout.on('data', (data: string) => this.receive(data));
    // Never expose helper stderr, which may include an absolute host path.
    process.stderr.on('data', () => this.dispose('stderr'));
    process.once('error', () => this.dispose('process error')); process.once('close', () => this.dispose('process closed'));
    process.stdin.on('error', () => this.dispose('input closed'));
  }
  probe(root: string): Promise<string | null> {
    if (this.dead || this.pending.size >= 64 || Buffer.byteLength(root) > 4096) return Promise.reject(unavailable());
    clearTimeout(this.idle);
    return new Promise((resolve, reject) => {
      const id = ++this.sequence;
      const timer = setTimeout(() => this.dispose('timeout'), this.ready ? 5000 : 45_000); timer.unref();
      const request = { resolve, reject, timer, data: JSON.stringify({ id, root }) + '\n' };
      this.pending.set(id, request);
      if (this.ready) this.write(request);
    });
  }
  private write(request: Pending): void {
    this.process.stdin.write(request.data, (error) => { if (error) this.dispose('input closed'); });
  }
  private receive(data: string): void {
    if (this.dead) return;
    this.buffer += data;
    if (Buffer.byteLength(this.buffer) > 16 * 1024) { this.dispose('output limit'); return; }
    let end: number;
    while ((end = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, end); this.buffer = this.buffer.slice(end + 1);
      try {
        const result = JSON.parse(line) as { ready?: boolean; id: number; identity?: string | null; error?: boolean };
        if (result.ready === true && Object.keys(result).length === 1 && !this.ready) {
          this.ready = true; for (const request of this.pending.values()) this.write(request); continue;
        }
        const request = this.pending.get(result.id);
        if (!this.ready || !request || (result.error !== true && result.identity !== null && (typeof result.identity !== 'string' || !/^\d{1,30}:\d{1,30}$/.test(result.identity)))) throw unavailable();
        this.pending.delete(result.id); clearTimeout(request.timer);
        if (result.error) request.reject(unavailable()); else request.resolve(result.identity!);
      } catch { this.dispose('invalid response'); return; }
    }
    if (!this.pending.size) { clearTimeout(this.idle); this.idle = setTimeout(() => this.dispose(), 10_000); this.idle.unref(); }
  }
  dispose(reason?: 'stderr' | 'process error' | 'process closed' | 'input closed' | 'timeout' | 'output limit' | 'invalid response'): void {
    if (this.dead) return; this.dead = true; clearTimeout(this.idle);
    if (reason) console.warn('[ade] WSL root probe stopped:', reason, this.ready ? 'after readiness' : 'before readiness');
    for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(unavailable()); }
    this.pending.clear(); this.buffer = ''; this.process.stdin.destroy(); this.process.kill(); this.removed();
  }
}

// JSON stdin only. Every request walks from / using O_NOFOLLOW and closes all descriptors.
export const ROOT_PROBE = String.raw`
import os, sys, json
flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
print(json.dumps({'ready': True}), flush=True)
for line in sys.stdin:
    if len(line) > 32768: break
    p = json.loads(line)
    result = {'id': p['id']}
    fd = None
    try:
        root = p['root'].rstrip('/') or '/'
        assert root.startswith('/') and root != '/' and '\x00' not in root
        fd = os.open('/', flags)
        for name in root.split('/')[1:]:
            assert name and name not in ('.', '..')
            nxt = os.open(name, flags, dir_fd=fd)
            os.close(fd); fd = nxt
        s = os.fstat(fd)
        result['identity'] = str(s.st_dev) + ':' + str(s.st_ino)
    except FileNotFoundError:
        result['identity'] = None
    except Exception:
        result['error'] = True
    finally:
        if fd is not None: os.close(fd)
    print(json.dumps(result), flush=True)
`;
