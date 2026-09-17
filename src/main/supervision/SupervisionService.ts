import { randomUUID } from 'node:crypto';
import type { AdeConfig, SessionMeta } from '../../shared/types';
import { validSupervisionCommand, type SupervisionCommand, type SupervisionTarget, type SupervisionReceipt, type SupervisionView, type MorningBriefing, type HandoffDetail } from '../../shared/supervision';
import { SupervisionStore, supervisionDigest } from './SupervisionStore';

/** Ownership changes are metadata only. Launch requires its separate task or
 * conversation contract, and ending supervision never kills a project process. */
export class SupervisionService {
  constructor(private readonly store: SupervisionStore, private readonly catalog: { get(): AdeConfig }, private readonly session: (id: string) => SessionMeta | undefined,
    private readonly now = Date.now, private readonly childLinks: (projectId: string) => Array<{ id: string; target: SupervisionTarget; createdAt: number }> = () => []) {}
  private resolve(repositoryId: string, target: SupervisionTarget) {
    const config = this.catalog.get();
    if (target.kind === 'run') {
      const run = config.runs.find(r => r.id === target.id && r.repositoryId === repositoryId);
      return run ? { title: run.name, status: run.status, available: true } : undefined;
    }
    const session = this.session(target.id);
    if (!session || session.repositoryId !== repositoryId || session.runTaskId || session.remoteAccessBlocked || session.kind !== 'interactive') return undefined;
    return { title: session.title, status: session.status, available: session.status === 'running' };
  }
  query(): SupervisionView {
    const state = this.store.snapshot(); const config = this.catalog.get(); const profile = config.agents.find(a => a.id === state.profileId);
    return { revision: state.revision, profile: state.profileId ? { id: state.profileId, name: profile?.name ?? 'Entferntes Profil', available: !!profile } : null,
      projects: state.projects.map(p => {
        const repo = config.repositories.find(r => r.id === p.repositoryId);
        return { id: p.id, repositoryId: p.repositoryId, name: repo?.name ?? 'Entferntes Projekt', available: !!repo?.verified, mode: p.mode, updatedAt: p.updatedAt,
          objective: { sha256: supervisionDigest(p.objective), chars: p.objective.length },
          links: [...p.links, ...this.childLinks(p.id).filter(child => !p.links.some(l => l.target.kind === child.target.kind && l.target.id === child.target.id))]
            .map(l => ({ id: l.id, target: l.target, ...(!p.links.some(saved => saved.id === l.id) ? { origin: 'conversation' as const } : {}),
              ...(this.resolve(p.repositoryId, l.target) ?? { title: 'Nicht mehr verfügbar', status: 'unavailable', available: false }) })) };
      }) };
  }
  detail(projectId: string): { objective: string } {
    const project = this.store.snapshot().projects.find(p => p.id === projectId); if (!project) throw new Error('Betreutes Projekt ist nicht mehr vorhanden.');
    return { objective: project.objective };
  }
  handoff(projectId: string, handoffId: string): HandoffDetail {
    const h = this.store.snapshot().handoffs.find(h => h.projectId === projectId && h.id === handoffId);
    if (!h) throw new Error('Übergabe gehört nicht zu diesem Projekt.');
    return { text: h.text, nextStep: h.nextStep };
  }
  briefing(): MorningBriefing {
    const state = this.store.snapshot(); const config = this.catalog.get();
    const digest = (text: string) => ({ sha256: supervisionDigest(text), chars: text.length });
    return { revision: state.revision, observedAt: this.now(), projects: this.query().projects.map(p => {
      const work = p.links.map(link => {
        const run = link.target.kind === 'run' ? config.runs.find(r => r.id === link.target.id && r.repositoryId === p.repositoryId) : undefined;
        return { linkId: link.id, title: link.title, status: link.status, available: link.available,
          pendingQuestions: run ? config.runTasks.filter(t => t.runId === run.id).reduce((count, task) => count + (task.questions?.filter(q => q.status === 'pending').length ?? 0), 0) : 0,
          // A live PTY is not evidence of completed work or its last activity.
          updatedAt: run?.updatedAt ?? null };
      });
      const handoffs = state.handoffs.filter(h => h.projectId === p.id).sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id))
        .map(h => ({ id: h.id, status: h.status, createdAt: h.createdAt, updatedAt: h.updatedAt, text: digest(h.text), nextStep: digest(h.nextStep) }));
      const suggestion = work.some(w => w.pendingQuestions) ? 'answer-question' : work.some(w => w.status === 'failed') ? 'review-failure'
        : handoffs.some(h => h.status === 'open') ? 'resume-handoff' : work.some(w => w.status === 'running') ? 'observe-work' : 'choose-work';
      return { id: p.id, repositoryId: p.repositoryId, name: p.name, available: p.available, mode: p.mode, work, handoffs, suggestion };
    }) };
  }
  command(input: SupervisionCommand): SupervisionReceipt {
    if (!validSupervisionCommand(input)) throw new Error('Ungültiger Betreuungsauftrag.');
    const state = this.store.snapshot(); const fingerprint = supervisionDigest(JSON.stringify(input));
    const replay = state.commands.find(c => c.id === input.commandId);
    if (replay) { if (replay.fingerprint !== fingerprint) throw new Error('Betreuungsauftrag wurde mit anderer Eingabe wiederholt.'); return { revision: replay.revision, replayed: true }; }
    if (input.revision !== state.revision) throw new Error('Betreuung wurde inzwischen geändert. Neu laden und Auswahl prüfen.');
    const config = this.catalog.get();
    if (input.operation === 'profile') {
      if (input.agentId !== null && !config.agents.some(a => a.id === input.agentId)) throw new Error('ADE-Profil ist nicht mehr vorhanden.');
      state.profileId = input.agentId;
    } else if (input.operation === 'project') {
      if (!config.repositories.some(r => r.id === input.repositoryId && r.verified)) throw new Error('Ein geprüftes Projekt auswählen.');
      let project = state.projects.find(p => p.repositoryId === input.repositoryId);
      if (!project) { if (state.projects.length >= 64) throw new Error('Höchstens 64 Projekte betreuen.'); project = { id: randomUUID(), repositoryId: input.repositoryId, mode: input.mode, objective: '', links: [], updatedAt: this.now() }; state.projects.push(project); }
      project.objective = input.objective; project.mode = input.mode; project.updatedAt = this.now();
    } else {
      const project = state.projects.find(p => p.id === input.projectId); if (!project) throw new Error('Betreutes Projekt ist nicht mehr vorhanden.');
      if (input.operation === 'remember') {
        if (!config.repositories.some(r => r.id === project.repositoryId && r.verified)) throw new Error('Projekt ist nicht mehr verfügbar.');
        const link = input.linkId === null ? null : [...project.links, ...this.childLinks(project.id)].find(l => l.id === input.linkId);
        if (input.linkId !== null && !link) throw new Error('Übergabequelle gehört nicht zu diesem Projekt.');
        if (state.handoffs.length >= 1024) throw new Error('Übergabespeicher ist voll. Bestehende Übergaben bleiben erhalten.');
        state.handoffs.push({ id: randomUUID(), projectId: project.id, text: input.text, nextStep: input.nextStep,
          source: link ? structuredClone(link.target) : null, status: 'open', createdAt: this.now(), updatedAt: this.now() });
      } else if (input.operation === 'handoff-status') {
        const handoff = state.handoffs.find(h => h.id === input.handoffId && h.projectId === project.id);
        if (!handoff) throw new Error('Übergabe gehört nicht zu diesem Projekt.');
        handoff.status = input.status; handoff.updatedAt = this.now();
      } else if (input.operation === 'link') {
        if (!config.repositories.some(r => r.id === project.repositoryId && r.verified) || !this.resolve(project.repositoryId, input.target)) throw new Error('Arbeit gehört nicht zu diesem verfügbaren Projekt.');
        if (project.links.some(l => l.target.kind === input.target.kind && l.target.id === input.target.id)) throw new Error('Arbeit ist bereits verknüpft.');
        if (project.links.length >= 64) throw new Error('Projekt hat sein Verbindungslimit erreicht.');
        project.links.push({ id: randomUUID(), target: structuredClone(input.target), createdAt: this.now() });
      } else {
        if (!project.links.some(l => l.id === input.linkId)) throw new Error('Verbindung ist nicht mehr vorhanden.');
        project.links = project.links.filter(l => l.id !== input.linkId);
      }
      project.updatedAt = this.now();
    }
    state.revision++; state.commands.push({ id: input.commandId, fingerprint, revision: state.revision }); state.commands = state.commands.slice(-512);
    this.store.save(state); return { revision: state.revision, replayed: false };
  }
  /** Read-only recovery. An absent bounded receipt must never be retried as a
   * new side effect by the coordinator. */
  recall(input: SupervisionCommand): SupervisionReceipt | null {
    const receipt = this.store.snapshot().commands.find(c => c.id === input.commandId);
    if (!receipt) return null;
    if (receipt.fingerprint !== supervisionDigest(JSON.stringify(input))) throw new Error('Betreuungsquittung gehört zu einer anderen Eingabe.');
    return { revision: receipt.revision, replayed: true };
  }
}
