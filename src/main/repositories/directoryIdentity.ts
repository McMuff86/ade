/**
 * Persisted identity of a directory or Git link file.
 *
 * `st_dev` is not stable across mounts on every filesystem: btrfs hands each
 * subvolume an anonymous device number at mount time, so the same folder
 * reports a different `dev` after a reboot. When the filesystem records a
 * creation time, inode plus creation time already identify the object and a
 * replaced folder still gets a new inode/creation time. Only filesystems
 * without a creation time keep `dev` as part of the identity.
 */
export function stableIdentity(stat: { dev: number; ino: number; birthtimeMs: number }): string {
  return stat.birthtimeMs > 0 ? `${stat.ino}:${stat.birthtimeMs}` : `${stat.dev}:${stat.ino}:${stat.birthtimeMs}`;
}

const LEGACY_DIRECTORY = /^\d+:(\d+):(\d+(?:\.\d+)?)$/;
const LEGACY_LINK_FILE = /^\d+:(\d+):(\d+(?:\.\d+)?):(\d+:\d+(?:\.\d+)?)$/;

/**
 * Rewrites an identity written before `stableIdentity` (`dev:ino:birth` for a
 * directory, `dev:ino:birth:size:mtime` for a Git link file) into the current
 * form. Values that already match, or whose creation time is zero, are kept.
 */
export function migrateLegacyIdentity(value: string): string {
  const link = LEGACY_LINK_FILE.exec(value);
  if (link && Number(link[2]) > 0) return `${link[1]}:${link[2]}:${link[3]}`;
  const directory = LEGACY_DIRECTORY.exec(value);
  if (directory && Number(directory[2]) > 0) return `${directory[1]}:${directory[2]}`;
  return value;
}
