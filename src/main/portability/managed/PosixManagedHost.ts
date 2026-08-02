/**
 * Descriptor-anchored host. This is the behaviour ADE has always had on Linux,
 * moved behind the ManagedHost seam without a semantic change: the root is
 * pinned by descriptor and every child is addressed relative to it through
 * /proc/self/fd with O_NOFOLLOW, so no component can be substituted between
 * the check and the use.
 */

import {
  closeSync, constants, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readdirSync, realpathSync,
} from 'node:fs';
import { resolve } from 'node:path';
import type { ManagedAnchor, ManagedHost } from './ManagedHost';

const DIRECTORY_FLAG = (constants as unknown as Record<string, number>).O_DIRECTORY ?? 0;
const NO_FOLLOW = typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0;

function anchor(fd: number): ManagedAnchor {
  return {
    addr: `/proc/self/fd/${fd}`,
    fd,
    close() { closeSync(fd); },
  };
}

export class PosixManagedHost implements ManagedHost {
  readonly platform: NodeJS.Platform = 'linux';

  anchorRoot(path: string): ManagedAnchor {
    const expected = resolve(path);
    const info = lstatSync(expected, { bigint: true });
    const real = realpathSync.native(expected);
    if (!info.isDirectory() || info.isSymbolicLink() || real !== expected) {
      throw new Error('workspace profile: ADE data directory must be a canonical non-symlink directory');
    }
    const fd = openSync(expected, constants.O_RDONLY | DIRECTORY_FLAG | NO_FOLLOW);
    const opened = fstatSync(fd, { bigint: true });
    const descriptorReal = realpathSync.native(`/proc/self/fd/${fd}`);
    if (!opened.isDirectory() || opened.dev !== info.dev || opened.ino !== info.ino
        || descriptorReal !== real) {
      closeSync(fd);
      throw new Error('workspace profile: ADE data directory could not be anchored safely');
    }
    return anchor(fd);
  }

  openDir(parent: ManagedAnchor, name: string): ManagedAnchor {
    const fd = openSync(`${parent.addr}/${name}`, constants.O_RDONLY | DIRECTORY_FLAG | NO_FOLLOW);
    try {
      if (!fstatSync(fd).isDirectory()) {
        throw new Error('workspace profile: managed profile ancestor is not a directory');
      }
    } catch (error) { closeSync(fd); throw error; }
    return anchor(fd);
  }

  openFile(parent: ManagedAnchor, name: string): number {
    return openSync(`${parent.addr}/${name}`, constants.O_RDONLY | NO_FOLLOW);
  }

  createFile(parent: ManagedAnchor, name: string, mode: number): number {
    // O_NOFOLLOW makes the exclusive create sufficient here: the kernel refuses
    // to traverse a final symlink, so nothing else can be what was created.
    return openSync(
      `${parent.addr}/${name}`,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | NO_FOLLOW,
      mode,
    );
  }

  makeDir(parent: ManagedAnchor, name: string): void {
    try { mkdirSync(`${parent.addr}/${name}`, { recursive: false, mode: 0o700 }); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
  }

  entries(dir: ManagedAnchor): string[] {
    return readdirSync(dir.addr);
  }

  syncDir(dir: ManagedAnchor): void {
    fsyncSync(dir.fd);
  }

  syncFile(fd: number): void {
    fsyncSync(fd);
  }
}
