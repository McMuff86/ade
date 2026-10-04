import { localizedState } from '../shared/i18n/states';
import { t as translate } from "../shared/i18n";
import { useLocale } from "../renderer/i18n/language";
import { useMemo, type JSX, type ReactNode } from 'react';
import type { MobileHost } from './useMobileHost';
import { MobileAvatar } from './AgentProfile';
import { runtimeVisual } from '../renderer/graph/runtimeGlyphs';
import { formatRelativeTime, formatTokenCount, formatCostUsd } from '../shared/overviewFormat';
import { finalStates, Icon, reportedTokens, runKindLabel, Status } from './ui';
import type { MobileRunSummary } from '../shared/remote';
import type { AttentionTarget } from '../shared/attention';
import { AttentionPanel } from '../renderer/attention/AttentionPanel';
import type { AttentionActionsPort } from '../renderer/attention/AttentionDecision';
import { DashboardLink } from './DashboardLink';
import { UsageOverviewPanel, UsageOverviewTile, useUsageOverview } from '../renderer/usage/UsageOverviewCard';
import type { UsageOverview } from '../shared/usageOverview';

export function RunRow({ run, selected, onSelect }: { run: MobileRunSummary; selected: boolean; onSelect: () => void }): JSX.Element {
  useLocale();
  return <button className="m-run-row" aria-pressed={selected} aria-label={translate("Run {{value1}}", { value1: run.name })} onClick={(event) => { event.currentTarget.focus(); onSelect(); }}>
    <Status status={run.status} /><span className="m-run-name"><strong>{run.name}</strong><small>{localizedState(run.phase)} · {runKindLabel(run)}</small></span>
    <span className="m-run-project">{run.repositoryName ?? 'Repository'}</span><span className="m-run-tasks">{run.tasks.filter((task) => task.status === 'completed').length}/{run.tasks.length}{" "}{translate("Tasks")}</span>
    <span className="m-run-time">{formatRelativeTime(Date.now(), run.updatedAt)}</span>
  </button>;
}

export function Overview({ host, selected, onRun, onAgent, onProject, onTerminal, onProfile, onAttention, continuation }: { host: MobileHost; selected: string | null;
  continuation?: ReactNode;
  onAttention(target: AttentionTarget, current: () => boolean): Promise<void> | void;
  onTerminal: (id: string) => void; onProfile: (id: string) => void;
  onRun: (id: string) => void; onAgent: (id: string) => void; onProject: (id: string) => void;
}): JSX.Element {
  useLocale();
  const { catalog, runs, health } = host;
  const tokens = reportedTokens(runs);
  // The tablet answers and cancels through its signed run routes. Instructions and
  // input stay in the terminal view, where this device claims the input lease.
  const actions = useMemo<AttentionActionsPort>(() => ({
    questions: { read: (id) => host.request(`/api/v1/runs/${id}/questions`),
      answer: (input, key) => host.request(`/api/v1/runs/${input.runId}/answers`, 'POST', { taskId: input.taskId, questionId: input.questionId, answers: input.answers }, key) },
    cancel: (runId, key) => host.request(`/api/v1/runs/${runId}/cancel`, 'POST', undefined, key),
    dismiss: (rowId, key) => host.request('/api/v1/attention/dismiss', 'POST', { id: rowId }, key),
  }), [host.request]);
  const usage = useUsageOverview(() => host.request<UsageOverview>('/api/v1/usage/overview', 'POST', {}), host.status === 'online');
  const open = runs.filter((run) => !finalStates.has(run.status));
  const recent = [...runs].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 20);
  return <div className="m-overview" data-testid="mobile-overview">
    <AttentionPanel identity={`mobile:${host.deviceId}:${host.identityVersion}`} actions={actions} online={host.status === 'online'} query={() => host.request('/api/v1/attention')} onOpen={onAttention} />
    {continuation}
    <header className="m-hero" aria-label={translate("Overview figures")}>
      <div><span className="m-eyebrow">{translate("Active Tasks")}</span><strong>{health?.queue.active ?? '—'}</strong><small>{health ? translate("{{value1}} queued · {{value2}} slots", { value1: health.queue.queued, value2: health.queue.maxActive }) : translate("Waiting for the PC")}</small></div>
      <div><span className="m-eyebrow">{translate("Open")}</span><strong>{catalog ? open.length : '—'}</strong><small>{catalog ? translate("{{value1}} approvals pending", { value1: open.filter((run) => run.pendingApprovalId).length }) : translate("Waiting for the PC")}</small></div>
      <UsageOverviewTile usage={usage} className="m-usage-tile" panelId="mobile-usage-panel" />
    </header>
    <UsageOverviewPanel usage={usage} id="mobile-usage-panel" online={host.status === 'online'} />
    {tokens ? <p className="m-field-note">{translate("Reported tokens · Completeness unknown")}: {formatTokenCount(Number(tokens))}</p> : null}
    {!catalog ? <p className="m-loading" role="status">{translate("Loading projects and agents…")}</p> : <>
      <section className="m-ledger" aria-labelledby="mobile-agents-title"><h2 id="mobile-agents-title">{translate("Agents")}{" "}<span>{catalog.agents.length}</span></h2>
        {!catalog.agents.length ? <p className="m-empty-copy">{translate("No agents yet. Set up on PC in ADE.")}</p> : <ul className="m-agent-list">{catalog.agents.map((agent) => {
          const repo = catalog.repositories.find((repository) => repository.id === agent.defaultRepositoryId);
          return <li key={agent.id}><button className="m-agent-row" onClick={(event) => { event.currentTarget.focus(); onAgent(agent.id); }} aria-label={translate("Workspace for {{value1}}", { value1: agent.name })}>
            <MobileAvatar host={host} agent={agent} size={30} /><span className="m-agent-name"><strong>{agent.name}</strong><small>{runtimeVisual(agent.runtime).label}</small></span>
            <span className="m-agent-role">{agent.role || 'Agent'}</span><span className="m-agent-repo">{repo?.name ?? 'portable'}</span><span className="m-row-action" aria-hidden="true">↗</span>
          </button><div className="m-agent-actions"><button disabled={host.status !== 'online'} aria-label={translate("Open terminal: {{value1}}", { value1: agent.name })}
            onClick={(event) => { event.currentTarget.focus(); onTerminal(agent.id); }}>{translate("Open / resume terminal")}</button><button disabled={host.status !== 'online'} aria-label={translate("Edit profile: {{value1}}", { value1: agent.name })}
            onClick={(event) => { event.currentTarget.focus(); onProfile(agent.id); }}>{translate("Edit profile")}</button><DashboardLink agent={agent} /></div></li>;
        })}</ul>}
      </section>
      <section className="m-ledger" aria-labelledby="mobile-projects-title"><h2 id="mobile-projects-title">{translate("My ADE Projects")}{" "}<span>{catalog.repositories.filter(repo => repo.inMyProjects !== false).length}</span></h2>
        {!catalog.repositories.some(repo => repo.inMyProjects !== false) ? <p className="m-empty-copy">{translate("No personal projects yet. Add projects under Projects → All.")}</p> : <ul className="m-projects">{catalog.repositories.filter(repo => repo.inMyProjects !== false).map((repo) => {
          const projectRuns = runs.filter((run) => run.repositoryId === repo.id);
          const last = [...projectRuns].sort((a, b) => b.updatedAt - a.updatedAt)[0];
          return <li key={repo.id}><button className="m-project-card" onClick={(event) => { event.currentTarget.focus(); onProject(repo.id); }} aria-label={translate("Open project: {{value1}}", { value1: repo.name })}>
            <span className="m-project-title"><Icon name="project" /><strong>{repo.name}</strong><span>{repo.executionBackend}</span></span>
            <span>{repo.verified ? translate("Verified") : translate("Not yet verified")} · {projectRuns.length}{" "}{translate("Runs")}</span>
            <small>{last ? `${last.name} · ${formatRelativeTime(Date.now(), last.updatedAt)}` : translate("No run activity yet")}</small>
          </button></li>;
        })}</ul>}
      </section>
      <section className="m-ledger" aria-labelledby="mobile-work-title"><h2 id="mobile-work-title">{translate("Jobs")}{" "}<span>{translate("Latest")}{" "}{recent.length}{" "}{translate("Runs")}</span></h2>
        {!recent.length ? <p className="m-empty-copy">{translate("No runs yet. Get started with “Assign agent work” or “New run”.")}</p> : <ul className="m-work-list">{recent.map((run) => <li key={run.id}><RunRow run={run} selected={selected === run.id} onSelect={() => onRun(run.id)} /></li>)}</ul>}
        <p className="m-section-note">{runs.some((run) => run.usage.costUsd > 0) ? translate("{{value1}} reported run costs", { value1: formatCostUsd(runs.reduce((sum, run) => sum + run.usage.costUsd, 0)) }) : translate("Costs not yet reported")}{" "}{translate("· Current data from the PC")}</p>
      </section>
    </>}
  </div>;
}
