import { t as translate } from "../../shared/i18n";
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { Repository } from '../../shared/types';
import type { ProjectWorkspace } from '../../shared/projectWorkspaces';
import { validProjectBranchName } from '../../shared/projectBranches';
import { sameHostPath } from '../platform';
import { assertNoLinks } from './pathDiscipline';

/** Small metadata reads with the same before/after link and file identity checks
 * as other native workspace reads. No repository content, config or executable. */
function metadata(path: string): string {
  assertNoLinks(path);
  const before = lstatSync(path);
  if (!before.isFile() || before.nlink !== 1 || before.size > 4096) throw new Error(translate("ade: Terminal workspace metadata is invalid."));
  const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const stat = fstatSync(fd); const bytes = Buffer.alloc(4097);
    let count = 0;
    while (count < bytes.length) {
      const size = readSync(fd, bytes, count, bytes.length - count, count);
      if (!size) break; count += size;
    }
    assertNoLinks(path); const after = lstatSync(path);
    if (!stat.isFile() || count !== before.size || count > 4096 || [stat, after].some(value => value.nlink !== 1 || value.dev !== before.dev || value.ino !== before.ino
      || value.birthtimeMs !== before.birthtimeMs || value.size !== before.size || value.mtimeMs !== before.mtimeMs)) {
      throw new Error(translate("ade: Terminal workspace metadata has been changed during reading."));
    }
    const text = bytes.subarray(0, count).toString('utf8');
    if (text.includes('\0') || !Buffer.from(text, 'utf8').equals(bytes.subarray(0, count))) throw new Error(translate("ade: Terminal workspace metadata is not readable."));
    return text.trim();
  } finally { closeSync(fd); }
}

/** Authority here is the registered, already launched PTY's directory topology,
 * not Git's current configurable working-tree interpretation. Opening, starting
 * and every filesystem/Git action still use ProjectWorkspaceService.resolve.
 * Return null for uncommon layouts/HEAD chains so the full Git resolver applies.
 * Caller checks all recorded directory/pointer identities on both sides. */
export function terminalWorkspaceBranch(workspace: ProjectWorkspace, repository: Repository): string | null {
  const mainGit = join(repository.rootPath, '.git');
  assertNoLinks(repository.rootPath); assertNoLinks(mainGit);
  if (!sameHostPath(mainGit, repository.commonGitDir) || !lstatSync(mainGit).isDirectory()) return null;
  const pointer = join(workspace.workspaceDir, '.git');
  if (workspace.kind === 'checkout') {
    if (!sameHostPath(workspace.workspaceDir, repository.rootPath) || !sameHostPath(workspace.gitDirectory, mainGit) || !lstatSync(pointer).isDirectory()) return null;
  } else {
    const target = /^gitdir: ([^\r\n\0]+)$/.exec(metadata(pointer))?.[1];
    if (!target || !sameHostPath(resolve(workspace.workspaceDir, target), workspace.gitDirectory)) throw new Error(translate("ade: Git link of the terminal has been changed."));
    if (!sameHostPath(resolve(workspace.gitDirectory, metadata(join(workspace.gitDirectory, 'commondir'))), repository.commonGitDir)
      || !sameHostPath(resolve(workspace.gitDirectory, metadata(join(workspace.gitDirectory, 'gitdir'))), pointer)) {
      throw new Error(translate("ade: Git assignment of the terminal has been changed."));
    }
  }
  const head = metadata(join(workspace.gitDirectory, 'HEAD'));
  if (/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(head)) return '(detached HEAD)';
  const branch = /^ref: refs\/heads\/(.+)$/.exec(head)?.[1];
  if (!branch || !validProjectBranchName(branch)) return null;
  // Git permits symbolic-ref chains. Keep those on its authoritative resolver.
  const branchFile = join(workspace.gitDirectory, 'refs', 'heads', branch);
  const commonBranchFile = join(repository.commonGitDir, 'refs', 'heads', branch);
  for (const file of new Set([branchFile, commonBranchFile])) {
    assertNoLinks(dirname(file));
    try { if (metadata(file).startsWith('ref:')) return null; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  return branch;
}
