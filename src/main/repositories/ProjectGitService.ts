import { createHash, randomUUID } from 'node:crypto';
import { closeSync, constants, existsSync, fstatSync, lstatSync, openSync, readFileSync, type Stats } from 'node:fs';
import { join } from 'node:path';
import type { AdeConfig, SessionMeta } from '../../shared/types';
import type { ProjectGitAction, ProjectGitDiff, ProjectGitFile, ProjectGitOverview, ProjectGitPreview } from '../../shared/projectGit';
import { validProjectGitAction, validProjectRemote } from '../../shared/projectGit';
import { validProjectBranchRef } from '../../shared/projectBranches';
import { ProjectWorkspaceService } from './ProjectWorkspaceService';
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
    if (state.view.merge || state.view.files.length || !state.view.head) fail('Vor Veröffentlichung einen sauberen Branch mit Commit herstellen.');
    return { scope: state.scope, view: state.view };
  }

  async diff(id: string, path: string): Promise<ProjectGitDiff> {
    return workspaceOperations.use(async () => {
    workbenchPath(path); const before = await this.inspect(id); const file = before.view.files.find((item) => item.path === path);
    if (!file?.selectable) fail('Diese Datei kann hier nicht sicher angezeigt werden.');
    const cwd = before.scope.workspace.workspaceDir; let text: string;
    if (file.index === '?') { const body = this.readFile(join(cwd, path), 2 * 1024 * 1024); text = body.includes(0) ? 'Binärdatei · keine Textvorschau.' : body.toString('utf8'); }
    else text = await projectGit(cwd, ['--literal-pathspecs', 'diff', '--no-ext-diff', '--no-textconv', '--no-color', ...(before.view.head ? ['HEAD'] : ['--cached']), '--', path]);
    const after = await this.inspect(id);
    if (before.view.revision !== after.view.revision) fail('Dateien wurden während des Lesens geändert. Aktualisieren.');
    return { path, text: redactForWire(text, 64 * 1024), limited: text.length > 64 * 1024 };
    });
  }

  async preview(id: string, action: ProjectGitAction, owner: string): Promise<ProjectGitPreview> {
    return workspaceOperations.use(async () => {
    if (!validProjectGitAction(action) || redactForWire(JSON.stringify(action), 256 * 1024) !== JSON.stringify(action)) fail('Ungültige Git-Aktion.');
    const state = await this.inspect(id); const target = await this.validate(state, action);
    const affected = target && state.view.head ? (await projectGit(state.scope.workspace.workspaceDir, ['diff', '--name-only', '-z', state.view.head, target])).split('\0').filter(Boolean)
      : 'paths' in action ? [...action.paths] : state.view.files.map((file) => file.path);
    if (affected.length > 500) fail('Maximal 500 Dateien in einer Git-Vorschau.');
    const view: ProjectGitPreview = { id: randomUUID(), workspaceId: id, projectName: state.view.workspace.name, branch: state.view.workspace.branch,
      head: state.view.head, action: structuredClone(action), targetHead: target, affected: affected.map((path) => redactForWire(path, 400)), expiresAt: this.now() + 300_000 };
    for (const [key, item] of this.previews) if (item.view.expiresAt < this.now()) this.previews.delete(key);
    if (this.previews.size >= 50) fail('Zu viele offene Git-Vorschauen. Später erneut prüfen.');
    this.previews.set(view.id, { view, revision: state.view.revision, owner }); return structuredClone(view);
    });
  }

  async apply(id: string, owner: string, authorize: () => void = () => undefined): Promise<ProjectGitOverview> {
    return workspaceOperations.mutate(async () => {
      authorize(); const saved = this.previews.get(id);
      if (!saved || saved.owner !== owner || saved.view.expiresAt < this.now()) fail('Git-Vorschau abgelaufen oder nicht für diese Sitzung. Erneut prüfen.');
      this.previews.delete(id);
      const state = await this.inspect(saved.view.workspaceId); const action = saved.view.action;
      if (state.view.revision !== saved.revision) fail('HEAD, Index, Dateien oder Git-Einstellungen wurden geändert. Erneut prüfen.');
      const target = await this.validate(state, action);
      if (target !== saved.view.targetHead) fail('Branch-Basis wurde geändert.');
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
      if (after.view.workspace.branch !== state.view.workspace.branch) fail('Branch wurde während der Aktion geändert. Zustand prüfen.');
      return after.view;
    });
  }

  private async validate(state: State, action: ProjectGitAction): Promise<string | null> {
    this.assertAvailable(state.scope);
    if (state.view.blockedReason) fail(state.view.blockedReason);
    const conflicts = state.view.files.filter((file) => file.conflict);
    if (['continue', 'abort', 'resolve'].includes(action.kind)) { if (!state.view.merge) fail('Kein Merge zum Fortsetzen oder Abbrechen vorhanden.'); }
    else if (state.view.merge) fail('Laufenden Merge zuerst auflösen, abschliessen oder abbrechen.');
    if (action.kind === 'continue' && conflicts.length) fail('Zuerst alle Konfliktdateien bearbeiten und als aufgelöst markieren.');
    if (action.kind === 'continue' && state.view.files.some((file) => !file.selectable)) fail('Nicht alle Merge-Dateien sind hier prüfbar. Im lokalen Terminal abschliessen.');
    if (action.kind === 'commit' || action.kind === 'resolve') {
      if (action.kind === 'commit' && conflicts.length) fail('Konflikte zuerst auflösen.');
      for (const path of action.paths) {
        workbenchPath(path); const file = state.view.files.find((item) => item.path === path);
        if (!file?.selectable || action.kind === 'resolve' && !file.conflict) fail('Dateiauswahl ist nicht mehr gültig oder nicht sicher zugänglich.');
        if (action.kind === 'resolve') {
          const body = this.optionalFile(join(state.scope.workspace.workspaceDir, path), 8 * 1024 * 1024).toString('utf8');
          if (/^(?:<<<<<<< |=======\r?$|>>>>>>> )/m.test(body)) fail('Konfliktmarkierungen sind noch vorhanden. Datei zuerst bearbeiten.');
        }
      }
    }
    if (action.kind === 'fetch' || action.kind === 'pull') {
      if (!state.view.remotes.includes(action.remote)) fail('Remote ist nicht mehr vorhanden.');
      const url = (await projectGit(state.scope.workspace.workspaceDir, ['remote', 'get-url', '--all', action.remote])).trim().split(/\r?\n/);
      if (url.length !== 1 || !/^(?:https?:\/\/|ssh:\/\/|git:\/\/|file:\/\/|[\w.-]+@[\w.-]+:|[A-Za-z]:[\\/]|\/)/.test(url[0]!)) fail('Remote-Adresse oder Transport wird hier nicht unterstützt. Am PC prüfen.');
    }
    if (action.kind === 'merge' || action.kind === 'pull') {
      if (state.status) fail('Vor Merge/Pull alle Änderungen committen; ungesicherte Dateien bleiben erhalten.');
      const target = state.view.refs.find((ref) => ref.ref === action.ref)?.head;
      if (!target || !state.view.head) fail('Gewählter Branch oder erster Commit fehlt.');
      if (action.kind === 'pull') {
        const base = (await projectGit(state.scope.workspace.workspaceDir, ['merge-base', state.view.head, target])).trim();
        if (base !== state.view.head) fail('Kein Fast-forward möglich. Branches bewusst zusammenführen.');
      }
      return target;
    }
    return null;
  }

  private assertAvailable(scope: Scope): void {
    const config = this.store.get(); const path = scope.workspace.workspaceDir;
    if (config.runWorkspaceLeases.some((lease) => lease.status === 'active' && sameHostPath(lease.commonGitDir, scope.repository.commonGitDir))) fail('Repository ist durch einen verwalteten Auftrag belegt.');
    if (config.workspaceBindings.some((binding) => sameHostPath(binding.workspaceDir, path))) fail('Agent-Arbeitskopie: eine unabhängige Arbeitskopie für Git-Aktionen wählen.');
    if (this.sessions().some((session) => session.status === 'running' && (session.executionBackend ?? 'native') === 'native'
      && !!session.workspaceDir && sameHostPath(session.workspaceDir, path))) fail('Eine Terminalsitzung verwendet diesen Workspace. Vor der Git-Aktion beenden.');
  }

  private assertMetadata(scope: Scope): void {
    for (const root of new Set([scope.workspace.gitDirectory, scope.repository.commonGitDir])) {
      for (const name of ['config', 'config.worktree', 'index', 'HEAD', 'MERGE_HEAD', 'MERGE_MSG', 'ORIG_HEAD', 'refs', 'objects']) {
        const path = join(root, name); assertNoLinks(path);
        if (existsSync(path) && lstatSync(path).isFile() && lstatSync(path).nlink > 1) fail('Verknüpfte Git-Metadaten werden nicht verändert.');
      }
    }
    if (scope.branch !== '(detached HEAD)') assertNoLinks(join(scope.repository.commonGitDir, 'refs', 'heads', scope.branch));
  }

  private readFile(path: string, limit: number): Buffer {
    assertNoLinks(path); const stat = lstatSync(path);
    if (!stat.isFile() || stat.nlink > 1 || stat.size > limit) fail('Datei ist verknüpft, zu gross oder kein regulärer Text/Datei-Eintrag.');
    const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const same = (other: Stats) => stat.ino === other.ino && stat.dev === other.dev && stat.size === other.size && stat.mtimeMs === other.mtimeMs && other.nlink === 1;
    try {
      if (!same(fstatSync(fd))) fail('Datei wurde vor dem Lesen ersetzt.');
      const body = readFileSync(fd); assertNoLinks(path);
      if (body.length > limit || !same(fstatSync(fd)) || !same(lstatSync(path))) fail('Datei wurde während des Lesens geändert.');
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
      if (symbolic) return []; if (!validProjectBranchRef(ref) || !SHA.test(head ?? '') || redactForWire(ref!, 4096) !== ref) fail('Branch-Liste nicht eindeutig lesbar.'); return [{ ref: ref!, head: head! }]; });
    if (refs.length > 200) fail('Maximal 200 Branches in dieser Ansicht.');
    let head: string | null = null;
    try { head = (await projectGit(path, ['rev-parse', '--verify', 'HEAD'])).trim(); if (!SHA.test(head)) fail('HEAD ist ungültig.'); }
    catch { if (refs.some((ref) => ref.ref === `refs/heads/${scope.branch}`)) fail('HEAD konnte nicht bestätigt werden.'); }
    const entries = status.split('\0').filter(Boolean); if (entries.length > 500) fail('Maximal 500 geänderte Dateien in dieser Ansicht.');
    let total = 0; const identities: unknown[] = [];
    const files: ProjectGitFile[] = entries.map((entry) => {
      if (entry.length < 4 || entry[2] !== ' ') fail('Git-Status konnte nicht eindeutig gelesen werden.');
      const filePath = entry.slice(3); let notice: string | null = null;
      try {
        if (total >= 64 * 1024 * 1024) fail('Leselimit erreicht.');
        workbenchPath(filePath); const body = this.optionalFile(join(path, filePath), 8 * 1024 * 1024); total += body.length;
        if (total > 64 * 1024 * 1024) fail('Geänderte Dateien überschreiten das Leselimit.');
        identities.push([filePath, digest(body)]);
      } catch { notice = 'Datei zu gross, geschützt oder verknüpft. Über die lokale CLI prüfen.'; identities.push([filePath, 'unavailable']); }
      return { path: redactForWire(filePath, 400), index: entry[0]!, working: entry[1]!, conflict: /^(DD|AU|UD|UA|DU|AA|UU)$/.test(entry.slice(0, 2)), selectable: !notice, notice };
    });
    const mergeHead = this.optionalFile(join(scope.workspace.gitDirectory, 'MERGE_HEAD'), 512).toString('utf8');
    const mergeMessage = this.optionalFile(join(scope.workspace.gitDirectory, 'MERGE_MSG'), 64 * 1024);
    const operation = ['CHERRY_PICK_HEAD', 'REVERT_HEAD', 'rebase-merge', 'rebase-apply', 'sequencer', 'index.lock'].some((name) => { assertNoLinks(join(scope.workspace.gitDirectory, name)); return existsSync(join(scope.workspace.gitDirectory, name)); });
    let blockedReason: string | null = operation ? 'Eine andere Git-Operation läuft. Im Terminal abschliessen.' : scope.branch === '(detached HEAD)' ? 'Zuerst einen lokalen Branch wählen.' : null;
    if (!blockedReason) try { this.assertAvailable(scope); } catch (error) { blockedReason = redactForWire((error as Error).message.replace(/^ade: /, ''), 350); }
    const remotes = (await projectGit(path, ['remote'])).trim().split(/\r?\n/).filter(validProjectRemote);
    const index = this.optionalFile(join(scope.workspace.gitDirectory, 'index'), 16 * 1024 * 1024);
    const after = await this.projects.resolve(id); if (after.branch !== scope.branch) fail('Branch wurde geändert. Aktualisieren.');
    const view: ProjectGitOverview = { workspace: await this.projects.overview(id), head, files, refs, remotes, merge: !!mergeHead, blockedReason,
      revision: digest([scope.workspace, scope.branch, head, status, refsRaw, remoteConfig, mergeHead, digest(mergeMessage), digest(index), identities, operation]), checkedAt: this.now(), fetchedAt: this.fetched.get(scope.repository.id) ?? null };
    return { view, scope, status, mergeHead, remoteConfig };
  }
}
