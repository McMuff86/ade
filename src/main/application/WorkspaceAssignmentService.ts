import { createHash, randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import type { AdeConfig, SessionMeta } from '../../shared/types';
import type { MobileWorkspacePrepareInput, WorkspaceAssignmentCandidate, WorkspaceAssignmentResult, WorkspaceAssignmentView } from '../../shared/remote';
import type { ProjectWorkspaceService } from '../repositories/ProjectWorkspaceService';
import { projectGit } from '../repositories/ProjectGitBoundary';
import { projectRootIdentity } from '../settings/ProjectDefaultsService';
import { sameHostPath } from '../platform';
import { redactForWire } from '../errors';
import { workspaceOperations } from '../repositories/WorkspaceOperationGate';

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
type Selection = MobileWorkspacePrepareInput;
interface Target { path: string; candidate: WorkspaceAssignmentCandidate }
interface PreviewRecord { owner: string; selection: Selection; candidateId: string; fingerprint: string; expiresAt: number }
interface DirectoryPreviewRecord { owner: string; agentId: string; entryId: string; fingerprint: string; expiresAt: number }
export type AssignmentAuthorization = (repositoryId?: string) => void;
export class WorkspaceAssignmentService {
  private readonly previews = new Map<string, PreviewRecord>();
  private readonly directoryPreviews = new Map<string, DirectoryPreviewRecord>();
  constructor(private readonly store: { get(): AdeConfig; save(value: Partial<AdeConfig>): AdeConfig },
    private readonly projects: ProjectWorkspaceService, private readonly sessions: () => SessionMeta[],
    private readonly now = () => Date.now()) {}

  private pair(selection: Selection) {
    const config = this.store.get();
    const agent = config.agents.find((item) => item.id === selection.agentId);
    const repository = config.repositories.find((item) => item.id === selection.repositoryId);
    if (!agent || !repository?.verified || repository.executionBackend !== 'native') throw new Error('ade: Agent und geprüftes natives Projekt auswählen.');
    const assignment = config.workspaceAssignments.find((item) => item.agentId === agent.id && item.repositoryId === repository.id);
    const binding = config.workspaceBindings.find((item) => item.agentId === agent.id && item.repositoryId === repository.id);
    return { agent, repository, assignment, binding };
  }

  private blockers(selection: Selection, path: string): string[] {
    const config = this.store.get(); const { assignment, binding } = this.pair(selection);
    const oldPath = assignment ? config.projectWorkspaces.find((item) => item.id === assignment.projectWorkspaceId)?.workspaceDir : binding?.workspaceDir;
    const touches = (item: { workspaceDir?: string; executionBackend?: string; projectWorkspaceId?: string; workspaceBindingId?: string }) =>
      !!assignment && item.projectWorkspaceId === assignment.projectWorkspaceId || !assignment && !!binding && item.workspaceBindingId === binding.id
      || (item.executionBackend ?? 'native') === 'native' && !!item.workspaceDir && (sameHostPath(item.workspaceDir, path) || !!oldPath && sameHostPath(item.workspaceDir, oldPath));
    const reasons: string[] = [];
    if (this.sessions().some((item) => item.status === 'running' && touches(item))) reasons.push('Im bisherigen oder gewählten Workspace läuft ein Terminal. Zuerst beenden.');
    if (config.runWorkspaceLeases.some((item) => item.status === 'active' && touches(item))
      || config.runTasks.some((item) => config.runParticipants.some((participant) => participant.id === item.participantId && participant.agentId === selection.agentId)
        && item.repositoryId === selection.repositoryId && ['queued', 'running'].includes(item.status))) reasons.push('Ein Auftrag verwendet diese Zuordnung. Zuerst abschliessen.');
    if (config.workspaceBindings.some((item) => item.agentId !== selection.agentId && item.status !== 'invalid'
      && item.executionBackend === 'native' && sameHostPath(item.workspaceDir, path))
      || config.workspaceAssignments.some((item) => item.agentId !== selection.agentId && config.projectWorkspaces.some((workspace) => workspace.id === item.projectWorkspaceId && sameHostPath(workspace.workspaceDir, path)))) reasons.push('Dieser Workspace ist bereits einem anderen Agenten zugewiesen.');
    return reasons;
  }

  private async discover(selection: Selection) {
    const state = this.pair(selection); const { repository, assignment, binding } = state;
    await this.projects.inspectCheckout(repository.rootPath, repository.id);
    const raw = await projectGit(repository.rootPath, ['worktree', 'list', '--porcelain', '-z']);
    const targets: Target[] = [];
    const currentPath = assignment ? this.store.get().projectWorkspaces.find((item) => item.id === assignment.projectWorkspaceId)?.workspaceDir : binding?.workspaceDir;
    for (const record of raw.split('\0\0').slice(0, 64)) {
      const fields = record.split('\0'); const path = fields.find((item) => item.startsWith('worktree '))?.slice(9);
      if (!path) continue;
      let identity = ''; let notice: string | null = null;
      try { identity = projectRootIdentity(path); } catch { notice = 'Ordner nicht erreichbar oder verknüpft. Am PC prüfen.'; }
      const ade = !!binding && sameHostPath(path, binding.workspaceDir);
      const branch = fields.find((item) => item.startsWith('branch refs/heads/'))?.slice(18) ?? '(detached HEAD)';
      const id = ade ? 'ade' : 'w' + hash([repository.id, path, identity]).slice(0, 32);
      const reasons = this.blockers(selection, path);
      targets.push({ path, candidate: { id, name: ade ? 'Eigene ADE-Arbeitskopie' : sameHostPath(path, repository.rootPath) ? 'Projektordner' : redactForWire(basename(path), 200),
        kind: ade ? 'ade' : sameHostPath(path, repository.rootPath) ? 'checkout' : 'worktree', branch: redactForWire(branch, 200),
        current: !!currentPath && sameHostPath(currentPath, path), available: !notice && !reasons.length, notice: notice ?? reasons[0] ?? null } });
    }
    const current = targets.find((item) => item.candidate.current);
    const view: WorkspaceAssignmentView = {
      repositoryId: repository.id,
      selection: assignment ? { projectWorkspaceId: assignment.projectWorkspaceId } : { ...selection },
      branch: current?.candidate.branch ?? '', label: current?.candidate.name ?? (assignment ? 'Zugewiesener Workspace nicht erreichbar' : binding ? 'ADE-Arbeitskopie nicht erreichbar' : 'Noch kein Workspace zugewiesen'),
      candidates: targets.map((item) => item.candidate), notice: !current ? 'Zuweisung prüfen und einen erreichbaren Workspace auswählen.' : null,
    };
    return { state, targets, view };
  }

  private async inspectProject(agentId: string, entryId: string, authorize: AssignmentAuthorization) {
    if (!this.store.get().agents.some((item) => item.id === agentId)) throw new Error('ade: Agent ist nicht mehr vorhanden.');
    const inspected = await this.projects.inspectDirectory(entryId, (target) => authorize(target?.repositoryId)); authorize(inspected.repositoryId);
    const { target, identity } = inspected;
    const [head, changes] = await Promise.all([projectGit(target.path, ['rev-parse', '--revs-only', 'HEAD']), projectGit(target.path, ['status', '--porcelain=v1', '-z', '--untracked-files=normal'])]);
    const again = await this.projects.inspectDirectory(entryId, (target) => authorize(target?.repositoryId)); authorize(again.repositoryId);
    if (hash(inspected) !== hash(again)) throw new Error('ade: Projektordner wurde während der Prüfung geändert.');
    const blockers = inspected.repositoryId ? this.blockers({ agentId, repositoryId: inspected.repositoryId }, target.path) : [];
    if (this.sessions().some((item) => item.status === 'running' && item.executionBackend === 'native' && item.workspaceDir && sameHostPath(item.workspaceDir, target.path))) blockers.push('Im gewählten Projektordner läuft ein Terminal. Zuerst beenden.');
    const candidate: WorkspaceAssignmentCandidate = { id: entryId, name: redactForWire(target.entry.name, 200), branch: redactForWire(identity.branch, 200),
      kind: sameHostPath(identity.git, identity.common) ? 'checkout' : 'worktree', current: false, available: !blockers.length, notice: blockers[0] ?? null };
    const view: WorkspaceAssignmentView = { repositoryId: inspected.repositoryId ?? '', selection: { agentId, repositoryId: inspected.repositoryId ?? null },
      branch: candidate.branch, label: candidate.name, candidates: [candidate], notice: null };
    return { view, inspected, blockers, candidate, fingerprint: hash([agentId, inspected, head, changes,
      this.store.get().workspaceAssignments.filter((item) => item.agentId === agentId)]),
      checks: ['Projektordner erreichbar; keine symbolische Verknüpfung.', 'Git-Repository, Hauptworkspace und Branch geprüft.',
        inspected.repositoryId ? 'Projekt ist bereits in ADE registriert.' : 'Projekt wird erst beim Zuweisen in ADE registriert.',
        changes ? 'Lokale Änderungen vorhanden. Sie bleiben erhalten.' : 'Keine lokalen Git-Änderungen.',
        'Dateien und Terminal verwenden nach der Zuweisung diesen Projektordner.'] };
  }

  async previewProject(agentId: string, entryId: string, owner: string, authorize: AssignmentAuthorization): Promise<WorkspaceAssignmentResult> {
    const result = await this.inspectProject(agentId, entryId, authorize);
    for (const [id, record] of this.directoryPreviews) if (record.expiresAt <= this.now()) this.directoryPreviews.delete(id);
    if (this.directoryPreviews.size >= 128) this.directoryPreviews.delete(this.directoryPreviews.keys().next().value!);
    const id = randomUUID(); const expiresAt = this.now() + 120_000;
    this.directoryPreviews.set(id, { agentId, entryId, owner, expiresAt, fingerprint: result.fingerprint });
    return { view: result.view, preview: { id, expiresAt, candidate: result.candidate, checks: result.checks, blockers: result.blockers } };
  }

  async confirm(agentId: string, previewId: string, owner: string, authorize: AssignmentAuthorization) {
    const record = this.previews.get(previewId);
    if (record) {
      if (record.selection.agentId !== agentId) throw new Error('ade: Prüfung gehört zu einem anderen Agenten.');
      return this.apply(record.selection, previewId, owner, () => authorize(record.selection.repositoryId));
    }
    return workspaceOperations.mutate(async () => {
      const preview = this.directoryPreviews.get(previewId);
      if (!preview || preview.agentId !== agentId || preview.owner !== owner || preview.expiresAt <= this.now()) throw new Error('ade: Prüfung abgelaufen. Erneut prüfen.');
      const result = await this.inspectProject(agentId, preview.entryId, authorize);
      if (result.fingerprint !== preview.fingerprint) throw new Error('ade: Projekt oder Zuweisung wurde seit der Prüfung geändert. Erneut prüfen.');
      if (result.blockers.length) throw new Error(`ade: ${result.blockers.join(' ')}`);
      const workspace = await this.projects.registerDirectory(preview.entryId, () => authorize(result.inspected.repositoryId));
      authorize(workspace.repositoryId);
      const blockers = this.blockers({ agentId, repositoryId: workspace.repositoryId }, result.inspected.target.path);
      if (blockers.length) throw new Error(`ade: ${blockers.join(' ')}`);
      const config = this.store.get(); const assignments = config.workspaceAssignments.filter((item) => item.agentId !== agentId || item.repositoryId !== workspace.repositoryId);
      if (assignments.length >= 1000) throw new Error('ade: Maximal 1000 Workspace-Zuweisungen.');
      assignments.push({ agentId, repositoryId: workspace.repositoryId, projectWorkspaceId: workspace.id });
      this.store.save({ workspaceAssignments: assignments }); this.directoryPreviews.delete(previewId);
      return { view: { ...result.view, repositoryId: workspace.repositoryId, selection: { projectWorkspaceId: workspace.id }, candidates: [{ ...result.candidate, current: true }] } };
    });
  }

  async overview(selection: Selection, authorize: () => void): Promise<WorkspaceAssignmentResult> {
    authorize(); const result = await this.discover(selection); authorize(); return { view: result.view };
  }

  private async inspect(selection: Selection, candidateId: string, authorize: () => void) {
    authorize(); const discovered = await this.discover(selection); authorize();
    const target = discovered.targets.find((item) => item.candidate.id === candidateId);
    if (!target) throw new Error('ade: Workspace-Auswahl wurde geändert. Erneut prüfen.');
    const inspected = await this.projects.inspectCheckout(target.path, selection.repositoryId);
    const [head, changes] = await Promise.all([projectGit(target.path, ['rev-parse', '--revs-only', 'HEAD']), projectGit(target.path, ['status', '--porcelain=v1', '-z', '--untracked-files=normal'])]);
    const again = await this.projects.inspectCheckout(target.path, selection.repositoryId); authorize();
    if (hash(inspected) !== hash(again)) throw new Error('ade: Workspace wurde während der Prüfung geändert.');
    const { assignment, binding } = this.pair(selection);
    const fingerprint = hash([selection, assignment, binding && [binding.id, binding.workspaceDir, binding.branch, binding.status], inspected, head, changes]);
    return { ...discovered, target, inspected, fingerprint, blockers: this.blockers(selection, target.path),
      checks: ['Ordner erreichbar; keine symbolische Verknüpfung.', 'Git-Identität stimmt mit dem ausgewählten Projekt überein.',
        `Branch: ${redactForWire(inspected.branch, 200)}`, changes ? 'Lokale Änderungen vorhanden. Sie bleiben bei der Zuweisung erhalten.' : 'Keine lokalen Git-Änderungen.',
        'Die Zuweisung ändert keine Dateien, Branches oder Agent-Anweisungen.'] };
  }

  async preview(selection: Selection, candidateId: string, owner: string, authorize: () => void): Promise<WorkspaceAssignmentResult> {
    const result = await this.inspect(selection, candidateId, authorize);
    for (const [id, record] of this.previews) if (record.expiresAt <= this.now()) this.previews.delete(id);
    if (this.previews.size >= 128) this.previews.delete(this.previews.keys().next().value!);
    const id = randomUUID(); const expiresAt = this.now() + 120_000;
    this.previews.set(id, { owner, selection: { ...selection }, candidateId, fingerprint: result.fingerprint, expiresAt });
    return { view: result.view, preview: { id, candidate: result.target.candidate, expiresAt, checks: result.checks, blockers: result.blockers } };
  }

  async apply(selection: Selection, previewId: string, owner: string, authorize: () => void): Promise<WorkspaceAssignmentResult> {
    return workspaceOperations.mutate(async () => {
      authorize(); const preview = this.previews.get(previewId);
      if (!preview || preview.owner !== owner || preview.expiresAt <= this.now() || hash(preview.selection) !== hash(selection)) throw new Error('ade: Prüfung abgelaufen oder gehört zu einer anderen Auswahl. Erneut prüfen.');
      const result = await this.inspect(selection, preview.candidateId, authorize);
      if (preview.fingerprint !== result.fingerprint) throw new Error('ade: Workspace oder Zuweisung wurde seit der Prüfung geändert. Erneut prüfen.');
      if (result.blockers.length) throw new Error(`ade: ${result.blockers.join(' ')}`);
      const workspace = preview.candidateId === 'ade' ? undefined : await this.projects.registerCheckout(result.target.path, selection.repositoryId, authorize);
      // Registration only records the validated checkout. Recheck authority and
      // active work immediately before changing the persisted association.
      authorize(); const blockers = this.blockers(selection, result.target.path);
      if (blockers.length) throw new Error(`ade: ${blockers.join(' ')}`);
      const config = this.store.get();
      const assignments = config.workspaceAssignments.filter((item) => item.agentId !== selection.agentId || item.repositoryId !== selection.repositoryId);
      if (workspace) assignments.push({ ...selection, projectWorkspaceId: workspace.id });
      if (assignments.length > 1000) throw new Error('ade: Maximal 1000 Workspace-Zuweisungen.');
      this.store.save({ workspaceAssignments: assignments }); this.previews.delete(previewId);
      return { view: { ...result.view, selection: workspace ? { projectWorkspaceId: workspace.id } : { ...selection },
        branch: redactForWire(result.inspected.branch, 200), label: result.target.candidate.name, notice: null,
        candidates: result.view.candidates.map((item) => ({ ...item, current: item.id === preview.candidateId })) } };
    });
  }
}
