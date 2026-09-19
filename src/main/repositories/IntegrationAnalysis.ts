import { t as translate } from "../../shared/i18n";
import { createHash } from 'node:crypto';
import { existsSync, lstatSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { AdeConfig, Repository, SessionMeta } from '../../shared/types';
import type { IntegrationFile, IntegrationSource } from '../../shared/remote';
import { workbenchPath } from '../application/RemoteWorkbenchService';
import { redactForWire } from '../errors';
import { sameHostPath } from '../platform';
import { assertNoLinks } from './pathDiscipline';
import { integrationGit, readIntegrationFile } from './IntegrationGit';
import type { ProjectWorkspaceService } from './ProjectWorkspaceService';

export const integrationDigest = (value: unknown): string => createHash('sha256').update(Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');
export const integrationFail = (message: string): never => { throw new Error(`ade: ${message}`); };
export const gitText = async (cwd: string, args: string[], options?: Parameters<typeof integrationGit>[2]): Promise<string> => (await integrationGit(cwd, args, options)).stdout.toString('utf8').trim();
export const gitNames = async (cwd: string, args: string[]): Promise<string[]> => (await integrationGit(cwd, args)).stdout.toString('utf8').split('\0').filter(Boolean);
export interface IntegrationContent { path: string; body: Buffer | null; mode: string; oid: string | null }
export interface IntegrationSourceRecord { view: IntegrationSource; path: string; identity: string }

/** Check Git metadata before plumbing and refuse external content/merge drivers. */
export async function assertIntegrationGit(cwd: string, gitDirectory: string, common: string): Promise<void> {
  for (const root of new Set([gitDirectory, common])) {
    for (const name of ['config', 'config.worktree', 'index', 'HEAD', 'MERGE_HEAD', 'MERGE_MSG', 'ORIG_HEAD', 'refs', 'refs/heads/ade', 'refs/ade/integrations', 'objects', 'info', 'shallow']) {
      const path = join(root, name); assertNoLinks(path);
      if (existsSync(path) && lstatSync(path).isFile() && lstatSync(path).nlink !== 1) integrationFail(translate("Linked git metadata is not used."));
    }
  }
  const ref = await gitText(cwd, ['symbolic-ref', '--quiet', 'HEAD'], { accept: [1] });
  if (ref) {
    if (!ref.startsWith('refs/heads/') || ref.split('/').some((part) => !part || part === '.' || part === '..') || /[\\:\x00-\x1f]/.test(ref)) integrationFail(translate("Invalid git branch reference."));
    assertNoLinks(join(common, ref));
  }
  const drivers = await gitText(cwd, ['config', '--get-regexp', '^(filter\\..*\\.(clean|smudge|process)|merge\\..*\\.driver|merge\\.default)$'], { accept: [1] });
  // Git for Windows installs LFS drivers globally even for ordinary repositories.
  // Plumbing disables those drivers; repositories actually using filters are refused.
  if (drivers.split(/\r?\n/).some((line) => line && !/^filter\.lfs\.(?:clean|smudge|process)(?:\s|$)/.test(line))) integrationFail(translate("Check external Git filters or merge drivers on the PC first. This integration does not execute them."));
  const tracked = (await integrationGit(cwd, ['ls-files', '-z', '--cached', '--others', '--exclude-standard'])).stdout;
  for (const cached of [false, true]) {
    const attributes = (await integrationGit(cwd, ['check-attr', '-z', ...(cached ? ['--cached'] : []), '--stdin', 'filter'], { input: tracked })).stdout.toString('utf8').split('\0');
    if (attributes.some((value, index) => index % 3 === 2 && !['unspecified', 'unset'].includes(value))) integrationFail(translate("Files with Git content filters (e.g. LFS) require manual adoption."));
  }
}

export async function integrationSources(config: AdeConfig, repository: Repository, projects: ProjectWorkspaceService): Promise<IntegrationSourceRecord[]> {
  const target = await projects.inspectCheckout(repository.rootPath, repository.id);
  await assertIntegrationGit(repository.rootPath, target.workspace.gitDirectory, repository.commonGitDir);
  const raw = (await integrationGit(repository.rootPath, ['worktree', 'list', '--porcelain', '-z'])).stdout.toString('utf8');
  const records: IntegrationSourceRecord[] = [];
  for (const record of raw.split('\0\0').slice(0, 100)) {
    const path = record.split('\0').find((line) => line.startsWith('worktree '))?.slice(9);
    if (!path || sameHostPath(path, repository.rootPath)) continue;
    try {
      const scope = await projects.inspectCheckout(path, repository.id);
      const identity = integrationDigest(scope);
      const binding = config.workspaceBindings.find((item) => item.repositoryId === repository.id && sameHostPath(item.workspaceDir, path));
      const name = config.agents.find((item) => item.id === binding?.agentId)?.name ?? basename(path);
      records.push({ path, identity, view: { id: 's' + integrationDigest([repository.id, path, identity]).slice(0, 32), name: redactForWire(name, 200), branch: redactForWire(scope.branch, 200) } });
    } catch { /* Unreachable or replaced checkouts are not selectable. */ }
  }
  return records;
}

export function integrationAvailability(config: AdeConfig, repository: Repository, paths: string[], sessions: SessionMeta[]): string[] {
  const reasons: string[] = [];
  if (config.runWorkspaceLeases.some((item) => item.status === 'active' && sameHostPath(item.commonGitDir, repository.commonGitDir))) reasons.push(translate("A managed job occupies this repository. Complete first."));
  if (sessions.some((item) => item.status === 'running' && (item.executionBackend ?? 'native') === 'native' && item.workspaceDir && paths.some((path) => sameHostPath(path, item.workspaceDir!)))) reasons.push(translate("A terminal is using the source, target or working copy. End it first."));
  return reasons;
}

export async function treeEntries(cwd: string, tree: string): Promise<Map<string, { oid: string; mode: string }>> {
  const entries = await gitNames(cwd, ['ls-tree', '-r', '-z', tree]);
  const result = new Map<string, { oid: string; mode: string }>();
  for (const entry of entries) {
    const match = /^(\d{6}) (?:blob|commit) ([a-f0-9]{40,64})\t([\s\S]+)$/.exec(entry);
    if (!match) integrationFail(translate("Git file tree cannot be safely read."));
    result.set(match![3]!, { mode: match![1]!, oid: match![2]! });
  }
  return result;
}

export async function integrationStatus(cwd: string): Promise<{ raw: string; paths: string[]; conflicts: string[] }> {
  const rows = await gitNames(cwd, ['status', '--porcelain=v1', '-z', '--no-renames', '--untracked-files=all', '--ignore-submodules=none']);
  if (rows.length > 200) integrationFail(translate("More than 200 local files. Divide changes into smaller integrations first."));
  return { raw: rows.join('\0'), paths: rows.map((line) => line.slice(3)), conflicts: rows.filter((line) => /^(?:DD|AU|UD|UA|DU|AA|UU)/.test(line)).map((line) => line.slice(3)) };
}

export async function integrationContents(cwd: string, paths: string[], head: string): Promise<IntegrationContent[]> {
  if (paths.length > 200) integrationFail(translate("Maximum 200 files per integration."));
  const tree = await treeEntries(cwd, head); const contents: IntegrationContent[] = []; let total = 0;
  for (const path of paths) {
    workbenchPath(path);
    if (redactForWire(path, 400) !== path) integrationFail(translate("A filename cannot be safely displayed. Check on the PC."));
    const mode = tree.get(path)?.mode ?? '100644';
    if (!['100644', '100755'].includes(mode)) integrationFail(translate("Links and submodules are not taken over."));
    const body = readIntegrationFile(join(cwd, path)); total += body?.length ?? 0;
    if (total > 16 * 1024 * 1024) integrationFail(translate("The selected files exceed 16 MiB. integration split."));
    const oid = body === null ? null : await gitText(cwd, ['hash-object', `--path=${path}`, '--stdin'], { input: body });
    contents.push({ path, body, mode, oid });
  }
  return contents;
}

export async function analyzeIntegration(repository: Repository, source: IntegrationSourceRecord, projects: ProjectWorkspaceService, sessions: SessionMeta[], config: AdeConfig) {
  const targetScope = await projects.inspectCheckout(repository.rootPath, repository.id);
  const sourceScope = await projects.inspectCheckout(source.path, repository.id);
  if (integrationDigest(sourceScope) !== source.identity) integrationFail(translate("Source workspace has been replaced."));
  await assertIntegrationGit(repository.rootPath, targetScope.workspace.gitDirectory, repository.commonGitDir);
  await assertIntegrationGit(source.path, sourceScope.workspace.gitDirectory, repository.commonGitDir);
  const sourceHead = await gitText(source.path, ['rev-parse', '--verify', 'HEAD']);
  const targetHead = await gitText(repository.rootPath, ['rev-parse', '--verify', 'HEAD']);
  const base = await gitText(source.path, ['merge-base', sourceHead, targetHead]);
  const sourceStatus = await integrationStatus(source.path); const targetStatus = await integrationStatus(repository.rootPath);
  const paths = [...new Set([...await gitNames(source.path, ['diff', '--name-only', '-z', '--no-renames', base, sourceHead]), ...sourceStatus.paths])].sort();
  const contents = await integrationContents(source.path, paths, sourceHead);
  const baseTree = await treeEntries(source.path, base); const targetTree = await treeEntries(source.path, targetHead);
  const blockers = integrationAvailability(config, repository, [source.path, repository.rootPath], sessions);
  if (targetStatus.raw) blockers.push(translate("Main workspace contains local changes. Prepare only after the backup is possible."));
  if (sourceStatus.conflicts.length) blockers.push(translate("The source contains unresolved conflicts."));
  for (const scope of [targetScope, sourceScope]) {
    if (scope.branch === '(detached HEAD)') blockers.push(translate("Source and destination need a checked-out branch."));
    for (const marker of ['MERGE_HEAD', 'rebase-merge', 'rebase-apply', 'CHERRY_PICK_HEAD', 'REVERT_HEAD']) if (existsSync(join(scope.workspace.gitDirectory, marker))) blockers.push(translate("The source or target contains an ongoing git operation."));
  }
  const files: IntegrationFile[] = contents.map((file) => {
    const old = baseTree.get(file.path); const target = targetTree.get(file.path);
    const equal = (value: typeof old) => (value?.oid ?? null) === file.oid && (!file.oid || (value?.mode ?? '100644') === file.mode);
    const present = equal(target); const unchanged = equal(old);
    const instructions = /(?:^|\/)(?:AGENTS|CLAUDE|MEMORY|USER)\.md$/i.test(file.path);
    const assessment = present ? 'present' : (target?.oid ?? null) === (old?.oid ?? null) && target?.mode === old?.mode ? 'direct' : 'review';
    return { path: file.path, kind: file.oid === null ? 'deleted' : !old ? 'new' : 'modified', local: sourceStatus.paths.includes(file.path),
      assessment, selectable: !present && !unchanged, suggested: !present && !unchanged && !instructions,
      notice: present ? translate("Already included in the target.") : unchanged ? translate("No change from the common base.") : instructions ? translate("Agent instructions or memory: select only consciously.") : assessment === 'review' ? translate("Also changed in the target. Review the content and possible conflicts.") : null };
  });
  const counts = (await gitText(source.path, ['rev-list', '--left-right', '--count', `${sourceHead}...${targetHead}`])).split(/\s+/).map(Number);
  const fingerprint = integrationDigest([sourceScope, targetScope, sourceHead, targetHead, base, sourceStatus.raw, targetStatus.raw, contents.map(({ path, body, mode, oid }) => [path, body === null ? null : integrationDigest(body), mode, oid])]);
  const after = await projects.inspectCheckout(source.path, repository.id);
  if (integrationDigest(after) !== source.identity || await gitText(source.path, ['rev-parse', 'HEAD']) !== sourceHead || await gitText(repository.rootPath, ['rev-parse', 'HEAD']) !== targetHead) integrationFail(translate("Workspace changed during the test. Check again."));
  return { source, repository, sourceScope, targetScope, sourceHead, targetHead, base, contents, files, blockers, fingerprint, ownCommits: counts[0]!, behind: counts[1]! };
}
