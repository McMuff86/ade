/**
 * Read-only Overview: live/open/tokens, agents, projects, recent runs.
 * Clicks leave for Terminals or Graph. No mutations live here.
 */

import { useCallback, useEffect, useRef, useState, type JSX, type KeyboardEvent } from 'react';
import type {
  OverviewSnapshot,
  OverviewUsageRollup,
  OverviewWorkRow,
  RunPhase,
  RunStatus,
  SessionBookendExitReason,
} from '../../shared/types';
import { formatCostUsd, formatRelativeTime, formatTokenCount } from '../../shared/overviewFormat';
import { Avatar } from '../rail/Avatar';
import { useMode } from '../stores/mode';
import { useSelection } from '../stores/selection';
import { useRuns } from '../stores/runs';
import { useSessions } from '../stores/sessions';
import './overview.css';

function usageCaption(usage: OverviewUsageRollup): string {
  const tasks = usage.tasksWithTokens + usage.tasksWithoutTokens;
  if (tasks === 0) return 'Noch keine Managed Tasks';
  const bits = [`${tasks} task${tasks === 1 ? '' : 's'}`];
  if (usage.tasksWithoutTokens > 0) bits.push(`${usage.tasksWithoutTokens} ohne Angabe`);
  return bits.join(' · ');
}

function costCaption(usage: OverviewUsageRollup): string {
  const tasks = usage.tasksWithCost + usage.tasksWithoutCost;
  if (tasks === 0) return '';
  if (usage.tasksWithCost === 0) return `${tasks} task${tasks === 1 ? '' : 's'} ohne Kosten`;
  const cost = `Kosten ${formatCostUsd(usage.reportedCostUsd)}`;
  if (usage.tasksWithoutCost === 0) return cost;
  return `${cost} · ${usage.tasksWithoutCost} ohne Kosten`;
}

function workUsage(usage: OverviewUsageRollup): string {
  if (usage.tasksWithTokens === 0 && usage.tasksWithCost === 0) {
    return usage.tasksWithoutTokens + usage.tasksWithoutCost > 0
      ? 'Tokens unbekannt'
      : 'keine Telemetrie';
  }
  const parts: string[] = [];
  if (usage.tasksWithTokens > 0) {
    parts.push(`${formatTokenCount(usage.reportedInputTokens)} in / ${formatTokenCount(usage.reportedOutputTokens)} out`);
    if (usage.tasksWithoutTokens > 0) parts.push('Tokens teilweise');
  } else {
    parts.push('Tokens unbekannt');
  }
  if (usage.tasksWithCost === 0) parts.push('Kosten unbekannt');
  else {
    parts.push(formatCostUsd(usage.reportedCostUsd));
    if (usage.tasksWithoutCost > 0) parts.push('Kosten teilweise');
  }
  return parts.join(' · ');
}

function statusTone(status: RunStatus, phase: RunPhase): 'decision' | 'live' | 'fail' | 'neutral' {
  if (phase === 'approval') return 'decision';
  if (status === 'failed') return 'fail';
  if (status === 'running') return 'live';
  return 'neutral';
}

function statusLabel(status: RunStatus, phase: RunPhase): string {
  if (phase === 'approval') return 'approval';
  return status;
}

function sessionStatusLabel(reason: SessionBookendExitReason): string {
  if (reason === 'interrupted') return 'interrupted';
  if (reason === 'cancelled') return 'cancelled';
  return 'session';
}

function sessionTone(reason: SessionBookendExitReason): 'fail' | 'neutral' {
  return reason === 'interrupted' ? 'fail' : 'neutral';
}

function workStatus(row: OverviewWorkRow): { tone: 'decision' | 'live' | 'fail' | 'neutral'; label: string } {
  if (row.kind === 'session') {
    return { tone: sessionTone(row.exitReason), label: sessionStatusLabel(row.exitReason) };
  }
  return { tone: statusTone(row.status, row.phase), label: statusLabel(row.status, row.phase) };
}

export function OverviewView(): JSX.Element {
  const setMode = useMode((state) => state.setMode);
  const setSelectedAgent = useSelection((state) => state.setSelectedAgent);
  const setSelectedRepository = useSelection((state) => state.setSelectedRepository);
  const setActiveRun = useRuns((state) => state.setActiveRun);
  const setActiveSession = useSessions((state) => state.setActive);
  const [snapshot, setSnapshot] = useState<OverviewSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [workFilter, setWorkFilter] = useState<'current' | 'history' | 'all'>('current');
  const requestVersion = useRef(0);
  const [opening, setOpening] = useState(false); const openingRef = useRef(false);

  const load = useCallback((): void => {
    const version = ++requestVersion.current; setRefreshing(true);
    void window.ade.invoke('overview:get')
      .then((next) => {
        if (version !== requestVersion.current) return;
        setSnapshot(next);
        setError(null);
      })
      .catch((reason) => {
        if (version !== requestVersion.current) return;
        setError(reason instanceof Error ? reason.message : String(reason));
      }).finally(() => { if (version === requestVersion.current) setRefreshing(false); });
  }, []);

  useEffect(() => {
    load();
    const offChanged = window.ade.on('orchestration:changed', load);
    const offExit = window.ade.on('pty:exit', load);
    const offRemoved = window.ade.on('pty:removed', load);
    const offCatalog = window.ade.on('catalog:changed', load);
    window.addEventListener('focus', load);
    return () => {
      offChanged();
      offExit();
      offRemoved();
      offCatalog(); window.removeEventListener('focus', load); requestVersion.current++;
    };
  }, [load]);

  const now = snapshot?.generatedAt ?? Date.now();
  const currentWork = (row: OverviewWorkRow) => row.kind === 'run' && (row.status === 'running' || row.phase === 'approval');
  const visibleWork = snapshot?.work.filter((row) => workFilter === 'all' || (workFilter === 'current' ? currentWork(row) : !currentWork(row))) ?? [];
  const openAgent = (agentId: string): void => {
    setSelectedAgent(agentId);
    setMode('terminals');
  };
  const openProject = (repositoryId: string): void => {
    useSelection.getState().openProjectRepository(repositoryId);
    setMode('projects');
  };
  const openHomeTerminal = async (agentId: string): Promise<void> => {
    if (openingRef.current) return; openingRef.current = true; setOpening(true); setError(null);
    try {
      await useSessions.getState().hydrate(true);
      const current = Object.values(useSessions.getState().sessions).filter((session) => session.agentId === agentId
        && session.kind === 'interactive' && !session.repositoryId && session.status === 'running'
        && (session.program?.status === 'running' || session.program?.status === 'starting')
        && (!session.launchChoice || session.launchChoice.mode === 'agent')).sort((a, b) => b.createdAt - a.createdAt)[0];
      const session = current ?? await useSessions.getState().createSession(agentId, undefined, undefined, undefined, null, undefined, { mode: 'agent' });
      setSelectedRepository(null); setSelectedAgent(agentId); setActiveSession(agentId, session.id); setMode('terminals');
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { openingRef.current = false; setOpening(false); }
  };
  const openRun = (runId: string): void => {
    setActiveRun(runId);
    setMode('graph');
  };
  const openWork = (row: OverviewWorkRow): void => {
    if (row.kind === 'run') {
      openRun(row.id);
      return;
    }
    if (row.projectWorkspaceId) { useSelection.getState().openProjectSession(row.projectWorkspaceId, row.id); setMode('projects'); return; }
    if (!row.agentId) return;
    setSelectedAgent(row.agentId);
    const live = useSessions.getState().sessions[row.id];
    if (live?.status === 'running') setActiveSession(row.agentId, row.id);
    setMode('terminals');
  };

  const onRowKey = (event: KeyboardEvent<HTMLElement>, activate: () => void): void => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    activate();
  };

  return (
    <div className="ov" data-testid="overview">
      <div className="ov-toolbar"><p role="status">{snapshot ? `Aktualisiert ${new Date(snapshot.generatedAt).toLocaleTimeString()}` : 'Overview wird geladen…'}</p>
        <button disabled={refreshing} onClick={load}>Overview aktualisieren</button></div>
      {error ? <div className="ov-error" role="alert">{error}</div> : null}
      {!snapshot && !error ? (
        <p className="ov-empty" data-testid="overview-loading">Laden…</p>
      ) : null}
      <header className="ov-hero" aria-label="Overview figures">
        <div className="ov-stat">
          <span className="ov-stat-label">Live</span>
          <span className="ov-stat-value" data-testid="overview-live">{snapshot?.hero.liveSessions ?? '—'}</span>
        </div>
        <div className="ov-stat">
          <span className="ov-stat-label">Offen</span>
          <span className="ov-stat-value" data-testid="overview-open">{snapshot?.hero.openRuns ?? '—'}</span>
        </div>
        <div className="ov-stat">
          <span className="ov-stat-label">Tokens</span>
          <span className="ov-stat-value" data-testid="overview-tokens">
            {snapshot ? (snapshot.hero.tokens === null ? '—' : formatTokenCount(snapshot.hero.tokens)) : '—'}
          </span>
          {snapshot ? (
            <span className="ov-stat-note">
              {usageCaption(snapshot.hero.usage)}
              {costCaption(snapshot.hero.usage) ? ` · ${costCaption(snapshot.hero.usage)}` : ''}
            </span>
          ) : null}
        </div>
      </header>

      {snapshot ? (
      <>
      <section className="ov-section" aria-labelledby="ov-agents-h">
        <h2 id="ov-agents-h">Agents</h2>
        {snapshot.agents.length === 0 ? (
          <p className="ov-empty">Noch keine Agenten</p>
        ) : (
          <ul className="ov-agents">
            {snapshot.agents.map((row) => (
              <li key={row.id}>
                <button
                  type="button"
                  className="ov-agent"
                  data-testid="overview-agent"
                  onClick={() => openAgent(row.id)}
                  onKeyDown={(event) => onRowKey(event, () => openAgent(row.id))}
                >
                  <Avatar name={row.name} photo={row.photo} shape="round" size={28} />
                  <span className="ov-agent-id">
                    <strong>{row.name}</strong>
                    <span className="ov-muted">{row.runtimeLabel}</span>
                  </span>
                  {row.liveSessions > 0 ? (
                    <span className="ov-live" title={`${row.liveSessions} live session(s)`}>
                      <span className="ov-dot" aria-hidden="true" />
                      {row.liveSessions}
                    </span>
                  ) : null}
                  <span className="ov-muted ov-agent-repo">{row.defaultRepositoryName ?? 'Eigener Workspace'}</span>
                  <span className="ov-muted ov-agent-run">
                    {row.lastActivityAt
                      ? [formatRelativeTime(now, row.lastActivityAt), row.lastRunName]
                          .filter(Boolean)
                          .join(' · ')
                      : 'keine Aktivität'}
                  </span>
                </button>
                <div className="ov-agent-actions"><button disabled={opening} aria-label={`Terminal öffnen: ${row.name}`} onClick={() => void openHomeTerminal(row.id)}>Terminal öffnen / fortsetzen</button>
                  {row.hasDashboard && <button aria-label={`Web-Dashboard für ${row.name}`} onClick={() => {
                    void window.ade.invoke('agent:openDashboard', { agentId: row.id }).catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)));
                  }}>Web-Dashboard ↗</button>}</div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="ov-section" aria-labelledby="ov-projects-h">
        <h2 id="ov-projects-h">Projects</h2>
        {snapshot.projects.length === 0 ? (
          <p className="ov-empty">Keine Katalog-Repos — portable Homes zählen hier nicht</p>
        ) : (
          <ul className="ov-projects">
            {snapshot.projects.map((card) => (
              <li key={card.id}>
                <button
                  type="button"
                  className="ov-project"
                  data-testid="overview-project"
                  onClick={() => openProject(card.id)}
                  onKeyDown={(event) => onRowKey(event, () => openProject(card.id))}
                >
                  <span className="ov-project-head">
                    <strong>{card.name}</strong>
                    <span className="ov-pill">{card.backendLabel}</span>
                  </span>
                  <span className="ov-muted">
                    {card.boundAgentCount === 0
                      ? 'Noch kein Agent-Workspace'
                      : card.boundAgentCount <= 3
                        ? `${card.boundAgentCount} Workspace${card.boundAgentCount === 1 ? '' : 's'} · ${card.boundAgentNames.join(', ')}`
                        : `${card.boundAgentCount} Agent-Workspaces`}
                  </span>
                  <span className="ov-muted">
                    {card.lastActivityAt
                      ? formatRelativeTime(now, card.lastActivityAt)
                      : 'keine Aktivität'}
                    {card.lastRunName
                      ? ` · ${card.lastRunName} (${statusLabel(card.lastRunStatus!, card.lastRunPhase!)})`
                      : ' · kein Run'}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="ov-section" aria-labelledby="ov-work-h">
        <div className="ov-work-heading"><h2 id="ov-work-h">Work</h2><label>Anzeige <select aria-label="Overview-Arbeit filtern" value={workFilter} onChange={(event) => setWorkFilter(event.target.value as typeof workFilter)}>
          <option value="current">Aktuelle Arbeit</option><option value="history">Historie</option><option value="all">Alles</option></select></label></div>
        {workFilter !== 'current' && <p className="ov-muted">Frühere Runs und Sitzungen behalten ihre damaligen Agenten. „Aus ADE entfernt“ bezeichnet frühere Zuordnungen.</p>}
        {visibleWork.length === 0 ? (
          <p className="ov-empty">{workFilter === 'current' ? 'Keine offenen Runs. Frühere Arbeit findest du unter Historie; einen Agenten oben öffnen, um weiterzuarbeiten.' : 'Noch keine Runs oder Sessions.'}</p>
        ) : (
          <ul className="ov-work">
            {visibleWork.map((row) => {
              const { tone, label } = workStatus(row);
              const names = row.participantNames.length > 3
                ? `${row.participantNames.slice(0, 3).join(', ')} +${row.participantNames.length - 3}`
                : row.participantNames.join(', ');
              return (
                <li key={`${row.kind}:${row.id}`}>
                  <button
                    type="button"
                    className="ov-run"
                    disabled={row.kind === 'session' && row.agentAvailable === false}
                    data-testid={row.kind === 'run' ? 'overview-run' : 'overview-session'}
                    onClick={() => openWork(row)}
                    onKeyDown={(event) => onRowKey(event, () => openWork(row))}
                  >
                    <span className="ov-muted ov-run-when">{formatRelativeTime(now, row.updatedAt)}</span>
                    <strong className="ov-run-name">{row.name}{row.detached && <small> · Aus ADE entfernt</small>}</strong>
                    <span className="ov-muted">{row.repositoryName ?? 'plain'}</span>
                    <span className={`ov-status ov-status-${tone}`}>{label}</span>
                    <span className="ov-muted ov-run-people">{names}</span>
                    <span className="ov-muted ov-run-usage">
                      {row.kind === 'run' ? workUsage(row.usage) : ''}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
      </>
      ) : null}
    </div>
  );
}
