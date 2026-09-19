import { t as translate } from "../../shared/i18n";
import { closeSync, constants, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readdirSync, readSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type { ExecutionBackendId } from '../../shared/executionBackends';
import type { ExecutionBackendService } from '../execution/ExecutionBackendService';
import { assertNoLinks } from '../repositories/pathDiscipline';
import { terminalPngDimensions, TERMINAL_IMAGE_MAX_BYTES, TERMINAL_IMAGE_TTL_MS } from '../../shared/terminalImages';
import type { MobileTerminalImage } from '../../shared/remote';

interface StoredImage { id: string; owner: string; terminalId: string; backend: ExecutionBackendId; path: string; digest: string; bytes: number; createdAt: number }
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const LIMIT = 64 * 1024 * 1024;

/** Private staging, outside repositories. Clients receive opaque IDs only;
 * backend paths never leave main and are not accepted as request parameters. */
export class TerminalImageStore {
  private readonly records = new Map<string, StoredImage>();
  private writing = false;
  constructor(private readonly root: string, private readonly execution: ExecutionBackendService,
    private readonly normalize: (bytes: Buffer) => Buffer, private readonly now = () => Date.now()) {}

  async put(owner: string, terminalId: string, backend: ExecutionBackendId, bytes: Buffer, authorize: () => void | Promise<void>): Promise<MobileTerminalImage> {
    if (this.writing) throw new Error(translate("An image transfer is already running. Wait a minute and try again."));
    this.writing = true;
    try { return await this.store(owner, terminalId, backend, bytes, authorize); }
    finally { this.writing = false; }
  }

  private async store(owner: string, terminalId: string, backend: ExecutionBackendId, bytes: Buffer, authorize: () => void | Promise<void>): Promise<MobileTerminalImage> {
    await authorize(); terminalPngDimensions(bytes);
    const normalized = this.normalize(bytes); const dimensions = terminalPngDimensions(normalized);
    for (const [id, image] of this.records) if (image.createdAt + TERMINAL_IMAGE_TTL_MS < this.now()) this.records.delete(id);
    if (this.records.size >= 64 || [...this.records.values()].reduce((sum, image) => sum + image.bytes, normalized.length) > LIMIT) throw new Error(translate("Image storage is full. Try again later."));
    const id = randomUUID(); const sha256 = digest(normalized); let path: string;
    await authorize();
    if (backend === 'native') {
      assertNoLinks(this.root); mkdirSync(this.root, { recursive: true, mode: 0o700 });
      let total = normalized.length; let count = 0;
      for (const name of readdirSync(this.root)) {
        if (!/^[a-f0-9-]{36}\.png$/.test(name)) throw new Error(translate("Image storage contains unknown files."));
        const file = join(this.root, name); assertNoLinks(file); const stat = lstatSync(file);
        if (!stat.isFile() || stat.nlink !== 1) throw new Error(translate("Image storage contains a linkage."));
        if (stat.mtimeMs + TERMINAL_IMAGE_TTL_MS < this.now()) unlinkSync(file);
        else { total += stat.size; count++; }
        if (count >= 64 || total > LIMIT) throw new Error(translate("Image storage is full. Try again later."));
      }
      path = join(this.root, `${id}.png`); assertNoLinks(path);
      const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
      try { writeFileSync(fd, normalized); fsyncSync(fd); } finally { closeSync(fd); }
    } else path = await this.wsl(backend, { operation: 'put', id, bytes: normalized.toString('base64'), digest: sha256 });
    await authorize();
    this.records.set(id, { id, owner, terminalId, backend, path, digest: sha256, bytes: normalized.length, createdAt: this.now() });
    return { id, name: 'Screenshot.png', bytes: normalized.length, ...dimensions };
  }

  async path(owner: string, terminalId: string, backend: ExecutionBackendId, id: string): Promise<string> {
    const image = this.records.get(id);
    if (!image || image.owner !== owner || image.terminalId !== terminalId || image.backend !== backend || image.createdAt + TERMINAL_IMAGE_TTL_MS < this.now()) throw new Error(translate("This image does not belong to this session or has expired. Select it again."));
    if (backend !== 'native') {
      const path = await this.wsl(backend, { operation: 'verify', id, digest: image.digest });
      if (path !== image.path) throw new Error(translate("Image storage has been changed."));
    } else {
      assertNoLinks(image.path);
      const fd = openSync(image.path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      try {
        const before = fstatSync(fd);
        if (!before.isFile() || before.nlink !== 1 || before.size !== image.bytes || before.size > TERMINAL_IMAGE_MAX_BYTES) throw new Error(translate("Image file has been changed."));
        const buffer = Buffer.alloc(image.bytes + 1); let length = 0;
        while (length < buffer.length) { const count = readSync(fd, buffer, length, buffer.length - length, length); if (!count) break; length += count; }
        const bytes = buffer.subarray(0, length); const named = lstatSync(image.path);
        if (digest(bytes) !== image.digest || named.isSymbolicLink() || named.dev !== before.dev || named.ino !== before.ino || named.nlink !== 1) throw new Error(translate("Image file has been changed."));
      } finally { closeSync(fd); }
    }
    if (/[\x00-\x1f\x7f]/.test(image.path)) throw new Error(translate("Image path cannot be transferred."));
    return image.path;
  }

  private async wsl(backend: ExecutionBackendId, payload: Record<string, string>): Promise<string> {
    const result = await this.execution.run(backend, 'python3', ['-I', '-c', IMAGE_WORKER], { input: JSON.stringify(payload), timeoutMs: 15_000, maxBuffer: 4096 });
    if (result.code !== 0) throw new Error(translate("Image could not be stored or checked in the WSL environment. Check disk space and Python 3."));
    const value = JSON.parse(result.stdout.toString()) as { path: string };
    if (!/^\/tmp\/ade-terminal-images-\d+\/[a-f0-9-]{36}\.png$/.test(value.path)) throw new Error(translate("Invalid response of the image storage."));
    return value.path;
  }
}

const IMAGE_WORKER = String.raw`
import os, sys, json, stat, re, base64, hashlib, time
p = json.load(sys.stdin)
assert re.fullmatch(r'[a-f0-9-]{36}', p['id'])
assert re.fullmatch(r'[a-f0-9]{64}', p['digest'])
flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
root = '/tmp/ade-terminal-images-' + str(os.getuid())
tmp = os.open('/tmp', flags)
try:
    name = os.path.basename(root)
    try: os.mkdir(name, 0o700, dir_fd=tmp)
    except FileExistsError: pass
    fd = os.open(name, flags, dir_fd=tmp)
finally: os.close(tmp)
s = os.fstat(fd)
assert s.st_uid == os.getuid() and s.st_mode & 0o077 == 0
name = p['id'] + '.png'
if p['operation'] == 'put':
    data = base64.b64decode(p['bytes'], validate=True)
    assert 0 < len(data) <= 8 * 1024 * 1024 and hashlib.sha256(data).hexdigest() == p['digest']
    total = len(data); count = 0
    for entry in os.listdir(fd):
        assert re.fullmatch(r'[a-f0-9-]{36}\.png', entry)
        s = os.stat(entry, dir_fd=fd, follow_symlinks=False)
        assert stat.S_ISREG(s.st_mode) and s.st_nlink == 1
        if s.st_mtime + 86400 < time.time(): os.unlink(entry, dir_fd=fd)
        else: total += s.st_size; count += 1
        assert total <= 64 * 1024 * 1024 and count < 64
    f = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=fd)
    with os.fdopen(f, 'wb') as out: out.write(data); out.flush(); os.fsync(out.fileno())
elif p['operation'] == 'verify':
    f = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=fd)
    with os.fdopen(f, 'rb') as inp:
        s = os.fstat(inp.fileno()); assert stat.S_ISREG(s.st_mode) and s.st_nlink == 1 and s.st_size <= 8 * 1024 * 1024
        data = inp.read(8 * 1024 * 1024 + 1); assert hashlib.sha256(data).hexdigest() == p['digest']
        n = os.stat(name, dir_fd=fd, follow_symlinks=False); assert n.st_ino == s.st_ino and n.st_dev == s.st_dev and n.st_nlink == 1
else: raise ValueError('operation')
check = os.open(root, flags)
assert os.fstat(check).st_ino == os.fstat(fd).st_ino and os.fstat(check).st_dev == os.fstat(fd).st_dev
os.close(check); os.close(fd)
print(json.dumps({'path': root + '/' + name}))
`;
