/** Graph mode: a canvas over persisted runs, participants and task events. */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { JSX } from 'react';
import type { Agent, Category, RunCreateInput } from '../../shared/types';
import { useAppData } from '../stores/appdata';
import { useRuns } from '../stores/runs';
import { useSessions } from '../stores/sessions';
import { useGraphStore, type GraphSelection, type Pos } from './graphStore';
import {
  buildGraph,
  statusFor,
  type GraphMember,
  type NodeStatus,
  type TeamModel,
} from './graphModel';
import { runtimeVisual } from './runtimeGlyphs';
import {
  cancelAllTasks,
  cancelTeamTasks,
  dispatchAgent,
  dispatchAll,
  dispatchTeam,
  openTerminal,
} from './graphActions';
import './graph.css';

const CARD_W = 150;
const GAP = 14;
const TEAM_PAD = 16;
const TEAM_Y = 340;
const TEAM_GAP = 70;

function teamWidth(memberCount: number): number {
  return TEAM_PAD * 2 + memberCount * CARD_W + Math.max(0, memberCount - 1) * GAP;
}

const I = {
  plus: <path d="M12 5v14M5 12h14" />,
  arrow: <path d="M4 12h13M13 6l6 6-6 6" />,
  pause: <><circle cx="12" cy="12" r="8" /><path d="M9 12h6" /></>,
  play: <path d="M8 6l10 6-10 6z" />,
  stop: <rect x="7" y="7" width="10" height="10" rx="1" />,
  term: <path d="M5 8l4 4-4 4M12 16h6" />,
  close: <path d="M7 7l10 10M17 7L7 17" />,
};

function Ico({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  );
}

interface EdgeSpec {
  d: string;
  active: boolean;
  cable: boolean;
}

type ComposerTarget =
  | { kind: 'all'; workerCount: number }
  | { kind: 'team'; id: string; name: string; workerCount: number }
  | { kind: 'participant'; id: string; name: string };

function activeWorkerCount(model: ReturnType<typeof buildGraph>): number {
  return model.teams.filter((team) => !team.idle)
    .reduce((count, team) => count + team.workers.length, 0);
}

function statusText(status: NodeStatus): string {
  switch (status) {
    case 'running': return 'Terminal aktiv';
    case 'working': return 'arbeitet';
    case 'done': return 'erledigt';
    case 'failed': return 'fehlgeschlagen';
    default: return 'idle';
  }
}

function runStatusText(status: string): string {
  switch (status) {
    case 'draft': return 'Entwurf';
    case 'running': return 'Läuft';
    case 'completed': return 'Abgeschlossen';
    case 'failed': return 'Fehlgeschlagen';
    case 'cancelled': return 'Abgebrochen';
    default: return status;
  }
}

function phaseText(phase: string): string {
  switch (phase) {
    case 'planning': return 'Planung';
    case 'working': return 'Worker';
    case 'approval': return 'Freigabe';
    case 'integrating': return 'Integration';
    case 'verifying': return 'Verifikation';
    case 'completed': return 'Fertig';
    case 'failed': return 'Fehler';
    case 'cancelled': return 'Abgebrochen';
    default: return 'Entwurf';
  }
}

export function GraphView(): JSX.Element {
  const categories = useAppData((state) => state.categories);
  const agents = useAppData((state) => state.agents);
  const runs = useRuns((state) => state.runs);
  const participants = useRuns((state) => state.participants);
  const tasks = useRuns((state) => state.tasks);
  const approvals = useRuns((state) => state.approvals);
  const usageByRun = useRuns((state) => state.usageByRun);
  const runsLoaded = useRuns((state) => state.loaded);
  const activeRunId = useRuns((state) => state.activeRunId);
  const setActiveRun = useRuns((state) => state.setActiveRun);
  const createRun = useRuns((state) => state.createRun);
  const startRun = useRuns((state) => state.startRun);
  const cancelRun = useRuns((state) => state.cancelRun);
  const resolveApproval = useRuns((state) => state.resolveApproval);
  const sessions = useSessions((state) => state.sessions);
  const orderByAgent = useSessions((state) => state.orderByAgent);
  const taskQueue = useSessions((state) => state.taskQueue);
  const busy = useGraphStore((state) => state.busy);
  const idleTeams = useGraphStore((state) => state.idleTeams);
  const positions = useGraphStore((state) => state.positions);
  const selection = useGraphStore((state) => state.selection);
  const setPosition = useGraphStore((state) => state.setPosition);
  const select = useGraphStore((state) => state.select);
  const setTeamIdle = useGraphStore((state) => state.setTeamIdle);

  const activeRun = runs.find((run) => run.id === activeRunId) ?? null;
  const activeUsage = activeRunId ? usageByRun[activeRunId] : undefined;
  const pendingApproval = approvals.find(
    (approval) => approval.runId === activeRunId && approval.status === 'pending' && activeRun?.status === 'running',
  );
  const runTasks = useMemo(
    () => tasks.filter((task) => task.runId === activeRunId),
    [tasks, activeRunId],
  );
  const sessionsSlice = useMemo(() => ({ sessions, orderByAgent }), [sessions, orderByAgent]);
  const model = useMemo(
    () => buildGraph(activeRunId, participants, agents, runTasks, sessionsSlice, busy, idleTeams),
    [activeRunId, participants, agents, runTasks, sessionsSlice, busy, idleTeams],
  );

  const [view, setView] = useState({ x: 60, y: 20, scale: 0.82 });
  const [edges, setEdges] = useState<EdgeSpec[]>([]);
  const [composer, setComposer] = useState<ComposerTarget | null>(null);
  const [showNewRun, setShowNewRun] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const toastTimer = useRef<number | undefined>(undefined);

  const flash = useCallback((message: string) => {
    setToast(message);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2_400);
  }, []);
  const openNewRun = useCallback(() => {
    select(null);
    setShowNewRun(true);
  }, [select]);

  useEffect(() => {
    select(null);
    setComposer(null);
  }, [activeRunId, select]);

  const positionKey = useCallback(
    (key: string) => `${activeRunId ?? 'none'}:${key}`,
    [activeRunId],
  );
  const autoPos = useMemo(() => {
    const teamPositions: Record<string, Pos> = {};
    let x = 120;
    let extentRight = x;
    for (const team of model.teams) {
      teamPositions[team.id] = { x, y: TEAM_Y };
      const width = teamWidth(1 + team.workers.length);
      extentRight = x + width;
      x += width + TEAM_GAP;
    }
    const orchestratorX = model.teams.length ? (120 + extentRight) / 2 - 112 : 220;
    return { orchestrator: { x: orchestratorX, y: 90 } as Pos, teams: teamPositions };
  }, [model]);

  const posFor = useCallback((key: string): Pos => {
    const saved = positions[positionKey(key)];
    if (saved) return saved;
    if (key === 'orchestrator') return autoPos.orchestrator;
    return autoPos.teams[key] ?? { x: 120, y: TEAM_Y };
  }, [positions, positionKey, autoPos]);

  const modelSig = useMemo(() => (
    `${activeRunId ?? 'none'}:${model.orchestrator?.id ?? 'none'}|${model.teams
      .map((team) => `${team.id}:${team.lead?.id ?? '-'}:${team.workers.map((worker) => worker.id).join(',')}:${team.idle}`)
      .join('|')}`
  ), [activeRunId, model]);
  const positionSig = useMemo(() => JSON.stringify(positions), [positions]);

  const computeEdges = useCallback(() => {
    const world = worldRef.current;
    if (!world) return;
    const worldRect = world.getBoundingClientRect();
    const scale = view.scale || 1;
    const anchor = (id: string, side: 'top' | 'bot'): Pos | null => {
      const element = world.querySelector(`[data-anchor="${id}:${side}"]`);
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return {
        x: (rect.left + rect.width / 2 - worldRect.left) / scale,
        y: (rect.top + rect.height / 2 - worldRect.top) / scale,
      };
    };
    const path = (from: Pos, to: Pos): string => {
      const offset = Math.max(46, (to.y - from.y) / 2);
      return `M${from.x},${from.y} C${from.x},${from.y + offset} ${to.x},${to.y - offset} ${to.x},${to.y}`;
    };
    const next: EdgeSpec[] = [];
    const orchestratorBottom = model.orchestrator ? anchor(model.orchestrator.id, 'bot') : null;
    for (const team of model.teams) {
      if (!team.lead) continue;
      const leadTop = anchor(team.lead.id, 'top');
      if (orchestratorBottom && leadTop) {
        next.push({ d: path(orchestratorBottom, leadTop), active: !team.idle, cable: true });
      }
      const leadBottom = anchor(team.lead.id, 'bot');
      if (!leadBottom) continue;
      for (const worker of team.workers) {
        const workerTop = anchor(worker.id, 'top');
        if (workerTop) next.push({ d: path(leadBottom, workerTop), active: !team.idle, cable: false });
      }
    }
    setEdges(next);
  }, [model, view.scale]);

  useLayoutEffect(() => {
    const frame = requestAnimationFrame(computeEdges);
    return () => cancelAnimationFrame(frame);
  }, [modelSig, positionSig, computeEdges]);

  useEffect(() => {
    window.addEventListener('resize', computeEdges);
    return () => window.removeEventListener('resize', computeEdges);
  }, [computeEdges]);

  const panRef = useRef<{ startX: number; startY: number; x: number; y: number } | null>(null);
  const onCanvasPointerDown = (event: React.PointerEvent): void => {
    const target = event.target as HTMLElement;
    if (target.closest('.gcard') || target.closest('.gteam-bar')) return;
    select(null);
    panRef.current = { startX: event.clientX, startY: event.clientY, x: view.x, y: view.y };
    canvasRef.current?.classList.add('panning');
    const move = (nextEvent: PointerEvent): void => {
      const pan = panRef.current;
      if (!pan) return;
      setView((current) => ({
        ...current,
        x: pan.x + nextEvent.clientX - pan.startX,
        y: pan.y + nextEvent.clientY - pan.startY,
      }));
    };
    const up = (): void => {
      panRef.current = null;
      canvasRef.current?.classList.remove('panning');
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const onWheel = (event: React.WheelEvent): void => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    setView((current) => {
      const scale = Math.min(1.6, Math.max(0.4, current.scale * (event.deltaY < 0 ? 1.1 : 0.9)));
      const mouseX = event.clientX - rect.left;
      const mouseY = event.clientY - rect.top;
      const factor = scale / current.scale;
      return {
        scale,
        x: mouseX - (mouseX - current.x) * factor,
        y: mouseY - (mouseY - current.y) * factor,
      };
    });
  };

  const zoomBy = (factor: number): void => setView((current) => {
    const scale = Math.min(1.6, Math.max(0.4, current.scale * factor));
    const rect = canvasRef.current?.getBoundingClientRect();
    const middleX = (rect?.width ?? 800) / 2;
    const middleY = (rect?.height ?? 600) / 2;
    const ratio = scale / current.scale;
    return {
      scale,
      x: middleX - (middleX - current.x) * ratio,
      y: middleY - (middleY - current.y) * ratio,
    };
  });

  const fitView = useCallback(() => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    let left = model.orchestrator ? posFor('orchestrator').x : 120;
    let right = left + (model.orchestrator ? 224 : 0);
    for (const team of model.teams) {
      const position = posFor(team.id);
      left = Math.min(left, position.x);
      right = Math.max(right, position.x + teamWidth(1 + team.workers.length));
    }
    const top = model.orchestrator ? 90 : TEAM_Y;
    const bottom = TEAM_Y + 250;
    const padding = 80;
    const width = Math.max(224, right - left);
    const scale = Math.min(1.15, Math.max(0.45, Math.min(
      (rect.width - padding * 2) / width,
      (rect.height - padding * 2 - 60) / Math.max(250, bottom - top),
    )));
    setView({
      scale,
      x: (rect.width - width * scale) / 2 - left * scale,
      y: padding - top * scale,
    });
  }, [model, posFor]);

  useEffect(() => {
    const frame = requestAnimationFrame(fitView);
    return () => cancelAnimationFrame(frame);
  }, [activeRunId, model.teams.length, selection, fitView]);

  const startDrag = (key: string, event: React.PointerEvent): void => {
    event.stopPropagation();
    const start = posFor(key);
    const startX = event.clientX;
    const startY = event.clientY;
    let moved = false;
    const move = (nextEvent: PointerEvent): void => {
      const deltaX = (nextEvent.clientX - startX) / view.scale;
      const deltaY = (nextEvent.clientY - startY) / view.scale;
      if (Math.abs(deltaX) + Math.abs(deltaY) > 3) moved = true;
      setPosition(positionKey(key), { x: start.x + deltaX, y: start.y + deltaY });
    };
    const up = (): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (moved) return;
      if (key === 'orchestrator' && model.orchestrator) {
        select({ kind: 'orchestrator', id: model.orchestrator.id });
      } else {
        const team = model.teams.find((candidate) => candidate.id === key);
        if (team) select({ kind: 'team', id: team.id });
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const isSelected = (candidate: GraphSelection): boolean => Boolean(
    selection && selection.kind === candidate.kind && selection.id === candidate.id,
  );
  const nodeStatus = (member: GraphMember, idle: boolean): NodeStatus => statusFor(
    member.id,
    member.agentId,
    { idle, busy, sessions: sessionsSlice, tasks: runTasks },
  );

  const renderCard = (
    member: GraphMember,
    role: 'lead' | 'worker',
    teamId: string,
    idle: boolean,
  ): JSX.Element => {
    const runtime = runtimeVisual(member.runtime);
    const status = nodeStatus(member, idle);
    const selected = isSelected({ kind: role, id: member.id });
    return (
      <div
        key={member.id}
        className={`gcard gcard-static${selected ? ' sel' : ''}${member.available ? '' : ' unavailable'}`}
        data-status={status}
        style={{ ['--rt' as string]: runtime.color }}
        onClick={(event) => {
          event.stopPropagation();
          select({ kind: role, id: member.id, teamId });
        }}
        onDoubleClick={(event) => {
          event.stopPropagation();
          if (member.available) void openTerminal(member.agentId);
        }}
      >
        <div className="gcard-bar nograb">
          <div className="glights"><i className="r" /><i className="y" /><i className="g" /></div>
          <div className="gcard-title">~ {role}</div>
        </div>
        <div className="gcard-body">
          <div className="gcard-role">~ {role}</div>
          <div className="gglyph"><runtime.Glyph /></div>
          <div className="gcard-name">{member.name}</div>
          <div className="gchip" data-s={member.available ? status : 'failed'}>
            {member.available ? statusText(status) : 'nicht im Katalog'}
          </div>
        </div>
        <i className="ganchor top" data-anchor={`${member.id}:top`} />
        <i className="ganchor bot" data-anchor={`${member.id}:bot`} />
      </div>
    );
  };

  const orchestrator = model.orchestrator;
  const orchestratorRuntime = runtimeVisual(orchestrator?.runtime ?? 'claude');
  const orchestratorPosition = posFor('orchestrator');
  const orchestratorSelected = orchestrator
    ? isSelected({ kind: 'orchestrator', id: orchestrator.id })
    : false;
  const activeTaskCount = runTasks.filter(
    (task) => task.status === 'queued' || task.status === 'running',
  ).length;

  return (
    <div className={`graph${selection ? ' graph-inspecting' : ''}`}>
      <div className="grunbar">
        <select
          aria-label="Aktiver Run"
          value={activeRunId ?? ''}
          onChange={(event) => setActiveRun(event.target.value || null)}
          disabled={runs.length === 0}
        >
          {runs.length === 0 && <option value="">Kein Run</option>}
          {[...runs].sort((a, b) => b.updatedAt - a.updatedAt).map((run) => (
            <option key={run.id} value={run.id}>{run.name}</option>
          ))}
        </select>
        {activeRun && (
          <>
            <span className="grun-status" data-s={activeRun.status}>{runStatusText(activeRun.status)}</span>
            {activeRun.mode === 'managed' && (
              <span className="grun-phase">{phaseText(activeRun.phase)}</span>
            )}
            <span className="grun-goal" title={activeRun.goal || activeRun.name}>
              {activeRun.goal || 'Kein Run-Ziel hinterlegt'}
            </span>
            <span className="grun-counts">
              {runTasks.length} Tasks · {activeTaskCount} aktiv · Queue {taskQueue.active}/{taskQueue.queued}
              {activeUsage && ` · Tokens ${activeUsage.inputTokens + activeUsage.outputTokens}`}
              {activeRun.mode === 'managed' && ` · Parallel ≤${activeRun.budget.maxConcurrentTasks}`}
              {activeUsage && ` · Freigaben ${activeUsage.approvals}/${activeRun.budget.maxApprovals}`}
              {activeRun.budget.maxCostUsd !== null && activeUsage &&
                ` · $${activeUsage.costUsd.toFixed(2)}/$${activeRun.budget.maxCostUsd.toFixed(2)}`}
            </span>
          </>
        )}
        <button className="grun-new" onClick={openNewRun}>
          <Ico>{I.plus}</Ico>Neuer Run
        </button>
      </div>

      {pendingApproval && (
        <div className="gapproval" role="status">
          <div>
            <b>Integration wartet auf Freigabe</b>
            <span title={pendingApproval.reason}>{pendingApproval.reason}</span>
          </div>
          <button
            className="gact"
            onClick={() => void resolveApproval(pendingApproval.id, 'reject')
              .then(() => flash('Integration abgelehnt'))
              .catch((error) => flash(error instanceof Error ? error.message : String(error)))}
          >
            Ablehnen
          </button>
          <button
            className="gact primary"
            onClick={() => void resolveApproval(pendingApproval.id, 'approve')
              .then(() => flash('Integration freigegeben'))
              .catch((error) => flash(error instanceof Error ? error.message : String(error)))}
          >
            Freigeben &amp; integrieren
          </button>
        </div>
      )}

      <div ref={canvasRef} className="graph-canvas" onPointerDown={onCanvasPointerDown} onWheel={onWheel}>
        <div
          ref={worldRef}
          className="graph-world"
          style={{ transform: `translate(${view.x}px,${view.y}px) scale(${view.scale})` }}
        >
          <svg className="graph-edges">
            {edges.map((edge, index) => (
              <g key={`${edge.d}:${index}`}>
                <path
                  d={edge.d}
                  fill="none"
                  stroke={edge.cable ? 'var(--cable)' : 'var(--accent)'}
                  strokeWidth={edge.cable ? 3.2 : 2}
                  strokeLinecap="round"
                  opacity={edge.active ? 0.9 : 0.32}
                />
                {edge.active && (
                  <path
                    d={edge.d}
                    fill="none"
                    stroke={edge.cable ? 'var(--cable)' : 'var(--accent)'}
                    strokeWidth={edge.cable ? 1.8 : 1.2}
                    strokeLinecap="round"
                    strokeDasharray="2 16"
                    opacity={0.5}
                  >
                    <animate attributeName="stroke-dashoffset" from="0" to="-36" dur="1.4s" repeatCount="indefinite" />
                  </path>
                )}
              </g>
            ))}
          </svg>

          {orchestrator && (
            <div
              className={`gcard orch${orchestratorSelected ? ' sel' : ''}${orchestrator.available ? '' : ' unavailable'}`}
              data-status={nodeStatus(orchestrator, false)}
              style={{
                left: orchestratorPosition.x,
                top: orchestratorPosition.y,
                ['--rt' as string]: orchestratorRuntime.color,
              }}
              onClick={(event) => {
                event.stopPropagation();
                select({ kind: 'orchestrator', id: orchestrator.id });
              }}
              onDoubleClick={(event) => {
                event.stopPropagation();
                if (orchestrator.available) void openTerminal(orchestrator.agentId);
              }}
            >
              <div className="gcard-bar" onPointerDown={(event) => startDrag('orchestrator', event)}>
                <div className="glights"><i className="r" /><i className="y" /><i className="g" /></div>
                <div className="gcard-title">ade · orchestrator</div>
              </div>
              <div className="gcard-body">
                <div className="gglyph"><orchestratorRuntime.Glyph /></div>
                <div className="gcard-name">{orchestrator.name}</div>
                <div className="gchip" data-s={orchestrator.available ? nodeStatus(orchestrator, false) : 'failed'}>
                  {orchestrator.available ? statusText(nodeStatus(orchestrator, false)) : 'nicht im Katalog'}
                </div>
              </div>
              <i className="ganchor top" data-anchor={`${orchestrator.id}:top`} />
              <i className="ganchor bot" data-anchor={`${orchestrator.id}:bot`} />
            </div>
          )}

          {model.teams.map((team) => {
            const position = posFor(team.id);
            const selected = isSelected({ kind: 'team', id: team.id });
            return (
              <div
                key={team.id}
                className={`gteam${team.idle ? ' idle' : ''}${selected ? ' sel' : ''}`}
                style={{ left: position.x, top: position.y }}
              >
                <div className="gteam-bar" onPointerDown={(event) => startDrag(team.id, event)}>
                  <div className="glights"><i className="r" /><i className="y" /><i className="g" /></div>
                  <div className="gteam-tt">team · <b>{team.name}</b></div>
                  <div className="gteam-grow" />
                  <div className="gteam-actions" onPointerDown={(event) => event.stopPropagation()}>
                    <button
                      className="gtbtn"
                      title={team.idle ? 'Team reaktivieren' : 'Team pausieren'}
                      onClick={() => setTeamIdle(team.id, !team.idle)}
                    >
                      <Ico>{team.idle ? I.play : I.pause}</Ico>
                    </button>
                    <button
                      className="gtbtn"
                      title="Laufende Team-Tasks stoppen"
                      onClick={() => void cancelTeamTasks(team.id).then(() => flash('Team-Tasks gestoppt'))}
                    >
                      <Ico>{I.stop}</Ico>
                    </button>
                  </div>
                </div>
                <div className="gteam-members">
                  {team.lead && renderCard(team.lead, 'lead', team.id, team.idle)}
                  {team.workers.map((worker) => renderCard(worker, 'worker', team.id, team.idle))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {runsLoaded && !activeRun && (
        <div className="gempty">
          <h2>Noch kein Run</h2>
          <p>Stelle für ein konkretes Ziel ein Team aus bestehenden Agenten zusammen.</p>
          <button className="gact primary" onClick={openNewRun}>
            <Ico>{I.plus}</Ico>Ersten Run erstellen
          </button>
        </div>
      )}

      <Inspector
        model={model}
        selection={selection}
        runTaskCount={runTasks.length}
        canDirectDispatch={activeRun?.mode === 'manual'}
        nodeStatus={nodeStatus}
        onClose={() => select(null)}
        onCompose={setComposer}
        setTeamIdle={setTeamIdle}
        flash={flash}
      />

      <div className="gzoom">
        <button title="Vergrößern" onClick={() => zoomBy(1.15)}>+</button>
        <button title="Verkleinern" onClick={() => zoomBy(0.87)}>-</button>
        <button title="Ansicht einpassen" onClick={fitView}>□</button>
      </div>

      {activeRun && (
        <div className="gdock">
          <button className="gdbtn accent" onClick={openNewRun}>
            <Ico>{I.plus}</Ico>Neuer Run
          </button>
          <div className="sep" />
          {activeRun.mode === 'manual' && activeRun.status === 'draft' && (
            <button
              className="gdbtn accent"
              disabled={!activeRun.goal.trim() || !model.orchestrator || model.teams.length === 0}
              title="Plant getrennte Worker-Aufträge und integriert erst nach Freigabe"
              onClick={() => void startRun(activeRun.id)
                .then(() => flash('Orchestrierung gestartet'))
                .catch((error) => flash(error instanceof Error ? error.message : String(error)))}
            >
              <Ico>{I.play}</Ico>Orchestrierung starten
            </button>
          )}
          {activeRun.mode === 'manual' && (
            <>
              <button
                className="gdbtn"
                disabled={model.teams.length === 0}
                onClick={() => setComposer({ kind: 'all', workerCount: activeWorkerCount(model) })}
              >
                <Ico>{I.arrow}</Ico>Direkt an Teams
              </button>
              <button className="gdbtn" onClick={() => model.teams.forEach((team) => setTeamIdle(team.id, true))}>
                <Ico>{I.pause}</Ico>Alle pausieren
              </button>
              <button className="gdbtn" onClick={() => model.teams.forEach((team) => setTeamIdle(team.id, false))}>
                <Ico>{I.play}</Ico>Alle aktivieren
              </button>
            </>
          )}
          {activeRun.mode === 'managed' && activeRun.status === 'running' && (
            <button
              className="gdbtn danger"
              onClick={() => void cancelRun(activeRun.id)
                .then(() => flash('Orchestrierung wird gestoppt'))
                .catch((error) => flash(error instanceof Error ? error.message : String(error)))}
            >
              <Ico>{I.stop}</Ico>Run abbrechen
            </button>
          )}
          {activeRun.mode === 'manual' && activeTaskCount > 0 && (
            <button className="gdbtn danger" onClick={() => void cancelAllTasks().then(() => flash('Run-Tasks gestoppt'))}>
              <Ico>{I.stop}</Ico>Tasks stoppen
            </button>
          )}
        </div>
      )}

      {toast && <div className="gtoast">{toast}</div>}

      {composer && (
        <Composer
          target={composer}
          onCancel={() => setComposer(null)}
          onSend={async (text, options) => {
            const target = composer;
            setComposer(null);
            if (target.kind === 'all') {
              const result = await dispatchAll(text, options);
              flash(result.failed
                ? `${result.started} gestartet, ${result.failed} fehlgeschlagen`
                : `${result.started} Task-Sessions gestartet`);
            } else if (target.kind === 'team') {
              const result = await dispatchTeam(target.id, text, options);
              flash(result.failed
                ? `${result.started} gestartet, ${result.failed} fehlgeschlagen`
                : `Task an ${target.name} verteilt`);
            } else {
              const result = await dispatchAgent(target.id, text);
              flash(result.failed ? `Task an ${target.name} fehlgeschlagen` : `Task an ${target.name} gesendet`);
            }
          }}
        />
      )}

      {showNewRun && (
        <NewRunModal
          categories={categories}
          agents={agents}
          suggestedName={`Run ${runs.length + 1}`}
          onCancel={() => setShowNewRun(false)}
          onCreate={async (input) => {
            const run = await createRun(input);
            setShowNewRun(false);
            flash(`${run.name} erstellt`);
          }}
        />
      )}
    </div>
  );
}

interface InspectorProps {
  model: ReturnType<typeof buildGraph>;
  selection: GraphSelection | null;
  runTaskCount: number;
  canDirectDispatch: boolean;
  nodeStatus: (member: GraphMember, idle: boolean) => NodeStatus;
  onClose: () => void;
  onCompose: (target: ComposerTarget) => void;
  setTeamIdle: (teamId: string, idle: boolean) => void;
  flash: (message: string) => void;
}

function Inspector(props: InspectorProps): JSX.Element | null {
  const { model, selection } = props;
  if (!selection) return null;
  const teamOf = (id: string): TeamModel | undefined => model.teams.find((team) => team.id === id);

  if (selection.kind === 'orchestrator') {
    const orchestrator = model.orchestrator;
    if (!orchestrator) return null;
    const runtime = runtimeVisual(orchestrator.runtime);
    return (
      <aside className="ginspector">
        <Head glyph={<runtime.Glyph />} color={runtime.color} title={orchestrator.name} sub="Orchestrator" onClose={props.onClose} />
        <div className="ginsp-body">
          <KV k="Runtime" v={runtime.label} />
          <KV k="Status" v={statusText(props.nodeStatus(orchestrator, false))} />
          <KV k="Teams" v={String(model.teams.length)} />
          <KV k="Run-Tasks" v={String(props.runTaskCount)} />
        </div>
        <div className="ginsp-actions">
          <button
            className="gact primary"
            disabled={!orchestrator.available || !props.canDirectDispatch}
            onClick={() => props.onCompose({ kind: 'participant', id: orchestrator.id, name: orchestrator.name })}
          >
            <Ico>{I.arrow}</Ico>Task zuweisen
          </button>
          <button
            className="gact"
            disabled={model.teams.length === 0 || !props.canDirectDispatch}
            onClick={() => props.onCompose({ kind: 'all', workerCount: activeWorkerCount(model) })}
          >
            <Ico>{I.arrow}</Ico>Task an alle Teams
          </button>
          <button className="gact" disabled={!orchestrator.available} onClick={() => void openTerminal(orchestrator.agentId)}>
            <Ico>{I.term}</Ico>Terminal öffnen
          </button>
        </div>
      </aside>
    );
  }

  if (selection.kind === 'team' || selection.kind === 'lead') {
    const teamId = selection.kind === 'team' ? selection.id : selection.teamId!;
    const team = teamOf(teamId);
    if (!team) return null;
    const runtime = runtimeVisual(team.lead?.runtime ?? 'claude');
    return (
      <aside className="ginspector">
        <Head
          glyph={<runtime.Glyph />}
          color={runtime.color}
          title={`team · ${team.name}`}
          sub={`${team.workers.length + 1} Teilnehmer`}
          onClose={props.onClose}
        />
        <div className="ginsp-body">
          <KV k="Status" v={statusText(team.status)} />
          <KV k="Teamlead" v={team.lead?.name ?? 'Nicht gesetzt'} />
          <KV k="Worker" v={String(team.workers.length)} />
        </div>
        <div className="ginsp-actions">
          <button
            className="gact primary"
            disabled={!team.lead?.available || !props.canDirectDispatch}
            onClick={() => props.onCompose({
              kind: 'team',
              id: team.id,
              name: team.name,
              workerCount: team.workers.length,
            })}
          >
            <Ico>{I.arrow}</Ico>Task ans Team
          </button>
          <button
            className="gact"
            disabled={!team.lead?.available}
            onClick={() => team.lead && void openTerminal(team.lead.agentId)}
          >
            <Ico>{I.term}</Ico>Lead-Terminal öffnen
          </button>
          <button className="gact" onClick={() => props.setTeamIdle(team.id, !team.idle)}>
            <Ico>{team.idle ? I.play : I.pause}</Ico>{team.idle ? 'Team reaktivieren' : 'Team pausieren'}
          </button>
          <button className="gact" onClick={() => void cancelTeamTasks(team.id).then(() => props.flash('Team-Tasks gestoppt'))}>
            <Ico>{I.stop}</Ico>Team-Tasks stoppen
          </button>
        </div>
      </aside>
    );
  }

  const team = teamOf(selection.teamId!);
  const worker = team?.workers.find((candidate) => candidate.id === selection.id);
  if (!team || !worker) return null;
  const runtime = runtimeVisual(worker.runtime);
  return (
    <aside className="ginspector">
      <Head glyph={<runtime.Glyph />} color={runtime.color} title={worker.name} sub={`Worker · ${team.name}`} onClose={props.onClose} />
      <div className="ginsp-body">
        <KV k="Runtime" v={runtime.label} />
        <KV k="Status" v={statusText(props.nodeStatus(worker, team.idle))} />
        <KV k="Katalog" v={worker.available ? 'Verfügbar' : 'Agent entfernt'} />
      </div>
      <div className="ginsp-actions">
        <button
          className="gact primary"
          disabled={!worker.available || !props.canDirectDispatch}
          onClick={() => props.onCompose({ kind: 'participant', id: worker.id, name: worker.name })}
        >
          <Ico>{I.arrow}</Ico>Task zuweisen
        </button>
        <button className="gact" disabled={!worker.available} onClick={() => void openTerminal(worker.agentId)}>
          <Ico>{I.term}</Ico>Terminal öffnen
        </button>
      </div>
    </aside>
  );
}

function Head(props: {
  glyph: React.ReactNode;
  color: string;
  title: string;
  sub: string;
  onClose: () => void;
}): JSX.Element {
  return (
    <div className="ginsp-head">
      <div className="gglyph" style={{ ['--rt' as string]: props.color }}>{props.glyph}</div>
      <div className="t"><h3>{props.title}</h3><p>{props.sub}</p></div>
      <button className="ginsp-close" title="Schließen" onClick={props.onClose}><Ico>{I.close}</Ico></button>
    </div>
  );
}

function KV({ k, v }: { k: string; v: string }): JSX.Element {
  return <div className="gkv"><span>{k}</span><span className="val">{v}</span></div>;
}

function Composer(props: {
  target: ComposerTarget;
  onCancel: () => void;
  onSend: (text: string, options: { toWorkers: boolean }) => void;
}): JSX.Element {
  const [text, setText] = useState('');
  const [toWorkers, setToWorkers] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, []);
  const target = props.target;
  const label = target.kind === 'all'
    ? 'alle Teams'
    : target.kind === 'team' ? `team · ${target.name}` : target.name;
  const canDistribute = target.kind !== 'participant';
  const workerCount = target.kind === 'participant' ? 0 : target.workerCount;
  const distribute = canDistribute && toWorkers && workerCount > 0;
  const submit = (): void => {
    if (text.trim()) props.onSend(text, { toWorkers: distribute });
  };
  return (
    <div className="gcomposer-back" onPointerDown={props.onCancel}>
      <div className="gcomposer" onPointerDown={(event) => event.stopPropagation()}>
        <h3>Task an <b>{label}</b></h3>
        <textarea
          ref={inputRef}
          value={text}
          maxLength={8_000}
          placeholder="Aufgabe beschreiben"
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
            if (event.key === 'Escape') props.onCancel();
          }}
        />
        {canDistribute && (
          <label className="gcomposer-dist">
            <input
              type="checkbox"
              checked={distribute}
              disabled={workerCount === 0}
              onChange={(event) => setToWorkers(event.target.checked)}
            />
            <span>Auch an {workerCount} Worker verteilen</span>
          </label>
        )}
        <div className="gcomposer-meta">{text.length} / 8000</div>
        <div className="gcomposer-foot">
          <button className="gact" onClick={props.onCancel}>Abbrechen</button>
          <button className="gact primary" disabled={!text.trim()} onClick={submit}>Senden</button>
        </div>
      </div>
    </div>
  );
}

function NewRunModal(props: {
  categories: Category[];
  agents: Record<string, Agent>;
  suggestedName: string;
  onCancel: () => void;
  onCreate: (input: RunCreateInput) => Promise<void>;
}): JSX.Element {
  const [name, setName] = useState(props.suggestedName);
  const [goal, setGoal] = useState('');
  const [orchestratorId, setOrchestratorId] = useState('');
  const [selected, setSelected] = useState<Record<string, true>>({});
  const [leaders, setLeaders] = useState<Record<string, string>>({});
  const [maxConcurrentTasks, setMaxConcurrentTasks] = useState(2);
  const [maxInputTokens, setMaxInputTokens] = useState('');
  const [maxOutputTokens, setMaxOutputTokens] = useState('');
  const [maxCostUsd, setMaxCostUsd] = useState('');
  const [maxApprovals, setMaxApprovals] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const allAgents = Object.values(props.agents);
  const availableCategories = props.categories.filter(
    (category) => category.agents.some((agentId) => props.agents[agentId]),
  );

  const toggleAgent = (category: Category, agentId: string): void => {
    if (agentId === orchestratorId) return;
    setSelected((current) => {
      const next = { ...current };
      if (next[agentId]) delete next[agentId];
      else next[agentId] = true;
      const selectedInTeam = category.agents.filter((id) => next[id] && props.agents[id]);
      setLeaders((currentLeaders) => {
        const nextLeaders = { ...currentLeaders };
        if (!selectedInTeam.length) delete nextLeaders[category.id];
        else if (!selectedInTeam.includes(nextLeaders[category.id] ?? '')) {
          nextLeaders[category.id] = selectedInTeam[0]!;
        }
        return nextLeaders;
      });
      return next;
    });
  };

  const chooseOrchestrator = (agentId: string): void => {
    setOrchestratorId(agentId);
    if (!agentId) return;
    setSelected((current) => {
      if (!current[agentId]) return current;
      const next = { ...current };
      delete next[agentId];
      const category = props.categories.find((candidate) => candidate.agents.includes(agentId));
      if (category) {
        const selectedInTeam = category.agents.filter((id) => next[id] && props.agents[id]);
        setLeaders((currentLeaders) => ({
          ...currentLeaders,
          [category.id]: selectedInTeam[0] ?? '',
        }));
      }
      return next;
    });
  };

  const participantCount = Object.keys(selected).length + (orchestratorId ? 1 : 0);
  const submit = async (): Promise<void> => {
    if (!name.trim() || participantCount === 0 || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const participants: RunCreateInput['participants'] = [];
      if (orchestratorId) participants.push({ agentId: orchestratorId, role: 'orchestrator' });
      for (const category of availableCategories) {
        const memberIds = category.agents.filter((agentId) => selected[agentId] && props.agents[agentId]);
        if (!memberIds.length) continue;
        const leadId = memberIds.includes(leaders[category.id] ?? '')
          ? leaders[category.id]!
          : memberIds[0]!;
        const teamId = globalThis.crypto?.randomUUID?.()
          ?? `team-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        for (const agentId of memberIds) {
          participants.push({
            agentId,
            role: agentId === leadId ? 'lead' : 'worker',
            teamId,
            teamName: category.name,
          });
        }
      }
      const optionalNumber = (value: string): number | null => value.trim() ? Number(value) : null;
      await props.onCreate({
        name: name.trim(),
        goal: goal.trim(),
        participants,
        budget: {
          maxConcurrentTasks,
          maxInputTokens: optionalNumber(maxInputTokens),
          maxOutputTokens: optionalNumber(maxOutputTokens),
          maxCostUsd: optionalNumber(maxCostUsd),
          maxApprovals,
        },
      });
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : String(createError));
      setSubmitting(false);
    }
  };

  return (
    <div className="gcomposer-back" onPointerDown={props.onCancel}>
      <form
        className="grun-modal"
        onPointerDown={(event) => event.stopPropagation()}
        onSubmit={(event) => { event.preventDefault(); void submit(); }}
      >
        <div className="grun-modal-head">
          <div><h2>Neuer Run</h2><p>Bestehende Agenten für ein konkretes Ziel zusammenstellen</p></div>
          <button type="button" className="ginsp-close" title="Schließen" onClick={props.onCancel}><Ico>{I.close}</Ico></button>
        </div>
        <div className="grun-modal-body">
          <label className="grun-field">
            <span>Name</span>
            <input value={name} maxLength={80} autoFocus onChange={(event) => setName(event.target.value)} />
          </label>
          <label className="grun-field">
            <span>Ziel</span>
            <textarea value={goal} maxLength={1_000} onChange={(event) => setGoal(event.target.value)} placeholder="Erwartetes Ergebnis dieses Runs" />
          </label>
          <label className="grun-field">
            <span>Orchestrator</span>
            <select value={orchestratorId} onChange={(event) => chooseOrchestrator(event.target.value)}>
              <option value="">Keiner</option>
              {allAgents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
            </select>
          </label>

          <div className="grun-budget-title">
            <span>Run-Budgets</span>
            <small>Leere Token-/Kostenfelder = kein Limit; Limits benötigen Adapter-Telemetrie.</small>
          </div>
          <div className="grun-budget">
            <label>
              <span>Parallel</span>
              <input
                type="number"
                min={1}
                max={4}
                value={maxConcurrentTasks}
                onChange={(event) => setMaxConcurrentTasks(Number(event.target.value))}
              />
            </label>
            <label>
              <span>Input-Tokens</span>
              <input
                type="number"
                min={1}
                placeholder="unbegrenzt"
                value={maxInputTokens}
                onChange={(event) => setMaxInputTokens(event.target.value)}
              />
            </label>
            <label>
              <span>Output-Tokens</span>
              <input
                type="number"
                min={1}
                placeholder="unbegrenzt"
                value={maxOutputTokens}
                onChange={(event) => setMaxOutputTokens(event.target.value)}
              />
            </label>
            <label>
              <span>Kosten USD</span>
              <input
                type="number"
                min={0.01}
                step={0.01}
                placeholder="unbegrenzt"
                value={maxCostUsd}
                onChange={(event) => setMaxCostUsd(event.target.value)}
              />
            </label>
            <label>
              <span>Freigaben</span>
              <input
                type="number"
                min={1}
                max={20}
                value={maxApprovals}
                onChange={(event) => setMaxApprovals(Number(event.target.value))}
              />
            </label>
          </div>

          <div className="grun-roster-title"><span>Teams</span><b>{participantCount} Teilnehmer</b></div>
          {availableCategories.length === 0 && (
            <div className="grun-no-agents">Lege im Terminal-Modus zuerst mindestens einen Agenten an.</div>
          )}
          <div className="grun-roster">
            {availableCategories.map((category) => {
              const members = category.agents.map((id) => props.agents[id]).filter(Boolean) as Agent[];
              return (
                <section key={category.id} className="grun-team">
                  <h3>{category.name}</h3>
                  {members.map((agent) => {
                    const checked = Boolean(selected[agent.id]);
                    const runtime = runtimeVisual(agent.runtime);
                    return (
                      <div key={agent.id} className="grun-agent">
                        <label>
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={agent.id === orchestratorId}
                            onChange={() => toggleAgent(category, agent.id)}
                          />
                          <span className="grun-agent-glyph" style={{ ['--rt' as string]: runtime.color }}><runtime.Glyph /></span>
                          <span className="grun-agent-name">{agent.name}</span>
                          <span className="grun-agent-runtime">{runtime.label}</span>
                        </label>
                        {checked && (
                          <label className="grun-lead">
                            <input
                              type="radio"
                              name={`lead-${category.id}`}
                              checked={leaders[category.id] === agent.id}
                              onChange={() => setLeaders((current) => ({ ...current, [category.id]: agent.id }))}
                            />
                            Lead
                          </label>
                        )}
                      </div>
                    );
                  })}
                </section>
              );
            })}
          </div>
          {error && <div className="grun-error">{error}</div>}
        </div>
        <div className="gcomposer-foot">
          <button type="button" className="gact" onClick={props.onCancel}>Abbrechen</button>
          <button type="submit" className="gact primary" disabled={!name.trim() || participantCount === 0 || submitting}>
            {submitting ? 'Wird erstellt' : 'Run erstellen'}
          </button>
        </div>
      </form>
    </div>
  );
}
