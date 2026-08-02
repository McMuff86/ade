/**
 * Verified-path host for Windows.
 *
 * Windows offers none of the primitives the POSIX host relies on, and each
 * absence was measured on a real host rather than assumed:
 *
 * - `O_NOFOLLOW` and `O_DIRECTORY` are `undefined`, so the existing bit-ORs
 *   silently degrade to 0 instead of failing. Symlinks must be refused by hand.
 * - `openSync(danglingSymlink, 'wx')` SUCCEEDS and writes the link's target, so
 *   an exclusive create proves nothing about what was opened. This is the
 *   single most important difference and is why `createFile` verifies.
 * - `lstat.ino !== fstat.ino` reliably distinguishes a link (and a junction,
 *   which reports `isSymbolicLink() === true`) from the real entry.
 * - `fsyncSync` on a directory descriptor is `EPERM`, so `syncDir` cannot do
 *   anything and says so instead of pretending.
 * - A directory handle does NOT pin its directory: renaming a directory with an
 *   open handle succeeds. Anchors are therefore witnesses to be revalidated,
 *   never locks — and no directory handle is held at all, because an open
 *   handle can itself make a later rename or delete fail with EPERM.
 * - NTFS is case-insensitive but case-preserving, so path equality is folded.
 *
 * The residual gap versus POSIX is real: between the check and the use, a
 * component can still be replaced. Every operation re-checks identity after the
 * fact and fails closed, which turns silent corruption into a refused import.
 */

import {
  closeSync, constants, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readdirSync, realpathSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import type { ManagedAnchor, ManagedHost } from './ManagedHost';
import { sameManagedPath } from './ManagedPathNames';

interface Win32Anchor extends ManagedAnchor {
  readonly dev: bigint;
  readonly ino: bigint;
}

function anchorAt(addr: string, dev: bigint, ino: bigint): Win32Anchor {
  return { addr, fd: -1, dev, ino, close() { /* no descriptor is held; see header */ } };
}

/** A directory that is still the one we anchored, or a thrown error. */
function assertUnchanged(dir: ManagedAnchor): void {
  const current = lstatSync(dir.addr, { bigint: true });
  const expected = dir as Win32Anchor;
  if (!current.isDirectory() || current.isSymbolicLink()
      || current.dev !== expected.dev || current.ino !== expected.ino) {
    throw new Error('workspace profile: managed profile directory changed while it was in use');
  }
}

export class Win32ManagedHost implements ManagedHost {
  readonly platform: NodeJS.Platform = 'win32';

  anchorRoot(path: string): ManagedAnchor {
    const declared = resolve(path);
    const named = lstatSync(declared, { bigint: true });
    if (!named.isDirectory() || named.isSymbolicLink()) {
      throw new Error('workspace profile: ADE data directory must be a canonical non-symlink directory');
    }
    // The real spelling is what every subsequent path is built from. It is
    // deliberately NOT compared to `declared`: os.tmpdir() hands back an 8.3
    // short name on this host (C:\Users\ADI~1.MUF\...) which realpath expands,
    // and the E2E harness roots its profile under tmpdir.
    const real = realpathSync.native(declared);
    const opened = lstatSync(real, { bigint: true });
    if (!opened.isDirectory() || opened.dev !== named.dev || opened.ino !== named.ino) {
      throw new Error('workspace profile: ADE data directory could not be anchored safely');
    }
    if (opened.ino === BigInt(0)) {
      // Some network filesystems report no usable file id, which would make
      // every identity check below vacuously true.
      throw new Error('workspace profile: ADE data directory is on a volume without stable file ids');
    }
    return anchorAt(real, opened.dev, opened.ino);
  }

  openDir(parent: ManagedAnchor, name: string): ManagedAnchor {
    assertUnchanged(parent);
    const candidate = `${parent.addr}/${name}`;
    const named = lstatSync(candidate, { bigint: true });
    if (named.isSymbolicLink()) {
      throw new Error('workspace profile: managed profile ancestor is a link');
    }
    if (!named.isDirectory()) {
      throw new Error('workspace profile: managed profile ancestor is not a directory');
    }
    // parent.addr is already canonical, so the child's real path must be
    // exactly one component below it. Folded, because NTFS returns the on-disk
    // spelling: `photos` resolves to `PHOTOS` when that is how it was created.
    const real = realpathSync.native(candidate);
    if (!sameManagedPath(real, join(parent.addr, name), 'win32')) {
      throw new Error('workspace profile: managed profile ancestor resolves outside its parent');
    }
    const opened = lstatSync(real, { bigint: true });
    if (opened.dev !== named.dev || opened.ino !== named.ino) {
      throw new Error('workspace profile: managed profile ancestor changed while it was opened');
    }
    return anchorAt(real, opened.dev, opened.ino);
  }

  openFile(parent: ManagedAnchor, name: string): number {
    assertUnchanged(parent);
    const candidate = `${parent.addr}/${name}`;
    // lstat first so a link is refused before it is ever opened; the post-open
    // identity check then covers a swap inside the race window.
    const named = lstatSync(candidate, { bigint: true });
    if (named.isSymbolicLink()) {
      throw new Error('workspace profile: managed profile entry is a link');
    }
    const fd = openSync(candidate, constants.O_RDONLY);
    try {
      const opened = fstatSync(fd, { bigint: true });
      if (opened.dev !== named.dev || opened.ino !== named.ino) {
        throw new Error('workspace profile: managed profile entry changed while it was opened');
      }
    } catch (error) { closeSync(fd); throw error; }
    return fd;
  }

  createFile(parent: ManagedAnchor, name: string, mode: number): number {
    assertUnchanged(parent);
    const candidate = `${parent.addr}/${name}`;
    // Exclusive, but not trusted: a dangling symlink here would be followed and
    // the target created. The descriptor is verified before the caller may
    // write through it, so the worst case is an empty file at a path the
    // attacker had already chosen — never attacker-controlled content.
    const fd = openSync(candidate, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, mode);
    try {
      const opened = fstatSync(fd, { bigint: true });
      const named = lstatSync(candidate, { bigint: true });
      if (!opened.isFile() || opened.nlink !== BigInt(1) || named.isSymbolicLink()
          || opened.dev !== named.dev || opened.ino !== named.ino) {
        throw new Error('workspace profile: managed profile file was substituted as it was created');
      }
    } catch (error) { closeSync(fd); throw error; }
    return fd;
  }

  makeDir(parent: ManagedAnchor, name: string): void {
    assertUnchanged(parent);
    try { mkdirSync(`${parent.addr}/${name}`, { recursive: false }); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
  }

  entries(dir: ManagedAnchor): string[] {
    assertUnchanged(dir);
    return readdirSync(dir.addr);
  }

  syncDir(_dir: ManagedAnchor): void {
    // fsync of a directory is EPERM on Windows. NTFS journals the metadata, so
    // there is nothing to force here; pretending otherwise would only hide it.
  }

  syncFile(fd: number): void {
    fsyncSync(fd);
  }
}
