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
  fsDelete,
  fsMutablePath,
  fsRename,
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
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }

  console.log(`\nWorkspace filesystem checks: ${passed} passed, ${failed} failed.`);
  if (failed > 0) process.exitCode = 1;
}

void run();
