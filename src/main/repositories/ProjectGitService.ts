import { t as translate } from "../../shared/i18n";
import { createHash, randomUUID } from 'node:crypto';
import { closeSync, constants, existsSync, fstatSync, lstatSync, openSync, readFileSync, type Stats } from 'node:fs';
import { join } from 'node:path';
import type { AdeConfig, SessionMeta } from '../../shared/types';
import type { ProjectGitCommit } from '../../shared/remote';
import type { ProjectGitAction, ProjectGitDiff, ProjectGitFile, ProjectGitOverview, ProjectGitPreview } from '../../shared/projectGit';
import { validProjectGitAction, validProjectRemote } from '../../shared/projectGit';
import { validProjectBranchRef } from '../../shared/projectBranches';
import { ProjectWorkspaceService, type ProjectAuthorization } from './ProjectWorkspaceService';
import { projectGit } from './ProjectGitBoundary';
import { workspaceOperations } from './WorkspaceOperationGate';
import { assertNoLinks } from './pathDiscipline';
import { sameHostPath } from '../platform';
import { redactForWire } from '../errors';
import { workbenchPath } from '../application/RemoteWorkbenchService';

const SHA = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const digest = (value: unknown) => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');
function fail(message: string): never { throw new Error(`ade: ${message}`); }
type Scope = Awaited<ReturnType<ProjectWorkspaceService['resolve']>>;
interface State { view: ProjectGitOverview; scope: Scope; status: string; mergeHead: string; remoteConfig: string }
interface Stored { view: ProjectGitPreview; revision: string; owner: string }

/** Native, explicit local Git operations. No arbitrary command/path dispatch. */
export class ProjectGitService {
  private readonly previews = new Map<string, Stored>();
  private readonly fetched = new Map<string, number>();
  constructor(private readonly store: { get(): AdeConfig }, private readonly projects: ProjectWorkspaceService,
    private readonly sessions: () => SessionMeta[], private readonly now = Date.now) {}

  async overview(id: string): Promise<ProjectGitOverview> { return workspaceOperations.use(async () => (await this.inspect(id)).view); }

  /** Main-only publication port. Caller owns the shared read/mutation gate. */
  async publicationState(id: string) {
    const state = await this.inspect(id); this.assertAvailable(state.scope);
    if (state.view.blockedReason) fail(state.view.blockedReason);
    if (state.view.merge || state.view.files.length || !state.view.head) fail(translate("Make a clean branch with commit before release."));
    return { scope: state.scope, view: state.view };
  }

  async diff(id: string, path: string): Promise<ProjectGitDiff> {
    return workspaceOperations.use(async () => {
    workbenchPath(path); const before = await this.inspect(id); const file = before.view.files.find((item) => item.path === path);
    if (!file?.selectable) fail(translate("This file cannot be safely displayed here."));
    const cwd = before.scope.workspace.workspaceDir; let text: string;
    if (file.index === '?') { const body = this.readFile(join(cwd, path), 2 * 1024 * 1024); text = body.includes(0) ? translate("Binary · no text preview.") : body.toString('utf8'); }
    else text = await projectGit(cwd, ['--literal-pathspecs', 'diff', '--no-ext-diff', '--no-textconv', '--no-color', ...(before.view.head ? ['HEAD'] : ['--cached']), '--', path]);
    const after = await this.inspect(id);
    if (before.view.revision !== after.view.revision) fail(translate("Files were changed during reading. Update."));
    return { path, text: redactForWire(text, 64 * 1024), limited: text.length > 64 * 1024 };
    });
  }

  async preview(id: string, action: ProjectGitAction, owner: string): Promise<ProjectGitPreview> {
    return workspaceOperations.use(async () => {
    if (!validProjectGitAction(action) || redactForWire(JSON.stringify(action), 256 * 1024) !== JSON.stringify(action)) fail(translate("Invalid git action."));
    const state = await this.inspect(id); const target = await this.validate(state, action);
    const affected = target && state.view.head ? (await projectGit(state.scope.workspace.workspaceDir, ['diff', '--name-only', '-z', state.view.head, target])).split('\0').filter(Boolean)
      : 'paths' in action ? [...action.paths] : state.view.files.map((file) => file.path);
    if (affected.length > 500) fail(translate("Maximum 500 files in a git preview."));
    const view: ProjectGitPreview = { id: randomUUID(), workspaceId: id, projectName: state.view.workspace.name, branch: state.view.workspace.branch,
      head: state.view.head, action: structuredClone(action), targetHead: target, affected: affected.map((path) => redactForWire(path, 400)), expiresAt: this.now() + 300_000 };
    for (const [key, item] of this.previews) if (item.view.expiresAt < this.now()) this.previews.delete(key);
    if (this.previews.size >= 50) fail(translate("Too many open git previews. Check again later."));
    this.previews.set(view.id, { view, revision: state.view.revision, owner }); return structuredClone(view);
    });
  }

  async apply(id: string, owner: string, authorize: ProjectAuthorization = () => undefined): Promise<ProjectGitOverview> {
    return workspaceOperations.mutate(async () => {
      authorize(); const saved = this.previews.get(id);
      if (!saved || saved.owner !== owner || saved.view.expiresAt < this.now()) fail(translate("Git preview expired or not for this session. Check again."));
      authorize({ workspaceId: saved.view.workspaceId });
      this.previews.delete(id);
      const state = await this.inspect(saved.view.workspaceId); const action = saved.view.action;
      if (state.view.revision !== saved.revision) fail(translate("HEAD, index, files or Git settings changed. Check again."));
      const target = await this.validate(state, action);
      if (target !== saved.view.targetHead) fail(translate("Branch base has been changed."));
      await this.projects.resolve(state.scope.workspace.id); this.assertAvailable(state.scope); authorize();
      const cwd = state.scope.workspace.workspaceDir;
      const run = async (args: string[]) => { this.assertMetadata(state.scope); this.assertAvailable(state.scope); authorize(); return projectGit(cwd, args, 60_000); };
      switch (action.kind) {
        case 'commit':
          await run(['--literal-pathspecs', 'add', '--', ...action.paths]);
          await run(['--literal-pathspecs', '-c', 'commit.gpgSign=false', 'commit', '--only', '-m', action.message, '--', ...action.paths]);
          break;
        case 'resolve': await run(['--literal-pathspecs', 'add', '--', ...action.paths]); break;
        case 'fetch':
          await run(['fetch', '--no-tags', '--no-prune', '--no-recurse-submodules', '--refmap=', '--', action.remote, `+refs/heads/*:refs/remotes/${action.remote}/*`]);
          this.fetched.set(state.scope.repository.id, this.now()); break;
        case 'pull': await run(['merge', '--ff-only', '--no-overwrite-ignore', '--', target!]); break;
        case 'merge':
          try { await run(['merge', '--no-ff', '--no-commit', '--no-overwrite-ignore', '--', target!]); }
          catch (error) {
            const current = await this.inspect(state.scope.workspace.id);
            if (!current.view.merge || !current.view.files.some((file) => file.conflict)) throw error;
          }
          break;
        case 'continue': await run(['-c', 'commit.gpgSign=false', 'commit', '--no-edit']); break;
        case 'abort': await run(['merge', '--abort']); break;
      }
      authorize(); const after = await this.inspect(state.scope.workspace.id); authorize();
      if (after.view.workspace.branch !== state.view.workspace.branch) fail(translate("Branch was changed during the action. Check condition."));
      return after.view;
    });
  }

  private async validate(state: State, action: ProjectGitAction): Promise<string | null> {
    this.assertAvailable(state.scope);
    if (state.view.blockedReason) fail(state.view.blockedReason);
    const conflicts = state.view.files.filter((file) => file.conflict);
    if (['continue', 'abort', 'resolve'].includes(action.kind)) { if (!state.view.merge) fail(translate("There is no merge to continue or cancel.")); }
    else if (state.view.merge) fail(translate("Dissolve, close or cancel the current merge first."));
    if (action.kind === 'continue' && conflicts.length) fail(translate("First, edit all conflict files and mark them as resolved."));
    if (action.kind === 'continue' && state.view.files.some((file) => !file.selectable)) fail(translate("Not all merge files can be checked here. Complete in the local terminal."));
    if (action.kind === 'commit' || action.kind === 'resolve') {
      if (action.kind === 'commit' && conflicts.length) fail(translate("Resolve conflicts first."));
      for (const path of action.paths) {
        workbenchPath(path); const file = state.view.files.find((item) => item.path === path);
        if (!file?.selectable || action.kind === 'resolve' && !file.conflict) fail(translate("File selection is no longer valid or not safely accessible."));
        if (action.kind === 'resolve') {
          const body = this.optionalFile(join(state.scope.workspace.workspaceDir, path), 8 * 1024 * 1024).toString('utf8');
          if (/^(?:<<<<<<< |=======\r?$|>>>>>>> )/m.test(body)) fail(translate("Conflict markings still exist. Edit file first."));
        }
      }
    }
    if (action.kind === 'fetch' || action.kind === 'pull') {
      if (!state.view.remotes.includes(action.remote)) fail(translate("Remote no longer exists."));
      const url = (await projectGit(state.scope.workspace.workspaceDir, ['remote', 'get-url', '--all', action.remote])).trim().split(/\r?\n/);
      if (url.length !== 1 || !/^(?:https?:\/\/|ssh:\/\/|git:\/\/|file:\/\/|[\w.-]+@[\w.-]+:|[A-Za-z]:[\\/]|\/)/.test(url[0]!)) fail(translate("Remote address or transport is not supported here. Check on PC."));
    }
    if (action.kind === 'merge' || action.kind === 'pull') {
      if (state.status) fail(translate("Before merge/pull commit all changes; unsecured files remain."));
      const target = state.view.refs.find((ref) => ref.ref === action.ref)?.head;
      if (!target || !state.view.head) fail(translate("Selected branch or first commit is missing."));
      if (action.kind === 'pull') {
        const base = (await projectGit(state.scope.workspace.workspaceDir, ['merge-base', state.view.head, target])).trim();
        if (base !== state.view.head) fail(translate("No fast-forward possible. Bringing branches together consciously."));
      }
      return target;
    }
    return null;
  }

  private assertAvailable(scope: Scope): void {
    const config = this.store.get(); const path = scope.workspace.workspaceDir;
    if (config.runWorkspaceLeases.some((lease) => lease.status === 'active' && sameHostPath(lease.commonGitDir, scope.repository.commonGitDir))) fail(translate("Repository is occupied by a managed job."));
    if (config.workspaceBindings.some((binding) => sameHostPath(binding.workspaceDir, path))) fail(translate("Agent working copy: Choose an independent working copy for Git actions."));
    if (this.sessions().some((session) => session.status === 'running' && (session.executionBackend ?? 'native') === 'native'
      && !!session.workspaceDir && sameHostPath(session.workspaceDir, path))) fail(translate("A terminal session uses this workspace. End it before the Git action."));
  }

  private assertMetadata(scope: Scope): void {
    for (const root of new Set([scope.workspace.gitDirectory, scope.repository.commonGitDir])) {
      for (const name of ['config', 'config.worktree', 'index', 'HEAD', 'MERGE_HEAD', 'MERGE_MSG', 'ORIG_HEAD', 'refs', 'objects']) {
        const path = join(root, name); assertNoLinks(path);
        if (existsSync(path) && lstatSync(path).isFile() && lstatSync(path).nlink > 1) fail(translate("Linked git metadata is not changed."));
      }
    }
    if (scope.branch !== '(detached HEAD)') assertNoLinks(join(scope.repository.commonGitDir, 'refs', 'heads', scope.branch));
  }

  private readFile(path: string, limit: number): Buffer {
    assertNoLinks(path); const stat = lstatSync(path);
    if (!stat.isFile() || stat.nlink > 1 || stat.size > limit) fail(translate("File is linked, too large or no regular text/file entry."));
    const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const same = (other: Stats) => stat.ino === other.ino && stat.dev === other.dev && stat.size === other.size && stat.mtimeMs === other.mtimeMs && other.nlink === 1;
    try {
      if (!same(fstatSync(fd))) fail(translate("The file was replaced before reading."));
      const body = readFileSync(fd); assertNoLinks(path);
      if (body.length > limit || !same(fstatSync(fd)) || !same(lstatSync(path))) fail(translate("The file was changed during the reading."));
      return body;
    } finally { closeSync(fd); }
  }
  private optionalFile(path: string, limit: number): Buffer { assertNoLinks(path); return existsSync(path) ? this.readFile(path, limit) : Buffer.alloc(0); }

  private async inspect(id: string): Promise<State> {
    const scope = await this.projects.resolve(id); const path = scope.workspace.workspaceDir; this.assertMetadata(scope);
    const [status, refsRaw, remoteConfig] = await Promise.all([
      projectGit(path, ['status', '--porcelain=v1', '-z', '--no-renames', '--untracked-files=all', '--ignore-submodules=none']),
      projectGit(path, ['for-each-ref', '--count=201', '--format=%(refname)%00%(objectname)%00%(symref)', 'refs/heads', 'refs/remotes']),
      projectGit(path, ['config', '--local', '--list', '-z']),
    ]);
    const refs = refsRaw.trimEnd().split(/\r?\n/).filter(Boolean).flatMap((line) => { const [ref, head, symbolic] = line.split('\0');
      if (symbolic) return []; if (!validProjectBranchRef(ref) || !SHA.test(head ?? '') || redactForWire(ref!, 4096) !== ref) fail(translate("Branch list not clearly legible.")); return [{ ref: ref!, head: head! }]; });
    if (refs.length > 200) fail(translate("Maximum of 200 branches in this view."));
    let head: string | null = null;
    try { head = (await projectGit(path, ['rev-parse', '--verify', 'HEAD'])).trim(); if (!SHA.test(head)) fail(translate("HEAD is invalid.")); }
    catch { if (refs.some((ref) => ref.ref === `refs/heads/${scope.branch}`)) fail(translate("HEAD could not be confirmed.")); }
    const recentCommits: ProjectGitCommit[] = [];
    if (head) {
      const history = await projectGit(path, ['log', '-5', '--no-show-signature', '--format=%H%x00%an%x00%aI%x00%s', '-z', head, '--']);
      const fields = history.split('\0');
      if (fields.pop() !== '' || fields.length % 4 || fields.length > 20) fail(translate("Commit history could not be clearly read."));
      for (let at = 0; at < fields.length; at += 4) {
        const [sha, author, authoredAt, subject] = fields.slice(at, at + 4);
        if (!SHA.test(sha!) || !Number.isFinite(Date.parse(authoredAt!))) fail(translate("Commit metadata could not be read."));
        recentCommits.push({ sha: sha!, subject: redactForWire(subject!, 500), author: redactForWire(author!, 200), authoredAt: new Date(authoredAt!).toISOString() });
      }
      if (recentCommits[0]?.sha !== head) fail(translate("Commit history does not fit the read HEAD."));
    }
    const entries = status.split('\0').filter(Boolean); if (entries.length > 500) fail(translate("Maximum 500 changed files in this view."));
    let total = 0; const identities: unknown[] = [];
    const files: ProjectGitFile[] = entries.map((entry) => {
      if (entry.length < 4 || entry[2] !== ' ') fail(translate("Git status could not be clearly read."));
      const filePath = entry.slice(3); let notice: string | null = null;
      try {
        if (total >= 64 * 1024 * 1024) fail(translate("Read limit reached."));
        workbenchPath(filePath); const body = this.optionalFile(join(path, filePath), 8 * 1024 * 1024); total += body.length;
        if (total > 64 * 1024 * 1024) fail(translate("Modified files exceed the reading limit."));
        identities.push([filePath, digest(body)]);
      } catch { notice = translate("File too large, protected or linked. Check via the local CLI."); identities.push([filePath, 'unavailable']); }
      return { path: redactForWire(filePath, 400), index: entry[0]!, working: entry[1]!, conflict: /^(DD|AU|UD|UA|DU|AA|UU)$/.test(entry.slice(0, 2)), selectable: !notice, notice };
    });
    const mergeHead = this.optionalFile(join(scope.workspace.gitDirectory, 'MERGE_HEAD'), 512).toString('utf8');
    const mergeMessage = this.optionalFile(join(scope.workspace.gitDirectory, 'MERGE_MSG'), 64 * 1024);
    const operation = ['CHERRY_PICK_HEAD', 'REVERT_HEAD', 'rebase-merge', 'rebase-apply', 'sequencer', 'index.lock'].some((name) => { assertNoLinks(join(scope.workspace.gitDirectory, name)); return existsSync(join(scope.workspace.gitDirectory, name)); });
    let blockedReason: string | null = operation ? translate("Another git operation is underway. Complete in the terminal.") : scope.branch === '(detached HEAD)' ? translate("First, choose a local branch.") : null;
    if (!blockedReason) try { this.assertAvailable(scope); } catch (error) { blockedReason = redactForWire((error as Error).message.replace(/^ade: /, ''), 350); }
    const remotes = (await projectGit(path, ['remote'])).trim().split(/\r?\n/).filter(validProjectRemote);
    const index = this.optionalFile(join(scope.workspace.gitDirectory, 'index'), 16 * 1024 * 1024);
    const after = await this.projects.resolve(id); if (after.branch !== scope.branch) fail(translate("Branch has been changed. Update."));
    const view: ProjectGitOverview = { workspace: await this.projects.overview(id), head, recentCommits, files, refs, remotes, merge: !!mergeHead, blockedReason,
      revision: digest([scope.workspace, scope.branch, head, status, refsRaw, remoteConfig, mergeHead, digest(mergeMessage), digest(index), identities, operation]), checkedAt: this.now(), fetchedAt: this.fetched.get(scope.repository.id) ?? null };
    return { view, scope, status, mergeHead, remoteConfig };
  }
}
