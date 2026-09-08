import type { ExecutionBackendId } from '../../shared/executionBackends';
import type { MobileWorkspaceEntry } from '../../shared/remote';
import type { ExecutionBackendService } from '../execution/ExecutionBackendService';
import { RemoteApiError } from './AdeApplicationService';

export interface WslWorkspaceResult {
  identity: string; missing?: boolean; bytes?: string; large?: boolean;
  entries?: MobileWorkspaceEntry[]; limited?: boolean; saved?: boolean; revision?: string;
}

/** Fixed Python program, JSON stdin, descriptor-relative traversal. No shell or path argv. */
export async function remoteWslWorkspace(execution: ExecutionBackendService, backend: ExecutionBackendId,
  root: string, operation: string, payload: Record<string, unknown> = {}): Promise<WslWorkspaceResult> {
  const result = await execution.run(backend, 'python3', ['-I', '-c', WORKSPACE_HELPER], {
    input: JSON.stringify({ root, operation, ...payload }), timeoutMs: 15_000, maxBuffer: 512 * 1024,
  });
  if (result.code !== 0) throw new RemoteApiError(422, 'command_rejected', 'WSL-Workspace nicht verfügbar. Ordner, Python 3 und Zugriffsrechte am PC prüfen. Verknüpfungen sind gesperrt.');
  return JSON.parse(result.stdout.toString('utf8')) as WslWorkspaceResult;
}

const WORKSPACE_HELPER = String.raw`
import os, sys, json, stat, re, base64, hashlib, uuid
p = json.load(sys.stdin)
limit = 24 * 1024
flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
excluded = re.compile(r'^(?:\.git|\.ssh|\.aws|\.azure|\.gnupg|\.env(?:\..*)?|\.npmrc|\.netrc|\.pypirc|node_modules|credentials(?:\..*)?|secrets?(?:\..*)?|id_rsa|id_ed25519)$', re.I)
extension = re.compile(r'\.(?:pem|key|p12|pfx|keystore)$', re.I)
def parts(path, root=False):
    if path == '' and root: return []
    assert isinstance(path, str) and 0 < len(path) <= 400
    out = path.split('/')
    for name in out:
        assert name and name not in ('.', '..') and not name.endswith(('.', ' '))
        assert not re.search(r'[\\:\x00-\x1f\x7f]', name) and not excluded.match(name) and not extension.search(name)
        assert not re.match(r'^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)', name, re.I)
    return out
def root_open(create=False):
    root = p['root'].rstrip('/') or '/'
    assert root.startswith('/') and root != '/' and '\x00' not in root
    fd = os.open('/', flags)
    try:
        for name in root.split('/')[1:]:
            assert name and name not in ('.', '..')
            if create:
                try: os.mkdir(name, 0o700, dir_fd=fd)
                except FileExistsError: pass
            nxt = os.open(name, flags, dir_fd=fd)
            os.close(fd); fd = nxt
        return fd
    except:
        os.close(fd); raise
try: rootfd = root_open(p.get('create', False))
except FileNotFoundError:
    if p['operation'] == 'probe':
        print(json.dumps({'identity': '', 'missing': True})); sys.exit(0)
    raise
def identity(fd):
    s = os.fstat(fd); return str(s.st_dev) + ':' + str(s.st_ino)
ident = identity(rootfd)
assert not p.get('identity') or p['identity'] == ident
def directory(names):
    fd = os.dup(rootfd)
    try:
        for name in names:
            nxt = os.open(name, flags, dir_fd=fd); os.close(fd); fd = nxt
        return fd
    except:
        os.close(fd); raise
def read_at(fd, name):
    f = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=fd)
    try:
        s = os.fstat(f); assert stat.S_ISREG(s.st_mode) and s.st_nlink == 1
        chunks = bytearray()
        while len(chunks) <= limit:
            b = os.read(f, limit + 1 - len(chunks))
            if not b: break
            chunks.extend(b)
        return bytes(chunks), s
    finally: os.close(f)
result = {'identity': ident}
op = p['operation']
if op in ('read', 'save'):
    names = parts(p['path']); parent = directory(names[:-1]); name = names[-1]
    try:
        raw, s = read_at(parent, name)
        if op == 'read':
            result.update({'large': len(raw) > limit, 'bytes': base64.b64encode(raw).decode() if len(raw) <= limit else ''})
        else:
            revision = hashlib.sha256(raw).hexdigest()
            result.update({'saved': False, 'revision': revision})
            if revision == p['revision']:
                data = base64.b64decode(p['bytes'], validate=True); assert len(data) <= limit
                temp = '.ade-edit-' + uuid.uuid4().hex + '.tmp'
                f = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, s.st_mode & 0o777, dir_fd=parent)
                try:
                    with os.fdopen(f, 'wb') as out:
                        out.write(data); out.flush(); os.fchmod(out.fileno(), s.st_mode & 0o777); os.fsync(out.fileno())
                    latest, _ = read_at(parent, name)
                    result['revision'] = hashlib.sha256(latest).hexdigest()
                    check = root_open()
                    try: assert identity(check) == ident
                    finally: os.close(check)
                    if result['revision'] == p['revision']:
                        os.rename(temp, name, src_dir_fd=parent, dst_dir_fd=parent); os.fsync(parent)
                        result.update({'saved': True, 'revision': hashlib.sha256(data).hexdigest()})
                finally:
                    try: os.unlink(temp, dir_fd=parent)
                    except FileNotFoundError: pass
    finally: os.close(parent)
elif op in ('tree', 'search'):
    entries = []; visited = 0; limited = False
    def walk(path, depth):
        global visited, limited
        if depth > 12 or visited >= 2000 or len(entries) >= 500: limited = True; return
        fd = directory(parts(path, True))
        try:
            with os.scandir(fd) as listing:
                for entry in listing:
                    visited += 1
                    if visited > 2000 or len(entries) >= 500: limited = True; break
                    rel = path + '/' + entry.name if path else entry.name
                    try:
                        parts(rel); s = entry.stat(follow_symlinks=False)
                        isdir = stat.S_ISDIR(s.st_mode)
                        if not isdir and not (stat.S_ISREG(s.st_mode) and s.st_nlink == 1): continue
                        if op == 'tree' or p['search'].lower() in rel.lower():
                            entries.append({'path': rel, 'name': entry.name, 'kind': 'directory' if isdir else 'file'})
                        if op == 'search' and isdir: walk(rel, depth + 1)
                    except (OSError, AssertionError): continue
        finally: os.close(fd)
    walk(p.get('path', '') if op == 'tree' else '', 0)
    result.update({'entries': entries, 'limited': limited})
else: assert op == 'probe'
check = root_open()
try: assert identity(check) == ident
finally: os.close(check); os.close(rootfd)
print(json.dumps(result))
`;
