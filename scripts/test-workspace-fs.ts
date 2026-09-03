/** Focused workspace rename/delete atomicity and link-safety checks. */

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import {
  agentFiles,
  fsDelete,
  fsMutablePath,
  fsPathInfo,
  fsRead,
  fsRename,
  fsTree,
} from '../src/main/git/workspaceFs';

let passed = 0;
let failed = 0;

function check(label: string, condition: boolean, detail?: unknown): void {
  if (condition) {
    passed += 1;
    console.log(`  ok  ${label}`);
  } else {
    failed += 1;
    console.error(`FAIL  ${label}`, detail ?? '');
  }
}

function rejects(action: () => unknown): boolean {
  try {
    action();
    return false;
  } catch {
    return true;
  }
}

async function run(): Promise<void> {
  const scratch = mkdtempSync(join(tmpdir(), 'ade-workspace-fs-'));
  try {
    const workspace = join(scratch, 'workspace');
    const outside = join(scratch, 'outside');
    mkdirSync(join(workspace, 'docs'), { recursive: true });
    mkdirSync(outside);

    writeFileSync(join(workspace, 'docs', 'file.txt'), 'source\n');
    const fileResult = fsRename(workspace, 'docs/file.txt', 'renamed.txt');
    check('normal files rename within their parent',
      fileResult.path === 'docs/renamed.txt'
        && !existsSync(join(workspace, 'docs', 'file.txt'))
        && readFileSync(join(workspace, 'docs', 'renamed.txt'), 'utf8') === 'source\n');

    writeFileSync(join(workspace, 'docs', 'source.txt'), 'source\n');
    writeFileSync(join(workspace, 'docs', 'occupied.txt'), 'occupied\n');
    check('rename fails closed when the destination exists',
      rejects(() => fsRename(workspace, 'docs/source.txt', 'occupied.txt'))
        && readFileSync(join(workspace, 'docs', 'source.txt'), 'utf8') === 'source\n'
        && readFileSync(join(workspace, 'docs', 'occupied.txt'), 'utf8') === 'occupied\n');

    mkdirSync(join(workspace, 'folder'));
    writeFileSync(join(workspace, 'folder', 'child.txt'), 'child\n');
    const directoryRejected = rejects(() => fsRename(workspace, 'folder', 'folder-renamed'));
    if (process.platform === 'win32') {
      check('normal directories rename on Windows without replacement',
        !directoryRejected && existsSync(join(workspace, 'folder-renamed', 'child.txt')));
    } else {
      check('directory rename fails closed where Node has no no-clobber primitive',
        directoryRejected && existsSync(join(workspace, 'folder', 'child.txt')));
    }

    mkdirSync(join(workspace, 'swap-parent'));
    writeFileSync(join(workspace, 'swap-parent', 'victim.txt'), 'inside\n');
    writeFileSync(join(outside, 'victim.txt'), 'outside\n');
    fsMutablePath(workspace, 'swap-parent/victim.txt'); // simulate a stale earlier IPC validation
    rmSync(join(workspace, 'swap-parent'), { recursive: true });
    symlinkSync(outside, join(workspace, 'swap-parent'), process.platform === 'win32' ? 'junction' : 'dir');
    check('rename revalidates link components at the mutation boundary',
      rejects(() => fsRename(workspace, 'swap-parent/victim.txt', 'renamed.txt'))
        && existsSync(join(outside, 'victim.txt'))
        && !existsSync(join(outside, 'renamed.txt')));

    writeFileSync(join(workspace, 'delete-file.txt'), 'delete\n');
    let releaseTrash: (() => void) | undefined;
    let trashedPath = '';
    const trashPending = fsDelete(workspace, 'delete-file.txt', async (path) => {
      trashedPath = path;
      await new Promise<void>((resolve) => { releaseTrash = resolve; });
    });
    await Promise.resolve();
    const quarantineRel = relative(workspace, trashedPath);
    check('delete synchronously quarantines before asynchronous trash',
      !existsSync(join(workspace, 'delete-file.txt'))
        && quarantineRel !== ''
        && !quarantineRel.startsWith('..')
        && existsSync(trashedPath));
    releaseTrash?.();
    await trashPending;

    mkdirSync(join(workspace, 'delete-dir'));
    writeFileSync(join(workspace, 'delete-dir', 'child.txt'), 'delete dir\n');
    let directoryTrashPath = '';
    await fsDelete(workspace, 'delete-dir', async (path) => {
      directoryTrashPath = path;
      rmSync(path, { recursive: true });
    });
    check('normal directories are quarantined and sent to trash',
      !existsSync(join(workspace, 'delete-dir')) && !existsSync(directoryTrashPath));

    rmSync(join(workspace, 'swap-parent'));
    mkdirSync(join(workspace, 'delete-swap'));
    writeFileSync(join(workspace, 'delete-swap', 'victim.txt'), 'inside\n');
    fsMutablePath(workspace, 'delete-swap/victim.txt');
    rmSync(join(workspace, 'delete-swap'), { recursive: true });
    symlinkSync(outside, join(workspace, 'delete-swap'), process.platform === 'win32' ? 'junction' : 'dir');
    let trashCalled = false;
    let deleteSwapRejected = false;
    try {
      await fsDelete(workspace, 'delete-swap/victim.txt', async () => { trashCalled = true; });
    } catch {
      deleteSwapRejected = true;
    }
    check('delete revalidates link components before quarantine',
      deleteSwapRejected && !trashCalled && existsSync(join(outside, 'victim.txt')));

    /* ---------------- Thema 6: read-path parity with the mutation guards */

    const memory = join(scratch, 'memory');
    mkdirSync(memory);
    writeFileSync(join(memory, 'MEMORY.md'), 'memory\n');
    writeFileSync(join(outside, 'secret.txt'), 'outside secret\n');
    mkdirSync(join(workspace, 'plain'));
    writeFileSync(join(workspace, 'plain', 'note.md'), 'note\n');
    const linkType = process.platform === 'win32' ? 'junction' : 'dir';
    symlinkSync(outside, join(workspace, 'linked-dir'), linkType);
    try {
      symlinkSync(join(outside, 'secret.txt'), join(workspace, 'linked-file.txt'), 'file');
    } catch {
      // Windows without developer mode cannot create file symlinks; a junction
      // under the same name is the same class of entry for the lstat guard.
      symlinkSync(outside, join(workspace, 'linked-file.txt'), 'junction');
    }

    check('plain reads still work and pinned files fall back to the memory dir',
      fsRead(workspace, memory, 'plain/note.md').text === 'note\n'
        && fsRead(workspace, memory, 'MEMORY.md').text === 'memory\n'
        && fsPathInfo(workspace, memory, 'MEMORY.md').location === 'memory');
    check('reads refuse a linked directory component instead of following it',
      rejects(() => fsRead(workspace, memory, 'linked-dir/secret.txt'))
        && rejects(() => fsPathInfo(workspace, memory, 'linked-dir/secret.txt'))
        && rejects(() => fsTree(workspace, 'linked-dir')));
    check('reads refuse a linked file leaf',
      rejects(() => fsRead(workspace, memory, 'linked-file.txt'))
        && rejects(() => fsPathInfo(workspace, memory, 'linked-file.txt')));
    const rootTree = fsTree(workspace, '');
    check('directory listings never follow links: a linked directory is not expandable',
      rootTree.children?.some((node) => node.name === 'linked-dir' && node.kind === 'file') === true
        && rootTree.children?.some((node) => node.name === 'plain' && node.kind === 'dir') === true,
      rootTree.children);
    check('missing entries stay missing rather than becoming errors',
      fsRead(workspace, memory, 'plain/nope.md').text === ''
        && fsPathInfo(workspace, memory, 'plain/nope.md').kind === 'missing'
        && fsTree(workspace, 'plain/nope').children?.length === 0);
    check('lexical escapes are still rejected before any filesystem access',
      rejects(() => fsPathInfo(workspace, memory, '../outside/secret.txt'))
        && fsRead(workspace, memory, '../outside/secret.txt').text === '');
    try {
      symlinkSync(join(outside, 'secret.txt'), join(memory, 'USER.md'), 'file');
    } catch {
      // No file-symlink privilege: a junction named like the pinned file is
      // the same class of entry for the lstat-based check.
      symlinkSync(outside, join(memory, 'USER.md'), 'junction');
    }
    check('pinned agent files that are links are not offered',
      !agentFiles(workspace, memory).some((file) => file.name === 'USER.md')
        && agentFiles(workspace, memory).some((file) => file.name === 'MEMORY.md' && file.location === 'memory'));
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }

  console.log(`\nWorkspace filesystem checks: ${passed} passed, ${failed} failed.`);
  if (failed > 0) process.exitCode = 1;
}

void run();
