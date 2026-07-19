import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type {
  FsPathInfoResult,
  FsReadResult,
  FsRenameResult,
} from '../../shared/ipc';
import type { ExecutionBackendId } from '../../shared/executionBackends';
import { NATIVE_EXECUTION_BACKEND, normalizeExecutionBackendId } from '../../shared/executionBackends';
import type { AgentFile, FsTreeNode } from '../../shared/types';
import {
  PINNED_AGENT_FILES,
  agentFiles,
  fsDelete,
  fsPathInfo,
  fsRead,
  fsRename,
  fsTree,
} from '../git/workspaceFs';
import { ExecutionBackendService } from './ExecutionBackendService';

const READ_CAP = 256 * 1024;

interface WslTreeResult { children: Array<{ name: string; kind: 'file' | 'dir' }> }
interface WslReadResult { textBase64: string; truncated: boolean; found: boolean }
interface WslPathResult { kind: 'file' | 'dir' | 'missing'; path: string }

/** Filesystem facade that never accesses a WSL worktree through a UNC path. */
export class BackendWorkspaceFs {
  constructor(private readonly execution = new ExecutionBackendService()) {}

  async tree(
    backendValue: ExecutionBackendId | undefined,
    workspaceDir: string,
    relPath = '',
  ): Promise<FsTreeNode> {
    const backend = normalizeExecutionBackendId(backendValue);
    if (backend === NATIVE_EXECUTION_BACKEND) return fsTree(workspaceDir, relPath);
    const name = relPath ? relPath.split('/').pop() ?? relPath : '';
    const result = await this.wsl<WslTreeResult>(backend, 'tree', workspaceDir, { rel: relPath });
    const children = result.children.map((entry) => ({
      name: entry.name,
      path: relPath ? `${relPath}/${entry.name}` : entry.name,
      kind: entry.kind,
    }));
    return { name, path: relPath, kind: 'dir', children };
  }

  async read(
    backendValue: ExecutionBackendId | undefined,
    workspaceDir: string,
    memoryDir: string,
    relPath: string,
  ): Promise<FsReadResult> {
    const backend = normalizeExecutionBackendId(backendValue);
    if (backend === NATIVE_EXECUTION_BACKEND) return fsRead(workspaceDir, memoryDir, relPath);
    const result = await this.wsl<WslReadResult>(backend, 'read', workspaceDir, {
      rel: relPath,
      cap: READ_CAP,
    });
    if (result.found) {
      return { text: Buffer.from(result.textBase64, 'base64').toString('utf8'), truncated: result.truncated };
    }
    return readPinnedMemory(memoryDir, relPath);
  }

  async pathInfo(
    backendValue: ExecutionBackendId | undefined,
    workspaceDir: string,
    memoryDir: string,
    relPath: string,
  ): Promise<FsPathInfoResult> {
    const backend = normalizeExecutionBackendId(backendValue);
    if (backend === NATIVE_EXECUTION_BACKEND) return fsPathInfo(workspaceDir, memoryDir, relPath);
    const result = await this.wsl<WslPathResult>(backend, 'path_info', workspaceDir, { rel: relPath });
    if (result.kind !== 'missing') {
      return { absolutePath: result.path, kind: result.kind, location: 'workspace' };
    }
    const memory = pinnedMemoryPath(memoryDir, relPath);
    if (memory) {
      return {
        absolutePath: memory,
        kind: statSync(memory).isDirectory() ? 'dir' : 'file',
        location: 'memory',
      };
    }
    return { absolutePath: result.path, kind: 'missing', location: 'workspace' };
  }

  async agentFiles(
    backendValue: ExecutionBackendId | undefined,
    workspaceDir: string,
    memoryDir: string,
  ): Promise<AgentFile[]> {
    const backend = normalizeExecutionBackendId(backendValue);
    if (backend === NATIVE_EXECUTION_BACKEND) return agentFiles(workspaceDir, memoryDir);
    const workspace = await this.wsl<{ names: string[] }>(backend, 'agent_files', workspaceDir, {});
    const found = new Set(workspace.names);
    return PINNED_AGENT_FILES.flatMap((name): AgentFile[] => {
      if (found.has(name)) return [{ name, path: name, location: 'workspace' }];
      return existsSync(join(memoryDir, name)) ? [{ name, path: name, location: 'memory' }] : [];
    });
  }

  async rename(
    backendValue: ExecutionBackendId | undefined,
    workspaceDir: string,
    relPath: string,
    newName: string,
  ): Promise<FsRenameResult> {
    const backend = normalizeExecutionBackendId(backendValue);
    if (backend === NATIVE_EXECUTION_BACKEND) return fsRename(workspaceDir, relPath, newName);
    await this.wsl(backend, 'rename', workspaceDir, { rel: relPath, newName });
    const directory = relPath.split('/').slice(0, -1).join('/');
    return { path: directory ? `${directory}/${newName}` : newName };
  }

  async delete(
    backendValue: ExecutionBackendId | undefined,
    workspaceDir: string,
    relPath: string,
    nativeTrash: (path: string) => Promise<void>,
  ): Promise<void> {
    const backend = normalizeExecutionBackendId(backendValue);
    if (backend === NATIVE_EXECUTION_BACKEND) {
      await fsDelete(workspaceDir, relPath, nativeTrash);
      return;
    }
    await this.wsl(backend, 'trash', workspaceDir, { rel: relPath });
  }

  private async wsl<T>(
    backend: ExecutionBackendId,
    operation: string,
    root: string,
    payload: Record<string, unknown>,
  ): Promise<T> {
    const output = await this.execution.text(backend, 'python3', ['-I', '-c', WSL_FS_HELPER], {
      input: JSON.stringify({ operation, root, ...payload }),
      timeoutMs: 30_000,
      maxBuffer: 2 * 1024 * 1024,
    });
    try {
      return JSON.parse(output) as T;
    } catch {
      throw new Error('ade: WSL filesystem helper returned invalid data');
    }
  }
}

function pinnedMemoryPath(memoryDir: string, relPath: string): string | null {
  const base = relPath.split('/').pop() ?? relPath;
  if (!(PINNED_AGENT_FILES as readonly string[]).includes(base)) return null;
  const path = join(memoryDir, base);
  return existsSync(path) ? path : null;
}

function readPinnedMemory(memoryDir: string, relPath: string): FsReadResult {
  const path = pinnedMemoryPath(memoryDir, relPath);
  if (!path) return { text: '', truncated: false };
  try {
    if (statSync(path).isDirectory()) return { text: '', truncated: false };
    const contents = readFileSync(path);
    const truncated = contents.byteLength > READ_CAP;
    return { text: contents.subarray(0, READ_CAP).toString('utf8'), truncated };
  } catch {
    return { text: '', truncated: false };
  }
}

/**
 * Runs inside the selected distro. Requests arrive as JSON on stdin; paths and
 * names are never interpreted by a shell. renameat2(RENAME_NOREPLACE) provides
 * an atomic no-clobber primitive for both regular files and directories.
 */
const WSL_FS_HELPER = String.raw`
import base64, ctypes, errno, json, os, stat, subprocess, sys, tempfile

request = json.load(sys.stdin)
root = os.path.realpath(request['root'])
if not os.path.isdir(root):
    raise RuntimeError('ade: WSL workspace does not exist')

def relative_parts(value, allow_empty=False):
    if not isinstance(value, str) or '\x00' in value:
        raise RuntimeError('ade: invalid workspace path')
    value = value.replace('\\', '/')
    if value.startswith('/'):
        raise RuntimeError('ade: path escapes the selected workspace')
    parts = value.split('/') if value else []
    if (not allow_empty and not parts) or any(part in ('', '.', '..') for part in parts):
        raise RuntimeError('ade: path escapes the selected workspace')
    return parts

def candidate(value, allow_empty=False):
    parts = relative_parts(value, allow_empty)
    path = os.path.normpath(os.path.join(root, *parts))
    if os.path.commonpath([root, path]) != root:
        raise RuntimeError('ade: path escapes the selected workspace')
    return path, parts

def assert_no_links(parts, allow_missing_leaf=False):
    current = root
    if stat.S_ISLNK(os.lstat(current).st_mode):
        raise RuntimeError('ade: workspace mutation refuses symlink components')
    for index, part in enumerate(parts):
        current = os.path.join(current, part)
        try:
            mode = os.lstat(current).st_mode
        except FileNotFoundError:
            if allow_missing_leaf and index == len(parts) - 1:
                return
            raise
        if stat.S_ISLNK(mode):
            raise RuntimeError('ade: workspace operation refuses symlink components')

def safe_existing(value):
    path, parts = candidate(value)
    assert_no_links(parts)
    real = os.path.realpath(path)
    if os.path.commonpath([root, real]) != root or real == root:
        raise RuntimeError('ade: path escapes the selected workspace')
    return path, parts

def rename_noreplace(source, target):
    libc = ctypes.CDLL(None, use_errno=True)
    call = getattr(libc, 'renameat2', None)
    if call is None:
        raise RuntimeError('ade: this WSL kernel lacks atomic no-clobber rename')
    call.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
    call.restype = ctypes.c_int
    result = call(-100, os.fsencode(source), -100, os.fsencode(target), 1)
    if result != 0:
        code = ctypes.get_errno()
        if code == errno.EEXIST:
            raise RuntimeError('ade: destination already exists')
        raise OSError(code, os.strerror(code), target)

operation = request['operation']
if operation == 'tree':
    directory, parts = candidate(request.get('rel', ''), True)
    if parts:
        assert_no_links(parts)
    children = []
    if os.path.isdir(directory):
        with os.scandir(directory) as entries:
            for entry in entries:
                if entry.name in ('.git', 'node_modules'):
                    continue
                kind = 'dir' if entry.is_dir(follow_symlinks=False) else 'file'
                children.append({'name': entry.name, 'kind': kind})
                if len(children) > 10000:
                    raise RuntimeError('ade: WSL directory exceeds 10000 visible entries')
    children.sort(key=lambda item: (item['kind'] != 'dir', item['name'].casefold(), item['name']))
    print(json.dumps({'children': children}, ensure_ascii=False))
elif operation == 'read':
    path, parts = candidate(request['rel'])
    try:
        assert_no_links(parts)
        descriptor = os.open(path, os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0))
        try:
            info = os.fstat(descriptor)
            if not stat.S_ISREG(info.st_mode):
                print(json.dumps({'textBase64': '', 'truncated': False, 'found': True}))
            else:
                cap = min(int(request.get('cap', 262144)), 262144)
                data = os.read(descriptor, cap + 1)
                print(json.dumps({'textBase64': base64.b64encode(data[:cap]).decode('ascii'), 'truncated': len(data) > cap, 'found': True}))
        finally:
            os.close(descriptor)
    except FileNotFoundError:
        print(json.dumps({'textBase64': '', 'truncated': False, 'found': False}))
elif operation == 'path_info':
    path, parts = candidate(request['rel'])
    kind = 'missing'
    try:
        assert_no_links(parts)
        mode = os.lstat(path).st_mode
        kind = 'dir' if stat.S_ISDIR(mode) else ('file' if stat.S_ISREG(mode) else 'missing')
    except FileNotFoundError:
        pass
    print(json.dumps({'path': path, 'kind': kind}, ensure_ascii=False))
elif operation == 'agent_files':
    names = []
    for name in ('MEMORY.md', 'USER.md', 'CLAUDE.md', 'AGENTS.md'):
        path = os.path.join(root, name)
        try:
            if stat.S_ISREG(os.lstat(path).st_mode):
                names.append(name)
        except FileNotFoundError:
            pass
    print(json.dumps({'names': names}))
elif operation == 'rename':
    new_name = request['newName']
    if not isinstance(new_name, str) or not new_name or new_name.strip() != new_name or '/' in new_name or '\\' in new_name or new_name in ('.', '..') or '\x00' in new_name:
        raise RuntimeError('ade: newName must be a bare file or folder name')
    source, parts = safe_existing(request['rel'])
    target = os.path.join(os.path.dirname(source), new_name)
    target_parts = parts[:-1] + [new_name]
    assert_no_links(target_parts, True)
    assert_no_links(parts)
    rename_noreplace(source, target)
    print('{}')
elif operation == 'trash':
    source, parts = safe_existing(request['rel'])
    quarantine = tempfile.mkdtemp(prefix='.ade-trash-', dir=root)
    target = os.path.join(quarantine, os.path.basename(source))
    try:
        assert_no_links(parts)
        rename_noreplace(source, target)
        completed = subprocess.run(['gio', 'trash', '--', target], stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=30)
        if completed.returncode != 0:
            raise RuntimeError('ade: WSL trash failed: ' + completed.stderr.decode('utf-8', 'replace')[:500])
        os.rmdir(quarantine)
        print('{}')
    except Exception as original:
        rollback_error = None
        if os.path.lexists(target):
            try:
                rename_noreplace(target, source)
            except Exception as caught:
                rollback_error = caught
        if os.path.isdir(quarantine) and not os.listdir(quarantine):
            os.rmdir(quarantine)
        if rollback_error is not None:
            raise RuntimeError('ade: WSL trash failed and rollback could not restore the source') from rollback_error
        raise
else:
    raise RuntimeError('ade: unsupported WSL filesystem operation')
`;
