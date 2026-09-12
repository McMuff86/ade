import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import type { AdeConfig, SessionMeta } from '../../shared/types';
import type { ProjectBranch, ProjectBranchAction, ProjectBranchOverview, ProjectBranchPreview, ProjectWorktree } from '../../shared/projectBranches';
import { validProjectBranchAction, validProjectBranchRef } from '../../shared/projectBranches';
import type { ProjectWorkspaceView } from '../../shared/remote';
import { redactForWire } from '../errors';
import { sameHostPath } from '../platform';
import { projectRootIdentity } from '../settings/ProjectDefaultsService';
import { assertNoLinks } from './pathDiscipline';
import { ProjectWorkspaceService, type ProjectAuthorization } from './ProjectWorkspaceService';
import { workspaceOperations } from './WorkspaceOperationGate';
import { projectGit } from './ProjectGitBoundary';

const SHA = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const digest = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const TTL = 5 * 60_000;
interface WorktreeRecord { view: ProjectWorktree; path: string; identity: string; ref: string; head: string }
interface Inspected {
  value: ProjectBranchOverview;
  scope: Awaited<ReturnType<ProjectWorkspaceService['resolve']>>;
  worktrees: WorktreeRecord[];
  operationInProgress: boolean;
}
interface PreviewRecord { view: ProjectBranchPreview; owner: string; revision: string; targetHead: string | null; targetWorktree?: WorktreeRecord }

/** Branch operations never redirect an existing terminal. Local changes, sessions,
 * managed leases and agent-owned bindings block switching the current checkout.
 * Extra worktrees start from a selected committed ref and preserve the source.
 */
export class ProjectBranchService {
  private readonly previews = new Map<string, PreviewRecord>();
  constructor(private readonly store: { get(): AdeConfig }, private readonly projects: ProjectWorkspaceService,
    private readonly sessions: () => SessionMeta[], private readonly now: () => number = Date.now) {}

  async overview(workspaceId: string): Promise<ProjectBranchOverview> { return (await this.inspect(workspaceId)).value; }

  async preview(workspaceId: string, action: ProjectBranchAction, owner: string): Promise<ProjectBranchPreview> {
    if (!validProjectBranchAction(action) || redactForWire(JSON.stringify(action), 4096) !== JSON.stringify(action)) throw new Error('ade: Ungültige Branch-Aktion.');
    const state = await this.inspect(workspaceId); const target = this.validateAction(state, action);
    const view: ProjectBranchPreview = { id: randomUUID(), expiresAt: this.now() + TTL, workspaceId, projectName: state.value.workspace.name,
      fromBranch: state.value.workspace.branch, toBranch: target.branch, separate: action.kind === 'open-worktree' || action.kind === 'create' && action.separate, action: structuredClone(action) };
    for (const [id, item] of this.previews) if (item.view.expiresAt < this.now()) this.previews.delete(id);
    if (this.previews.size >= 50) throw new Error('ade: Zu viele offene Git-Vorschauen. Später erneut prüfen.');
    this.previews.set(view.id, { view, owner, revision: state.value.revision, targetHead: target.head, targetWorktree: target.worktree });
    return structuredClone(view);
  }

  async apply(previewId: string, owner: string, assertAuthorized: ProjectAuthorization = () => undefined): Promise<ProjectWorkspaceView> {
    return workspaceOperations.mutate(async () => {
      assertAuthorized();
      const stored = this.previews.get(previewId);
      if (!stored || stored.owner !== owner || stored.view.expiresAt < this.now()) throw new Error('ade: Branch-Vorschau ist abgelaufen oder gehört zu einer anderen Sitzung. Erneut prüfen.');
      assertAuthorized({ workspaceId: stored.view.workspaceId });
      this.previews.delete(previewId);
      const state = await this.inspect(stored.view.workspaceId); const action = stored.view.action;
      if (state.value.revision !== stored.revision) throw new Error('ade: Branches oder Workspace wurden seit der Vorschau geändert. Erneut prüfen.');
      const target = this.validateAction(state, action);
      if (target.head !== stored.targetHead) throw new Error('ade: Branch-Basis wurde geändert. Erneut prüfen.');
      if (action.kind === 'open-worktree') {
        const worktree = target.worktree!;
        if (!stored.targetWorktree || worktree.identity !== stored.targetWorktree.identity || !sameHostPath(worktree.path, stored.targetWorktree.path)) throw new Error('ade: Arbeitskopie wurde geändert.');
        assertAuthorized();
        return this.projects.registerCheckout(worktree.path, state.scope.repository.id, assertAuthorized);
      }
      await this.projects.resolve(state.scope.workspace.id);
      this.assertBusy(state, action.kind === 'create' && action.separate);
      assertAuthorized();
      if (action.kind === 'create' && action.separate) {
        const parent = join(dirname(state.scope.repository.rootPath), '.ade-worktrees', 'projects');
        assertNoLinks(parent); mkdirSync(parent, { recursive: true }); const parentIdentity = projectRootIdentity(parent);
        const path = join(parent, randomUUID()); assertNoLinks(path);
        if (existsSync(path)) throw new Error('ade: Neue Arbeitskopie ist bereits vorhanden. Erneut prüfen.');
        assertAuthorized();
        if (projectRootIdentity(parent) !== parentIdentity) throw new Error('ade: Arbeitskopie-Stamm wurde geändert.');
        await projectGit(state.scope.workspace.workspaceDir, ['worktree', 'add', '--no-guess-remote', '--no-track', '-b', action.name, '--', path, target.head!], 60_000);
        assertAuthorized();
        const opened = await this.projects.registerCheckout(path, state.scope.repository.id, assertAuthorized);
        if (opened.branch !== action.name) throw new Error('ade: Neue Arbeitskopie konnte nicht bestätigt werden. Projektliste prüfen.');
        return opened;
      }
      const args = action.kind === 'create'
        ? ['switch', '--no-guess', '--no-overwrite-ignore', '--no-track', '-c', action.name, ...(target.head ? [target.head] : [])]
        : action.ref.startsWith('refs/heads/') ? ['switch', '--no-guess', '--no-overwrite-ignore', '--', action.ref.slice(11)]
          : ['switch', '--no-guess', '--no-overwrite-ignore', '--track=direct', '-c', target.branch, action.ref];
      await projectGit(state.scope.workspace.workspaceDir, args, 60_000);
      const after = await this.inspect(state.scope.workspace.id);
      if (after.value.workspace.branch !== target.branch || after.value.head !== target.head || after.value.dirty) throw new Error('ade: Branch-Wechsel konnte nicht sauber bestätigt werden. Aktuellen Stand prüfen.');
      assertAuthorized(); return after.value.workspace;
    });
  }

  private validateAction(state: Inspected, action: ProjectBranchAction): { branch: string; head: string | null; worktree?: WorktreeRecord } {
    if (action.kind === 'open-worktree') {
      const worktree = state.worktrees.find((item) => item.view.id === action.worktreeId);
      if (!worktree?.view.available) throw new Error('ade: Gewählte Arbeitskopie ist nicht verfügbar.');
      return { branch: worktree.view.branch, head: worktree.head || null, worktree };
    }
    this.assertBusy(state, action.kind === 'create' && action.separate);
    if (action.kind === 'create') {
      if (state.value.branches.some((branch) => branch.ref === `refs/heads/${action.name}`)) throw new Error('ade: Branch existiert bereits. Vorhandenen Branch auswählen.');
      const basis = action.baseRef ? state.value.branches.find((branch) => branch.ref === action.baseRef)?.head : state.value.head;
      if (action.baseRef && !basis) throw new Error('ade: Basis-Branch fehlt. Ansicht aktualisieren.');
      if (action.separate && !basis) throw new Error('ade: Für eine zusätzliche Arbeitskopie zuerst einen Commit erstellen.');
      return { branch: action.name, head: basis ?? null };
    }
    const branch = state.value.branches.find((item) => item.ref === action.ref);
    if (!branch) throw new Error('ade: Gewählter Branch fehlt. Ansicht aktualisieren.');
    if (branch.worktreeId && !branch.current) throw new Error('ade: Dieser Branch ist in einer anderen Arbeitskopie geöffnet. Diese Arbeitskopie auswählen.');
    if (branch.kind === 'local') return { branch: branch.name, head: branch.head };
    const name = branch.name.slice(branch.name.indexOf('/') + 1);
    if (!name || state.value.branches.some((item) => item.ref === `refs/heads/${name}`)) throw new Error('ade: Für diesen Remote-Branch existiert bereits ein lokaler Branch. Diesen auswählen oder einen neuen Branch anlegen.');
    return { branch: name, head: branch.head };
  }

  private assertBusy(state: Inspected, separate: boolean): void {
    const path = state.scope.workspace.workspaceDir; const config = this.store.get();
    const leased = config.runWorkspaceLeases.some((item) => item.status === 'active' && sameHostPath(item.commonGitDir, state.scope.repository.commonGitDir));
    if (leased) throw new Error('ade: Repository ist durch einen verwalteten Auftrag belegt.');
    if (state.operationInProgress) throw new Error('ade: Eine Git-Operation läuft oder muss abgeschlossen werden.');
    if (separate) return;
    if (config.workspaceBindings.some((item) => sameHostPath(item.workspaceDir, path))) throw new Error('ade: Diese Arbeitskopie gehört zu einem Agent-Profil. Eine unabhängige Arbeitskopie erstellen.');
    if (this.sessions().some((item) => item.status === 'running' && (item.executionBackend ?? 'native') === 'native' && item.workspaceDir && sameHostPath(item.workspaceDir, path))) throw new Error('ade: Eine Terminalsitzung verwendet diesen Workspace. Sitzung beenden oder zusätzliche Arbeitskopie wählen.');
    if (state.value.dirty) throw new Error('ade: Ungesicherte Änderungen. Zuerst committen oder eine zusätzliche Arbeitskopie wählen.');
    if (state.value.blockedReason) throw new Error(`ade: ${state.value.blockedReason}`);
  }

  private async inspect(workspaceId: string): Promise<Inspected> {
    const scope = await this.projects.resolve(workspaceId); const path = scope.workspace.workspaceDir;
    const [refsRaw, worktreesRaw, status] = await Promise.all([
      projectGit(path, ['for-each-ref', '--count=201', '--format=%(refname)%00%(objectname)%00%(symref)', 'refs/heads', 'refs/remotes']),
      projectGit(path, ['worktree', 'list', '--porcelain', '-z']),
      projectGit(path, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignore-submodules=none']),
    ]);
    const worktrees: WorktreeRecord[] = worktreesRaw.split('\0\0').filter(Boolean).map((record) => {
      const fields = record.split('\0'); const targetPath = fields.find((field) => field.startsWith('worktree '))?.slice(9) ?? '';
      const ref = fields.find((field) => field.startsWith('branch '))?.slice(7) ?? '';
      const head = fields.find((field) => field.startsWith('HEAD '))?.slice(5) ?? '';
      if (!targetPath || /[\x00-\x1f]/.test(targetPath) || (ref && !validProjectBranchRef(ref)) || (head && !SHA.test(head))) throw new Error('ade: Arbeitskopien konnten nicht eindeutig gelesen werden.');
      let identity = ''; let notice: string | null = null;
      try { identity = projectRootIdentity(targetPath); assertNoLinks(join(targetPath, '.git')); }
      catch { notice = 'Arbeitskopie ist nicht erreichbar oder verknüpft.'; }
      if (fields.some((field) => /^(bare|locked|prunable)( |$)/.test(field))) notice = 'Arbeitskopie ist gesperrt, veraltet oder ohne Arbeitsverzeichnis. Am PC prüfen.';
      return { path: targetPath, identity, ref, head, view: { id: 'w' + digest([targetPath, identity]).slice(0, 32), name: redactForWire(basename(targetPath), 200),
        branch: redactForWire(ref ? ref.slice(11) : '(detached HEAD)', 200), current: sameHostPath(targetPath, path), available: !notice, notice } };
    });
    if (worktrees.length > 100) throw new Error('ade: Maximal 100 Arbeitskopien in dieser Ansicht.');
    const refLines = refsRaw.trimEnd().split(/\r?\n/).filter(Boolean);
    if (refLines.length > 200) throw new Error('ade: Maximal 200 Branches in dieser Ansicht.');
    const branches: ProjectBranch[] = refLines.map((line) => {
      const [ref, head, symbolic] = line.split('\0');
      if (symbolic) return null;
      if (!ref || !head || !validProjectBranchRef(ref) || !SHA.test(head) || redactForWire(ref, 4096) !== ref) throw new Error('ade: Branch-Liste konnte nicht eindeutig gelesen werden.');
      const local = ref.startsWith('refs/heads/'); const worktree = worktrees.find((item) => item.ref === ref);
      return { ref, name: ref.slice(local ? 11 : 13), kind: local ? 'local' as const : 'remote' as const, head,
        current: ref === `refs/heads/${scope.branch}`, worktreeId: worktree?.view.id ?? null };
    }).filter((branch) => branch !== null);
    if (branches.length > 200) throw new Error('ade: Maximal 200 Branches in dieser Ansicht.');
    const current = worktrees.find((item) => item.view.current);
    if (!current) throw new Error('ade: Aktueller Workspace fehlt in der Git-Liste.');
    const head = /^0+$/.test(current.head) || !current.head ? null : current.head;
    const operationFiles = ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'rebase-merge', 'rebase-apply', 'sequencer', 'index.lock'];
    const interrupted = operationFiles.some((name) => { const target = join(scope.workspace.gitDirectory, name); assertNoLinks(target); return existsSync(target); });
    const after = await this.projects.resolve(workspaceId);
    if (after.branch !== scope.branch) throw new Error('ade: Branch wurde während des Lesens geändert. Erneut prüfen.');
    const value: ProjectBranchOverview = { workspace: await this.projects.overview(workspaceId), head, branches, worktrees: worktrees.map((item) => item.view),
      dirty: status.length > 0, blockedReason: interrupted ? 'Eine Git-Operation läuft oder muss abgeschlossen werden.' : null,
      revision: digest([scope.workspace, scope.branch, head, refsRaw, worktreesRaw, worktrees.map((item) => item.identity), status, interrupted]), checkedAt: this.now() };
    const inspected = { scope, value, worktrees, operationInProgress: interrupted };
    if (!value.blockedReason) try { this.assertBusy(inspected, false); } catch (error) { value.blockedReason = redactForWire((error as Error).message.replace(/^ade: /, ''), 350); }
    return inspected;
  }
}
