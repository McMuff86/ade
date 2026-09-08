import type { JSX } from 'react';
import type { MobileHost } from './useMobileHost';
import { MobileAvatar } from './AgentProfile';
import { runtimeVisual } from '../renderer/graph/runtimeGlyphs';
import { formatRelativeTime, formatTokenCount, formatCostUsd } from '../shared/overviewFormat';
import { finalStates, Icon, reportedTokens, runKindLabel, Status } from './ui';
import type { MobileRunSummary } from '../shared/remote';

export function RunRow({ run, selected, onSelect }: { run: MobileRunSummary; selected: boolean; onSelect: () => void }): JSX.Element {
  return <button className="m-run-row" aria-pressed={selected} aria-label={`Run ${run.name}`} onClick={(event) => { event.currentTarget.focus(); onSelect(); }}>
    <Status status={run.status} /><span className="m-run-name"><strong>{run.name}</strong><small>{run.phase} · {runKindLabel(run)}</small></span>
    <span className="m-run-project">{run.repositoryName ?? 'Repository'}</span><span className="m-run-tasks">{run.tasks.filter((task) => task.status === 'completed').length}/{run.tasks.length} Tasks</span>
    <span className="m-run-time">{formatRelativeTime(Date.now(), run.updatedAt)}</span>
  </button>;
}

export function Overview({ host, selected, onRun, onAgent, onProject }: { host: MobileHost; selected: string | null;
  onRun: (id: string) => void; onAgent: (id: string) => void; onProject: (id: string) => void;
}): JSX.Element {
  const { catalog, runs, health } = host;
  const tokens = reportedTokens(runs);
  const open = runs.filter((run) => !finalStates.has(run.status));
  const recent = [...runs].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 20);
  return <div className="m-overview" data-testid="mobile-overview">
    <header className="m-hero" aria-label="Overview figures">
      <div><span className="m-eyebrow">Aktive Tasks</span><strong>{health?.queue.active ?? '—'}</strong><small>{health ? `${health.queue.queued} in der Warteschlange · ${health.queue.maxActive} Slots` : 'Warte auf den PC'}</small></div>
      <div><span className="m-eyebrow">Offen</span><strong>{catalog ? open.length : '—'}</strong><small>{catalog ? `${open.filter((run) => run.pendingApprovalId).length} Freigaben ausstehend` : 'Warte auf den PC'}</small></div>
      <div><span className="m-eyebrow">Tokens</span><strong>{tokens ? formatTokenCount(Number(tokens)) : '—'}</strong><small>{tokens ? 'Gemeldete Tokens · Vollständigkeit unbekannt' : 'Noch keine Token-Angabe'}</small></div>
    </header>
    {!catalog ? <p className="m-loading" role="status">Projekte und Agents werden geladen…</p> : <>
      <section className="m-ledger" aria-labelledby="mobile-agents-title"><h2 id="mobile-agents-title">Agents <span>{catalog.agents.length}</span></h2>
        {!catalog.agents.length ? <p className="m-empty-copy">Noch keine Agents. Am PC in ADE einrichten.</p> : <ul className="m-agent-list">{catalog.agents.map((agent) => {
          const repo = catalog.repositories.find((repository) => repository.id === agent.defaultRepositoryId);
          return <li key={agent.id}><button className="m-agent-row" onClick={(event) => { event.currentTarget.focus(); onAgent(agent.id); }} aria-label={`Workspace für ${agent.name}`}>
            <MobileAvatar host={host} agent={agent} size={30} /><span className="m-agent-name"><strong>{agent.name}</strong><small>{runtimeVisual(agent.runtime).label}</small></span>
            <span className="m-agent-role">{agent.role || 'Agent'}</span><span className="m-agent-repo">{repo?.name ?? 'portable'}</span><span className="m-row-action" aria-hidden="true">↗</span>
          </button></li>;
        })}</ul>}
      </section>
      <section className="m-ledger" aria-labelledby="mobile-projects-title"><h2 id="mobile-projects-title">Projects <span>{catalog.repositories.length}</span></h2>
        {!catalog.repositories.length ? <p className="m-empty-copy">Noch keine Repositories. Am PC in ADE einrichten.</p> : <ul className="m-projects">{catalog.repositories.map((repo) => {
          const projectRuns = runs.filter((run) => run.repositoryId === repo.id);
          const last = [...projectRuns].sort((a, b) => b.updatedAt - a.updatedAt)[0];
          return <li key={repo.id}><button className="m-project-card" onClick={(event) => { event.currentTarget.focus(); onProject(repo.id); }} aria-label={`Aufgabe in ${repo.name}`}>
            <span className="m-project-title"><Icon name="project" /><strong>{repo.name}</strong><span>{repo.executionBackend}</span></span>
            <span>{repo.verified ? 'Verifiziert' : 'Noch ungeprüft'} · {projectRuns.length} Runs</span>
            <small>{last ? `${last.name} · ${formatRelativeTime(Date.now(), last.updatedAt)}` : 'Noch keine Run-Aktivität'}</small>
          </button></li>;
        })}</ul>}
      </section>
      <section className="m-ledger" aria-labelledby="mobile-work-title"><h2 id="mobile-work-title">Work <span>Letzte {recent.length} Runs</span></h2>
        {!recent.length ? <p className="m-empty-copy">Noch keine Runs. Über „Neue Aufgabe“ oder „Neuer Run“ loslegen.</p> : <ul className="m-work-list">{recent.map((run) => <li key={run.id}><RunRow run={run} selected={selected === run.id} onSelect={() => onRun(run.id)} /></li>)}</ul>}
        <p className="m-section-note">{runs.some((run) => run.usage.costUsd > 0) ? `${formatCostUsd(runs.reduce((sum, run) => sum + run.usage.costUsd, 0))} gemeldete Run-Kosten` : 'Kosten noch nicht gemeldet'} · Aktuelle Daten vom PC</p>
      </section>
    </>}
  </div>;
}
