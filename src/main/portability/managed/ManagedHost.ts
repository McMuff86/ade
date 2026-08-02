/**
 * The platform seam under the managed profile reader and writer.
 *
 * ADE's profile directory holds the only copy of the agent catalog, the run
 * journal and the publication audit, so every managed path is resolved through
 * a host that refuses anything which is not the entry it expected. The two
 * hosts buy that guarantee differently:
 *
 * - POSIX anchors a directory descriptor and addresses children as
 *   `/proc/self/fd/<fd>/<name>` with `O_NOFOLLOW`. A component cannot be
 *   swapped between the check and the use, because there is no second lookup.
 * - Win32 has neither descriptor-relative syscalls nor `O_NOFOLLOW`, and a
 *   directory handle does not pin its directory (measured: renaming a directory
 *   with an open handle succeeds). It therefore *detects* instead of
 *   preventing: every open is followed by an identity check that fails closed.
 *
 * The important consequence is spelled out where it bites — `createFile` — and
 * the residual difference is reported to the user through `managedProfileSupport`
 * rather than hidden.
 */

export interface ManagedAnchor {
  /** Prefix such that `${addr}/${name}` addresses a child. */
  readonly addr: string;
  /** Directory descriptor, or -1 where the platform cannot usefully hold one. */
  readonly fd: number;
  close(): void;
}

export interface ManagedHost {
  readonly platform: NodeJS.Platform;
  /** Anchor a profile root, refusing anything but a canonical real directory. */
  anchorRoot(path: string): ManagedAnchor;
  /** Open `name` under `parent` as a directory. Throws ENOENT when absent. */
  openDir(parent: ManagedAnchor, name: string): ManagedAnchor;
  /** Open `name` under `parent` for reading. Throws ENOENT when absent. */
  openFile(parent: ManagedAnchor, name: string): number;
  /**
   * Exclusively create `name` under `parent` and return a descriptor the caller
   * may write to. Implementations must guarantee the descriptor refers to the
   * regular file just created — on Win32 an exclusive create is NOT sufficient
   * evidence of that (measured: `openSync(danglingSymlink, 'wx')` succeeds and
   * writes the link's target), so it is verified before the caller sees it.
   */
  createFile(parent: ManagedAnchor, name: string, mode: number): number;
  /** Create `name` under `parent` as a directory, tolerating an existing one. */
  makeDir(parent: ManagedAnchor, name: string): void;
  /** Entry names of an anchored directory. */
  entries(dir: ManagedAnchor): string[];
  /** Flush a directory where the platform supports it; a no-op where it cannot. */
  syncDir(dir: ManagedAnchor): void;
  syncFile(fd: number): void;
}

export type ManagedProfileLevel = 'descriptor-anchored' | 'verified-path' | 'unsupported';

export interface ManagedProfileSupport {
  level: ManagedProfileLevel;
  /** Whether a workspace import may be applied on this host. */
  canApply: boolean;
  /** Whether managed assets (photos, memory) can be read and written. */
  managedAssets: boolean;
  /** Non-null when the user should be told what this host cannot guarantee. */
  notice: { code: string; message: string } | null;
}

/**
 * The single source of truth for "may this host apply", "is the backup manifest
 * complete" and "what do we tell the user". Kept in one place because these
 * three answers drifting apart is exactly how a host gate becomes a lie.
 */
export function managedProfileSupport(platform: NodeJS.Platform): ManagedProfileSupport {
  if (platform === 'linux') {
    return { level: 'descriptor-anchored', canApply: true, managedAssets: true, notice: null };
  }
  if (platform === 'win32') {
    return {
      level: 'verified-path',
      canApply: true,
      managedAssets: true,
      notice: {
        code: 'workspace-import-host-degraded',
        message: 'On Windows ADE verifies every managed path after opening it instead of '
          + 'anchoring it to a directory descriptor, and cannot flush directory entries. An '
          + 'import is still transactional and still refuses substituted paths, but a crash '
          + 'mid-import may leave the journal to be replayed at the next start.',
      },
    };
  }
  return {
    level: 'unsupported',
    canApply: false,
    managedAssets: false,
    notice: {
      code: 'workspace-import-host-unsupported',
      message: 'Workspace import apply is supported only on Linux and Windows hosts.',
    },
  };
}
