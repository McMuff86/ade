import { t as translate } from "../../shared/i18n";
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { opendir } from 'node:fs/promises';
import { lstatSync, realpathSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import type { AdeConfig, Repository } from '../../shared/types';
import type { ProjectWorkspace } from '../../shared/projectWorkspaces';
import type { ProjectDirectoryEntry, ProjectDirectoryView, ProjectWorkspaceView } from '../../shared/remote';
import { projectRootIdentity } from '../settings/ProjectDefaultsService';
import { redactForWire } from '../errors';
import { hostPathKey, sameHostPath } from '../platform';
import { assertNoLinks } from './pathDiscipline';
import { workspaceOperations } from './WorkspaceOperationGate';
import { terminalWorkspaceBranch } from './TerminalWorkspaceIdentity';

const execute = promisify(execFile);
const MAX_ENTRIES = 500;
const MAX_SCANNED = 2000;
const OMIT = new Set(['.git', '.ade-worktrees', 'node_modules']);
const GIT_LOCATION_ENV = new Set(['GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES']);
interface ConfigPort { get(): AdeConfig; save(value: Partial<AdeConfig>): AdeConfig }
interface DirectoryTarget { entry: ProjectDirectoryEntry; path: string; identity: string; rootIdentity?: string }
interface GitIdentity { top: string; main: string; git: string; common: string; pointer: string; branch: string }
export type ProjectAuthorization = (target?: { repositoryId?: string; workspaceId?: string }) => void;

/** Native checkout discovery and identity only. Opening never creates an agent,
 * writes repository instructions, checks out a branch, or launches a CLI.
 */
export class ProjectWorkspaceService {
  constructor(private readonly store: ConfigPort, private readonly changed: () => void = () => undefined) {}

  async directory(): Promise<ProjectDirectoryView> {
    const result = await this.discover();
    return { configured: result.configured, entries: result.targets.map((item) => item.entry), limited: result.limited, notice: result.notice };
  }

  /** Membership is catalog metadata; existing workspaces, runs and files remain intact. */
  async membership(entryId: string, included: boolean, authorize: ProjectAuthorization = () => undefined) {
    return workspaceOperations.use(async () => {
      authorize();
      const target = (await this.discover()).targets.find((item) => item.entry.id === entryId);
      if (!target) throw new Error(translate("ade: Project folder has been changed. Update overview."));
      authorize({ repositoryId: target.entry.repositoryId });
      let repositoryId = target.entry.repositoryId;
      if (!repositoryId) {
        if (!included) throw new Error(translate("ade: Project is not yet covered in ADE."));
        repositoryId = (await this.registerTarget(target, authorize)).repositoryId;
      }
      authorize({ repositoryId });
      const current = this.store.get();
      if (!current.repositories.some((item) => item.id === repositoryId)) throw new Error(translate("ade: The project has since been changed."));
      this.store.save({ repositories: current.repositories.map((item) => item.id === repositoryId ? { ...item, inMyProjects: included } : item) });
      this.changed();
      return { repositoryId, included, replayed: false };
    });
  }

  /** Read-only inspection of a main-discovered checkout; no registration or Git writes. */
  async inspectCheckout(path: string, repositoryId: string) {
    const repository = this.store.get().repositories.find((item) => item.id === repositoryId);
    if (!repository?.verified || repository.executionBackend !== 'native') throw new Error(translate("ade: Select a tested native project."));
    const directoryIdentity = projectRootIdentity(path);
    const identity = await this.gitIdentity(path);
    const workspace = { id: '', repositoryId, workspaceDir: identity.top, directoryIdentity,
      gitDirectory: identity.git, gitDirectoryIdentity: projectRootIdentity(identity.git),
      gitPointerIdentity: identity.pointer, commonGitIdentity: projectRootIdentity(identity.common),
      kind: sameHostPath(identity.git, identity.common) ? 'checkout' as const : 'worktree' as const, createdAt: 0 };
    this.assertRecord(workspace, repository, identity);
    return { workspace, branch: identity.branch };
  }

  async open(entryId: string, assertAuthorized: ProjectAuthorization = () => undefined): Promise<ProjectWorkspaceView> {
    if (typeof entryId !== 'string' || !/^p[a-f0-9]{32}$/.test(entryId)) throw new Error(translate("ade: Project selection is invalid."));
    return workspaceOperations.use(async () => {
      assertAuthorized();
      const target = (await this.discover()).targets.find((item) => item.entry.id === entryId);
      if (!target) throw new Error(translate("ade: Project folder has been changed. Update overview."));
      return this.registerTarget(target, assertAuthorized);
    });
  }

  async inspectDirectory(entryId: string, authorize: ProjectAuthorization = () => undefined) {
    const target = (await this.discover()).targets.find((item) => item.entry.id === entryId);
    if (!target || target.entry.backend !== 'native' || target.entry.kind !== 'repository') throw new Error(translate("ade: Select reachable native Git project folders."));
    authorize({ repositoryId: target.entry.repositoryId });
    this.assertTarget(target); const identity = await this.gitIdentity(target.path); this.assertTarget(target);
    const repository = this.store.get().repositories.find((item) => item.executionBackend === 'native' && sameHostPath(item.commonGitDir, identity.common));
    if (repository && (!repository.verified || !sameHostPath(repository.rootPath, identity.main))) throw new Error(translate("ade: Check project assignment on the PC."));
    authorize({ repositoryId: repository?.id });
    return { target, identity, repositoryId: repository?.id, directoryIdentity: projectRootIdentity(target.path),
      gitIdentity: projectRootIdentity(identity.git), commonIdentity: projectRootIdentity(identity.common) };
  }

  /** Main-only confirmation; caller holds the exclusive workspace gate. */
  async registerDirectory(entryId: string, authorize: ProjectAuthorization) {
    const inspected = await this.inspectDirectory(entryId); authorize({ repositoryId: inspected.repositoryId });
    return this.registerTarget(inspected.target, authorize);
  }

  /** Main-only adoption after a branch service resolved or created a worktree.
   * Caller holds the workspace operation gate; no wire payload supplies this path.
   */
  async registerCheckout(path: string, repositoryId: string, assertAuthorized: ProjectAuthorization): Promise<ProjectWorkspaceView> {
    assertAuthorized({ repositoryId });
    const repository = this.store.get().repositories.find((item) => item.id === repositoryId);
    if (!repository?.verified || repository.executionBackend !== 'native') throw new Error(translate("ade: Project is not available."));
    const identity = projectRootIdentity(path);
    return this.registerTarget({ path, identity, entry: { id: '', name: repository.name, repositoryId, kind: 'repository', backend: 'native', source: 'catalog', notice: null } }, assertAuthorized, repositoryId);
  }

  private async registerTarget(target: DirectoryTarget, assertAuthorized: ProjectAuthorization, expectedRepositoryId?: string): Promise<ProjectWorkspaceView> {
      if (target.entry.backend !== 'native') throw new Error(translate("ade: Open WSL projects in the existing agent workspace."));
      if (target.entry.kind !== 'repository') throw new Error(translate("ade: This folder is not yet an accessible Git repository."));
      this.assertTarget(target);
      const identity = await this.gitIdentity(target.path);
      this.assertTarget(target);
      const gitIdentity = projectRootIdentity(identity.git);
      const commonIdentity = projectRootIdentity(identity.common);
      const current = this.store.get();
      let repository = current.repositories.find((item) => item.executionBackend === 'native' && sameHostPath(item.commonGitDir, identity.common));
      if (repository && (!repository.verified || projectRootIdentity(repository.commonGitDir) !== commonIdentity || !sameHostPath(repository.rootPath, identity.main))) {
        throw new Error(translate("ade: Re-check the repository on the PC first."));
      }
      if (!repository) repository = { id: randomUUID(), inMyProjects: false, name: basename(identity.main), rootPath: identity.main, commonGitDir: identity.common,
        executionBackend: 'native', verified: true, createdAt: Date.now() };
      if (expectedRepositoryId && repository.id !== expectedRepositoryId) throw new Error(translate("ade: Working copy does not belong to the selected project."));
      assertAuthorized({ repositoryId: repository.id });
      const existing = current.projectWorkspaces.find((item) => sameHostPath(item.workspaceDir, target.path));
      if (existing) {
        this.assertRecord(existing, repository, identity);
        assertAuthorized();
        return this.view(existing, repository, identity.branch);
      }
      if (current.projectWorkspaces.length >= MAX_ENTRIES) throw new Error(translate("ade: Maximum of 500 project workspaces."));
      const workspace: ProjectWorkspace = { id: randomUUID(), repositoryId: repository.id, workspaceDir: identity.top,
        directoryIdentity: target.identity, gitDirectory: identity.git, gitDirectoryIdentity: gitIdentity,
        gitPointerIdentity: identity.pointer, commonGitIdentity: commonIdentity,
        kind: sameHostPath(identity.git, identity.common) ? 'checkout' : 'worktree', createdAt: Date.now() };
      // No await between final identity check and the one atomic config save.
      this.assertTarget(target);
      this.assertRecord(workspace, repository, identity);
      assertAuthorized();
      this.store.save({ repositories: current.repositories.some((item) => item.id === repository!.id) ? current.repositories : [...current.repositories, repository],
        projectWorkspaces: [...current.projectWorkspaces, workspace] });
      this.changed();
      return this.view(workspace, repository, identity.branch);
  }

  async resolve(workspaceId: string): Promise<{ workspace: ProjectWorkspace; repository: Repository; branch: string }> {
    const workspace = this.store.get().projectWorkspaces.find((item) => item.id === workspaceId);
    const repository = workspace && this.store.get().repositories.find((item) => item.id === workspace.repositoryId);
    if (!workspace || !repository?.verified || repository.executionBackend !== 'native') throw new Error(translate("ade: Project workspace is not available."));
    this.assertRecordPaths(workspace, repository);
    const identity = await this.gitIdentity(workspace.workspaceDir);
    const currentRepository = this.store.get().repositories.find((item) => item.id === repository.id);
    // Voice and overview membership are presentation preferences, not workspace
    // identity. They may change while the read-only Git identity probe runs.
    const identityConfig = ({ speechVoiceId: _voice, inMyProjects: _membership, ...record }: Repository) => JSON.stringify(record);
    if (this.store.get().projectWorkspaces.find((item) => item.id === workspaceId) !== workspace
      || !currentRepository || identityConfig(currentRepository) !== identityConfig(repository)) throw new Error(translate("ade: The project has since been changed."));
    this.assertRecord(workspace, currentRepository, identity);
    return { workspace: { ...workspace }, repository: { ...currentRepository }, branch: identity.branch };
  }

  async overview(workspaceId: string): Promise<ProjectWorkspaceView> {
    const state = await this.resolve(workspaceId);
    return this.view(state.workspace, state.repository, state.branch);
  }

  /** Existing terminal I/O uses sealed directory identity, without launching Git
   * on every key or frame. Never use this path for launch or filesystem actions. */
  async resolveTerminal(workspaceId: string): Promise<{ workspace: ProjectWorkspace; repository: Repository; branch: string }> {
    const workspace = this.store.get().projectWorkspaces.find(item => item.id === workspaceId);
    const repository = workspace && this.store.get().repositories.find(item => item.id === workspace.repositoryId);
    if (!workspace || !repository?.verified || repository.executionBackend !== 'native') throw new Error(translate("ade: Project workspace is not available."));
    this.assertRecordPaths(workspace, repository);
    const branch = terminalWorkspaceBranch(workspace, repository);
    this.assertRecordPaths(workspace, repository);
    if (branch === null) return this.resolve(workspaceId);
    return { workspace: { ...workspace }, repository: { ...repository }, branch };
  }

  private view(workspace: ProjectWorkspace, repository: Repository, branch: string): ProjectWorkspaceView {
    return { id: workspace.id, repositoryId: repository.id, name: redactForWire(repository.name, 200),
      branch: redactForWire(branch, 200), kind: workspace.kind, backend: 'native' };
  }

  private assertRecordPaths(workspace: ProjectWorkspace, repository: Repository): void {
    if (projectRootIdentity(workspace.workspaceDir) !== workspace.directoryIdentity
      || projectRootIdentity(workspace.gitDirectory) !== workspace.gitDirectoryIdentity
      || projectRootIdentity(repository.commonGitDir) !== workspace.commonGitIdentity
      || this.pointerIdentity(workspace.workspaceDir) !== workspace.gitPointerIdentity) {
      throw new Error(translate("ade: Project workspace was moved or replaced. Check again on the PC."));
    }
    assertNoLinks(join(workspace.workspaceDir, '.git'));
  }

  private assertRecord(workspace: ProjectWorkspace, repository: Repository, identity: GitIdentity): void {
    this.assertRecordPaths(workspace, repository);
    if (workspace.repositoryId !== repository.id || !sameHostPath(workspace.workspaceDir, identity.top)
      || !sameHostPath(workspace.gitDirectory, identity.git) || !sameHostPath(repository.commonGitDir, identity.common)
      || !sameHostPath(repository.rootPath, identity.main)) {
      throw new Error(translate("ade: Git assignment of the project workspace has been changed."));
    }
  }

  private assertTarget(target: DirectoryTarget): void {
    if (projectRootIdentity(target.path) !== target.identity) throw new Error(translate("ade: Project folder has been replaced."));
    assertNoLinks(join(target.path, '.git'));
    if (target.rootIdentity) {
      const defaults = this.store.get().settings.projectDefaults;
      if (!defaults || defaults.rootIdentity !== target.rootIdentity || projectRootIdentity(defaults.rootPath) !== target.rootIdentity
        || !sameHostPath(join(defaults.rootPath, basename(target.path)), target.path)) throw new Error(translate("ade: Project root folder has been changed."));
    }
  }

  private async gitIdentity(path: string): Promise<GitIdentity> {
    const pointer = this.pointerIdentity(path);
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !GIT_LOCATION_ENV.has(key.toUpperCase())));
    const read = async (args: string[]): Promise<string> => (await execute('git', ['-C', path, '-c', 'core.fsmonitor=false', ...args],
      { windowsHide: true, timeout: 10_000, maxBuffer: 64 * 1024, encoding: 'utf8', env: { ...env, GIT_OPTIONAL_LOCKS: '0' } })).stdout.trim();
    // Independent read-only probes share one process-start round trip. Never
    // cache authority: pointer/record identities are still checked on every call.
    const results = await Promise.allSettled([
      read(['rev-parse', '--path-format=absolute', '--show-toplevel', '--absolute-git-dir', '--git-common-dir']),
      read(['worktree', 'list', '--porcelain', '-z']),
      read(['symbolic-ref', '--quiet', '--short', 'HEAD']).catch((error: unknown) => {
        if ((error as { code?: number }).code !== 1) throw error;
        return '(detached HEAD)';
      }),
    ]);
    const failed = results.find(result => result.status === 'rejected');
    if (failed?.status === 'rejected') throw failed.reason;
    const [raw, worktrees, branch] = results.map(result => (result as PromiseFulfilledResult<string>).value) as [string, string, string];
    const parts = raw.split(/\r?\n/);
    if (parts.length !== 3 || parts.some((part) => !part || /[\0-\x1f]/.test(part))) throw new Error(translate("ade: Git-Workspace could not be clearly determined."));
    const [top, git, common] = parts.map((part) => { projectRootIdentity(part); return realpathSync.native(part); }) as [string, string, string];
    if (!sameHostPath(top, path)) throw new Error(translate("ade: Open a repository root instead of a subfolder."));
    const mainPath = worktrees.split('\0').find((line) => line.startsWith('worktree '))?.slice(9);
    if (!mainPath) throw new Error(translate("ade: Git main workspace is missing."));
    projectRootIdentity(mainPath);
    const main = realpathSync.native(mainPath);
    if (this.pointerIdentity(path) !== pointer) throw new Error(translate("ade: Git assignment was changed during reading."));
    return { top, main, git, common, pointer, branch };
  }

  private pointerIdentity(path: string): string {
    const file = join(path, '.git'); assertNoLinks(file); const stat = lstatSync(file);
    if (stat.isDirectory()) return projectRootIdentity(file);
    if (!stat.isFile() || stat.size > 4096) throw new Error(translate("ade: Git link file is invalid."));
    return `${stat.dev}:${stat.ino}:${stat.birthtimeMs}:${stat.size}:${stat.mtimeMs}`;
  }

  private async discover(): Promise<{ configured: boolean; targets: DirectoryTarget[]; limited: boolean; notice: string | null }> {
    const config = this.store.get(); const defaults = config.settings.projectDefaults;
    const targets: DirectoryTarget[] = []; const paths = new Set<string>(); let limited = false; let notice: string | null = null;
    const add = (path: string, repository?: Repository, rootIdentity?: string): void => {
      const key = hostPathKey(path); if (paths.has(key)) return;
      if (targets.length >= MAX_ENTRIES) { limited = true; return; }
      const backend = repository?.executionBackend ?? 'native';
      let identity = ''; let kind: ProjectDirectoryEntry['kind'] = 'unavailable'; let entryNotice: string | null = null;
      if (backend !== 'native') entryNotice = translate("Open in the existing WSL agent workspace.");
      else try {
        identity = projectRootIdentity(path); assertNoLinks(join(path, '.git'));
        try { const git = lstatSync(join(path, '.git')); kind = git.isDirectory() || git.isFile() ? 'repository' : 'unavailable'; }
        catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') kind = 'folder'; else throw error; }
      } catch { entryNotice = translate("Folder not available or linked. Check on PC."); }
      const id = 'p' + createHash('sha256').update(`${backend}\0${key}\0${identity}\0${rootIdentity ?? ''}`).digest('hex').slice(0, 32);
      paths.add(key);
      targets.push({ path, identity, rootIdentity, entry: { id, name: redactForWire(repository?.name ?? basename(path), 200),
        repositoryId: repository?.id, inMyProjects: !!repository && repository.inMyProjects !== false, kind, backend, source: rootIdentity ? 'root' : 'catalog', notice: entryNotice } });
    };
    if (defaults) {
      try {
        if (projectRootIdentity(defaults.rootPath) !== defaults.rootIdentity) throw new Error('changed');
        const directory = await opendir(defaults.rootPath); let scanned = 0;
        for await (const entry of directory) {
          if (++scanned > MAX_SCANNED) { limited = true; break; }
          if ((!entry.isDirectory() && !entry.isSymbolicLink()) || OMIT.has(entry.name)) continue;
          const path = resolve(defaults.rootPath, entry.name);
          const repository = config.repositories.find((item) => item.executionBackend === 'native' && sameHostPath(item.rootPath, path));
          add(path, repository, defaults.rootIdentity);
          if (targets.length >= MAX_ENTRIES) { limited = true; break; }
        }
        if (projectRootIdentity(defaults.rootPath) !== defaults.rootIdentity || this.store.get().settings.projectDefaults !== defaults) throw new Error('changed');
      } catch {
        targets.length = 0; paths.clear(); notice = translate("Project root folder unavailable or modified. Check again on PC under Settings.");
      }
    } else notice = translate("Save project root folders on the PC under Settings to see more folders.");
    for (const repository of config.repositories) add(repository.rootPath, repository);
    targets.sort((left, right) => left.entry.name.localeCompare(right.entry.name));
    return { configured: !!defaults, targets, limited, notice };
  }
}
