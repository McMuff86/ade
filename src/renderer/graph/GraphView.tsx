/**
 * Graph mode — the orchestration canvas.
 *
 * Renders the orchestrator + teams derived from real category/agent data
 * (graphModel.ts) as draggable terminal-window nodes joined by glowing cables.
 * All mutations go through graphActions.ts (real IPC). Layout is view state
 * (graphStore.ts). Node status reflects live pty sessions.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { JSX } from 'react';
import type { Agent, RuntimeId } from '../../shared/types';
import { useAppData } from '../stores/appdata';
import { useSessions } from '../stores/sessions';
import { useGraphStore, type GraphSelection, type Pos } from './graphStore';
import { buildGraph, statusFor, type NodeStatus, type TeamModel } from './graphModel';
import { runtimeVisual, TEAM_RUNTIME_ORDER } from './runtimeGlyphs';
import {
  addWorker,
  cancelAllTasks,
  cancelTeamTasks,
  dispatchAgent,
  dispatchAll,
  dispatchTeam,
  dissolveTeam,
  openTerminal,
  removeAgent,
  spawnTeam,
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

/* ------------------------------------------------------------------ icons */
const I = {
  plus: <path d="M12 5v14M5 12h14" />,
  arrow: <path d="M4 12h13M13 6l6 6-6 6" />,
  pause: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M9 12h6" />
    </>
  ),
  play: <path d="M8 6l10 6-10 6z" />,
  trash: <path d="M6 7h12M9 7V5h6v2M10 11v6M14 11v6M5 7l1 13h12l1-13" />,
  stop: <rect x="7" y="7" width="10" height="10" rx="1" />,
  term: <path d="M5 8l4 4-4 4M12 16h6" />,
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
  | { kind: 'agent'; id: string; name: string };

/** Workers across all non-idle teams — the fan-out size for a "distribute to workers" dispatch. */
function activeWorkerCount(model: ReturnType<typeof buildGraph>): number {
  return model.teams.filter((t) => !t.idle).reduce((n, t) => n + t.workers.length, 0);
}

export function GraphView(): JSX.Element {
  const categories = useAppData((s) => s.categories);
  const agents = useAppData((s) => s.agents);
  const sessions = useSessions((s) => s.sessions);
  const orderByAgent = useSessions((s) => s.orderByAgent);
  const taskQueue = useSessions((s) => s.taskQueue);
  const busy = useGraphStore((s) => s.busy);
  const idleTeams = useGraphStore((s) => s.idleTeams);
  const positions = useGraphStore((s) => s.positions);
  const selection = useGraphStore((s) => s.selection);
  const setPosition = useGraphStore((s) => s.setPosition);
  const select = useGraphStore((s) => s.select);
  const setTeamIdle = useGraphStore((s) => s.setTeamIdle);

  const sessionsSlice = useMemo(() => ({ sessions, orderByAgent }), [sessions, orderByAgent]);
  const model = useMemo(
    () => buildGraph(categories, agents, sessionsSlice, busy, idleTeams),
    [categories, agents, sessionsSlice, busy, idleTeams],
  );

  const [view, setView] = useState({ x: 60, y: 20, scale: 0.82 });
  const [edges, setEdges] = useState<EdgeSpec[]>([]);
  const [spawnRuntime, setSpawnRuntime] = useState<RuntimeId>('claude');
  const [composer, setComposer] = useState<ComposerTarget | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const canvasRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const toastTimer = useRef<number | undefined>(undefined);

  const flash = useCallback((msg: string) => {
    setToast(msg);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2400);
  }, []);

  /* ---------------------------------------------------------- auto layout */
  const autoPos = useMemo(() => {
    const teamsPos: Record<string, Pos> = {};
    let x = 120;
    let extentR = x;
    for (const t of model.teams) {
      const n = 1 + t.workers.length;
      teamsPos[t.category.id] = { x, y: TEAM_Y };
      const w = teamWidth(n);
      extentR = x + w;
      x += w + TEAM_GAP;
    }
    const orchX = model.teams.length ? (120 + extentR) / 2 - 112 : 220;
    return { orch: { x: orchX, y: 90 } as Pos, teams: teamsPos };
  }, [model]);

  const posFor = useCallback(
    (key: string): Pos => {
      if (positions[key]) return positions[key];
      if (key === 'orch') return autoPos.orch;
      return autoPos.teams[key] ?? { x: 120, y: TEAM_Y };
    },
    [positions, autoPos],
  );

  /* ------------------------------------------------------------- edges */
  const modelSig = useMemo(
    () =>
      `${model.orchestrator?.id ?? 'ghost'}|` +
      model.teams.map((t) => `${t.category.id}:${t.lead?.id ?? '-'}:${t.workers.map((w) => w.id).join(',')}:${t.idle}`).join('|'),
    [model],
  );
  const posSig = useMemo(() => JSON.stringify(positions), [positions]);

  const computeEdges = useCallback(() => {
    const world = worldRef.current;
    if (!world) return;
    const wr = world.getBoundingClientRect();
    const scale = view.scale || 1;
    const anchor = (id: string, side: 'top' | 'bot'): Pos | null => {
      const el = world.querySelector(`[data-anchor="${id}:${side}"]`);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: (r.left + r.width / 2 - wr.left) / scale, y: (r.top + r.height / 2 - wr.top) / scale };
    };
    const path = (a: Pos, b: Pos): string => {
      const dy = Math.max(46, (b.y - a.y) / 2);
      return `M${a.x},${a.y} C${a.x},${a.y + dy} ${b.x},${b.y - dy} ${b.x},${b.y}`;
    };
    const next: EdgeSpec[] = [];
    const oBot = anchor('orch', 'bot');
    if (oBot) {
      for (const t of model.teams) {
        if (!t.lead) continue;
        const leadTop = anchor(t.lead.id, 'top');
        if (leadTop) next.push({ d: path(oBot, leadTop), active: !t.idle, cable: true });
        const leadBot = anchor(t.lead.id, 'bot');
        if (leadBot) {
          for (const w of t.workers) {
            const wTop = anchor(w.id, 'top');
            if (wTop) next.push({ d: path(leadBot, wTop), active: !t.idle, cable: false });
          }
        }
      }
    }
    setEdges(next);
  }, [model, view.scale]);

  useLayoutEffect(() => {
    const raf = requestAnimationFrame(computeEdges);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelSig, posSig, computeEdges]);

  useEffect(() => {
    const onResize = (): void => computeEdges();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [computeEdges]);

  /* ----------------------------------------------------------- pan/zoom */
  const panRef = useRef<{ sx: number; sy: number; px: number; py: number } | null>(null);
  const onCanvasPointerDown = (e: React.PointerEvent): void => {
    const target = e.target as HTMLElement;
    if (target.closest('.gcard') || target.closest('.gteam-bar')) return;
    select(null);
    panRef.current = { sx: e.clientX, sy: e.clientY, px: view.x, py: view.y };
    canvasRef.current?.classList.add('panning');
    const move = (ev: PointerEvent): void => {
      const p = panRef.current;
      if (!p) return;
      setView((v) => ({ ...v, x: p.px + (ev.clientX - p.sx), y: p.py + (ev.clientY - p.sy) }));
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

  const onWheel = (e: React.WheelEvent): void => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    setView((v) => {
      const scale = Math.min(1.6, Math.max(0.4, v.scale * (e.deltaY < 0 ? 1.1 : 0.9)));
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const k = scale / v.scale;
      return { scale, x: mx - (mx - v.x) * k, y: my - (my - v.y) * k };
    });
  };

  const zoomBy = (f: number): void =>
    setView((v) => {
      const scale = Math.min(1.6, Math.max(0.4, v.scale * f));
      const rect = canvasRef.current?.getBoundingClientRect();
      const mx = (rect?.width ?? 800) / 2;
      const my = (rect?.height ?? 600) / 2;
      const k = scale / v.scale;
      return { scale, x: mx - (mx - v.x) * k, y: my - (my - v.y) * k };
    });

  const fitView = useCallback(() => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    let left = posFor('orch').x;
    let right = left + 224;
    for (const t of model.teams) {
      const p = posFor(t.category.id);
      left = Math.min(left, p.x);
      right = Math.max(right, p.x + teamWidth(1 + t.workers.length));
    }
    const top = 90;
    const bottom = TEAM_Y + 250;
    const pad = 80;
    const scale = Math.min(1.15, Math.max(0.45, Math.min((rect.width - pad * 2) / (right - left), (rect.height - pad * 2 - 60) / (bottom - top))));
    setView({ scale, x: (rect.width - (right - left) * scale) / 2 - left * scale, y: pad - top * scale });
  }, [model, posFor]);

  // Fit once after first paint / when the team count changes structurally.
  const teamCount = model.teams.length;
  useEffect(() => {
    const raf = requestAnimationFrame(fitView);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamCount]);

  /* --------------------------------------------------------- node drag */
  const startDrag = (key: string, e: React.PointerEvent): void => {
    e.stopPropagation();
    const start = posFor(key);
    const sx = e.clientX;
    const sy = e.clientY;
    let moved = false;
    const move = (ev: PointerEvent): void => {
      const dx = (ev.clientX - sx) / view.scale;
      const dy = (ev.clientY - sy) / view.scale;
      if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
      setPosition(key, { x: start.x + dx, y: start.y + dy });
    };
    const up = (): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (!moved) {
        // treat as a click on the bar → select
        if (key === 'orch') select(model.orchestrator ? { kind: 'orchestrator', id: model.orchestrator.id } : null);
        else {
          const t = model.teams.find((tm) => tm.category.id === key);
          if (t) select({ kind: 'team', id: key });
        }
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  /* -------------------------------------------------------------- render */
  const isSelected = (sel: GraphSelection): boolean =>
    !!selection && selection.kind === sel.kind && selection.id === sel.id;

  const nodeStatus = (agentId: string, idle: boolean): NodeStatus =>
    statusFor(agentId, { idle, busy, sessions: sessionsSlice });

  const renderCard = (
    agent: Agent,
    role: 'lead' | 'worker',
    teamId: string,
    idle: boolean,
  ): JSX.Element => {
    const rv = runtimeVisual(agent.runtime);
    const st = nodeStatus(agent.id, idle);
    const sel = isSelected({ kind: role, id: agent.id });
    return (
      <div
        key={agent.id}
        className={`gcard gcard-static${sel ? ' sel' : ''}`}
        data-status={st}
        style={{ ['--rt' as string]: rv.color }}
        onClick={(e) => {
          e.stopPropagation();
          select({ kind: role, id: agent.id, teamId });
        }}
        onDoubleClick={(e) => {
          e.stopPropagation();
          void openTerminal(agent.id);
        }}
      >
        <div className="gcard-bar nograb">
          <div className="glights"><i className="r" /><i className="y" /><i className="g" /></div>
          <div className="gcard-title">~ {role}</div>
        </div>
        <div className="gcard-body">
          <div className="gcard-role">~ {role}</div>
          <div className="gglyph"><rv.Glyph /></div>
          <div className="gcard-name">{agent.name}</div>
          <div className="gchip" data-s={st}>{st}</div>
        </div>
        <i className="ganchor top" data-anchor={`${agent.id}:top`} />
        <i className="ganchor bot" data-anchor={`${agent.id}:bot`} />
      </div>
    );
  };

  const orchAgent = model.orchestrator;
  const orchRv = runtimeVisual(orchAgent?.runtime ?? 'claude');
  const orchPos = posFor('orch');
  const orchSel = orchAgent ? isSelected({ kind: 'orchestrator', id: orchAgent.id }) : false;

  return (
    <div className="graph">
      <div className="ghint">
        <span><b>Drag</b> Kacheln &amp; Hintergrund · <b>Scroll</b> Zoom · <b>Klick</b> wählt · <b>Doppelklick</b> öffnet Terminal</span>
        <span className="gqueue"><b>{taskQueue.active}</b> aktiv · <b>{taskQueue.queued}</b> wartend · max. {taskQueue.maxActive}</span>
      </div>

      <div
        ref={canvasRef}
        className="graph-canvas"
        onPointerDown={onCanvasPointerDown}
        onWheel={onWheel}
      >
        <div
          ref={worldRef}
          className="graph-world"
          style={{ transform: `translate(${view.x}px,${view.y}px) scale(${view.scale})` }}
        >
          <svg className="graph-edges">
            {edges.map((e, i) => (
              <g key={i}>
                <path
                  d={e.d}
                  fill="none"
                  stroke={e.cable ? 'var(--cable)' : 'var(--accent)'}
                  strokeWidth={e.cable ? 3.2 : 2}
                  strokeLinecap="round"
                  opacity={e.active ? 0.9 : 0.32}
                  filter={e.cable && e.active ? 'drop-shadow(0 0 6px color-mix(in srgb, var(--add) 55%, transparent))' : undefined}
                />
                {e.active && (
                  <path d={e.d} fill="none" stroke={e.cable ? 'var(--cable)' : 'var(--accent)'} strokeWidth={e.cable ? 1.8 : 1.2} strokeLinecap="round" strokeDasharray="2 16" opacity={0.5}>
                    <animate attributeName="stroke-dashoffset" from="0" to="-36" dur="1.4s" repeatCount="indefinite" />
                  </path>
                )}
              </g>
            ))}
          </svg>

          {/* orchestrator */}
          <div
            className={`gcard orch${orchAgent ? '' : ' ghost'}${orchSel ? ' sel' : ''}`}
            data-status={orchAgent ? nodeStatus(orchAgent.id, false) : 'idle'}
            style={{ left: orchPos.x, top: orchPos.y, ['--rt' as string]: orchRv.color }}
            onClick={(e) => {
              e.stopPropagation();
              if (orchAgent) select({ kind: 'orchestrator', id: orchAgent.id });
            }}
            onDoubleClick={(e) => {
              e.stopPropagation();
              if (orchAgent) void openTerminal(orchAgent.id);
            }}
          >
            <div className="gcard-bar" onPointerDown={(e) => startDrag('orch', e)}>
              <div className="glights"><i className="r" /><i className="y" /><i className="g" /></div>
              <div className="gcard-title">ade · orchestrator</div>
            </div>
            <div className="gcard-body">
              <div className="gglyph"><orchRv.Glyph /></div>
              <div className="gcard-name">{orchAgent?.name ?? 'Claude'}</div>
              <div className="gchip" data-s={orchAgent ? nodeStatus(orchAgent.id, false) : 'idle'}>
                {orchAgent ? nodeStatus(orchAgent.id, false) : 'kein Team'}
              </div>
            </div>
            <i className="ganchor top" data-anchor="orch:top" />
            <i className="ganchor bot" data-anchor="orch:bot" />
          </div>

          {/* teams */}
          {model.teams.map((t) => {
            const p = posFor(t.category.id);
            const sel = isSelected({ kind: 'team', id: t.category.id });
            return (
              <div
                key={t.category.id}
                className={`gteam${t.idle ? ' idle' : ''}${sel ? ' sel' : ''}`}
                style={{ left: p.x, top: p.y }}
              >
                <div className="gteam-bar" onPointerDown={(e) => startDrag(t.category.id, e)}>
                  <div className="glights"><i className="r" /><i className="y" /><i className="g" /></div>
                  <div className="gteam-tt">team · <b>{t.category.name}</b></div>
                  <div className="gteam-grow" />
                  <div className="gteam-actions" onPointerDown={(e) => e.stopPropagation()}>
                    <button className="gtbtn" title="Worker hinzufügen" onClick={() => void addWorker(t.category.id)}><Ico>{I.plus}</Ico></button>
                    <button className="gtbtn" title={t.idle ? 'Reaktivieren' : 'Idle'} onClick={() => setTeamIdle(t.category.id, !t.idle)}><Ico>{t.idle ? I.play : I.pause}</Ico></button>
                    <button className="gtbtn danger" title="Team auflösen" onClick={() => void dissolveTeam(t.category.id)}><Ico>{I.trash}</Ico></button>
                  </div>
                </div>
                <div className="gteam-members">
                  {t.lead && renderCard(t.lead, 'lead', t.category.id, t.idle)}
                  {t.workers.map((w) => renderCard(w, 'worker', t.category.id, t.idle))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <Inspector
        model={model}
        selection={selection}
        spawnRuntime={spawnRuntime}
        setSpawnRuntime={setSpawnRuntime}
        nodeStatus={nodeStatus}
        onClose={() => select(null)}
        onSpawn={async () => {
          const name = await spawnTeam({ runtime: spawnRuntime });
          flash(`Team gespawnt · ${runtimeVisual(spawnRuntime).label} lead`);
          select({ kind: 'team', id: name });
        }}
        onCompose={setComposer}
        onIdleAll={() => model.teams.forEach((t) => setTeamIdle(t.category.id, true))}
        setTeamIdle={setTeamIdle}
        flash={flash}
      />

      <div className="gzoom">
        <button title="Zoom in" onClick={() => zoomBy(1.15)}>＋</button>
        <button title="Zoom out" onClick={() => zoomBy(0.87)}>－</button>
        <button title="Fit" onClick={fitView}>⤢</button>
      </div>

      <div className="gdock">
        <button className="gdbtn accent" onClick={() => { void spawnTeam({ runtime: spawnRuntime }).then((id) => { flash('Team gespawnt'); select({ kind: 'team', id }); }); }}>
          <Ico>{I.plus}</Ico>Team spawnen
        </button>
        <div className="sep" />
        <button className="gdbtn" onClick={() => setComposer({ kind: 'all', workerCount: activeWorkerCount(model) })}><Ico>{I.arrow}</Ico>Runde verteilen</button>
        <button className="gdbtn" onClick={() => model.teams.forEach((t) => setTeamIdle(t.category.id, true))}><Ico>{I.pause}</Ico>Alle idle</button>
        <button className="gdbtn" onClick={() => model.teams.forEach((t) => setTeamIdle(t.category.id, false))}><Ico>{I.play}</Ico>Alle aktiv</button>
        {taskQueue.active + taskQueue.queued > 0 && (
          <button className="gdbtn danger" onClick={() => void cancelAllTasks().then(() => flash('Alle Tasks gestoppt'))}>
            <Ico>{I.stop}</Ico>Tasks stoppen
          </button>
        )}
      </div>

      {toast && <div className="gtoast">{toast}</div>}

      {composer && (
        <Composer
          target={composer}
          onCancel={() => setComposer(null)}
          onSend={async (text, opts) => {
            const t = composer;
            setComposer(null);
            if (t.kind === 'all') {
              const n = opts.toWorkers ? t.workerCount : 0;
              const result = await dispatchAll(text, opts);
              flash(result.failed
                ? `${result.started} Task-Sessions gestartet, ${result.failed} fehlgeschlagen`
                : (n ? `Task an alle Teams + ${n} Worker verteilt` : 'Task an alle Teams verteilt'));
            } else if (t.kind === 'team') {
              const n = opts.toWorkers ? t.workerCount : 0;
              const result = await dispatchTeam(t.id, text, opts);
              flash(result.failed
                ? `${result.started} Task-Sessions gestartet, ${result.failed} fehlgeschlagen`
                : (n ? `Task an „${t.name}" + ${n} Worker verteilt` : `Task an „${t.name}" verteilt`));
            } else {
              const result = await dispatchAgent(t.id, text);
              flash(result.failed ? `Task an ${t.name} fehlgeschlagen` : `Task an ${t.name} gesendet`);
            }
          }}
        />
      )}
    </div>
  );
}

/* ======================================================== inspector ==== */
interface InspectorProps {
  model: ReturnType<typeof buildGraph>;
  selection: GraphSelection | null;
  spawnRuntime: RuntimeId;
  setSpawnRuntime: (r: RuntimeId) => void;
  nodeStatus: (agentId: string, idle: boolean) => NodeStatus;
  onClose: () => void;
  onSpawn: () => void;
  onCompose: (t: ComposerTarget) => void;
  onIdleAll: () => void;
  setTeamIdle: (teamId: string, idle: boolean) => void;
  flash: (m: string) => void;
}

function Inspector(props: InspectorProps): JSX.Element | null {
  const { model, selection } = props;
  if (!selection) return null;

  const teamOf = (id: string): TeamModel | undefined => model.teams.find((t) => t.category.id === id);

  if (selection.kind === 'orchestrator') {
    const a = model.orchestrator;
    const rv = runtimeVisual(a?.runtime ?? 'claude');
    return (
      <aside className="ginspector">
        <Head glyph={<rv.Glyph />} color={rv.color} title={a?.name ?? 'Claude'} sub="Orchestrator" onClose={props.onClose} />
        <div className="ginsp-body">
          <KV k="Runtime" v={rv.label} />
          <KV k="Status" v={a ? props.nodeStatus(a.id, false) : 'kein Team'} />
          <KV k="Teams" v={String(model.teams.length)} />
          <KV k="Memory" v="MEMORY.md · USER.md" />
        </div>
        <div className="ginsp-actions">
          <RuntimePicker value={props.spawnRuntime} onChange={props.setSpawnRuntime} />
          <button className="gact primary" onClick={props.onSpawn}><Ico>{I.plus}</Ico>Neues Team spawnen</button>
          <button className="gact" onClick={() => props.onCompose({ kind: 'all', workerCount: activeWorkerCount(model) })}><Ico>{I.arrow}</Ico>Task an alle Teams</button>
          <button className="gact" onClick={props.onIdleAll}><Ico>{I.pause}</Ico>Alle Teams idle</button>
          {a && <button className="gact" onClick={() => void openTerminal(a.id)}><Ico>{I.term}</Ico>Terminal öffnen</button>}
        </div>
      </aside>
    );
  }

  if (selection.kind === 'team' || selection.kind === 'lead') {
    const teamId = selection.kind === 'team' ? selection.id : selection.teamId!;
    const t = teamOf(teamId);
    if (!t) return null;
    const rv = runtimeVisual(t.lead?.runtime ?? 'claude');
    return (
      <aside className="ginspector">
        <Head glyph={<rv.Glyph />} color={rv.color} title={`team · ${t.category.name}`} sub={`${rv.label} lead · ${t.workers.length} worker`} onClose={props.onClose} />
        <div className="ginsp-body">
          <KV k="Status" v={t.status} />
          <KV k="Teamleader" v={t.lead?.name ?? '—'} />
          <KV k="Worker" v={String(t.workers.length)} />
          <KV k="Lead-Memory" v="MEMORY.md · USER.md" />
        </div>
        <div className="ginsp-actions">
          <button className="gact primary" onClick={() => props.onCompose({ kind: 'team', id: t.category.id, name: t.category.name, workerCount: t.workers.length })}><Ico>{I.arrow}</Ico>Task ans Team verteilen</button>
          {t.lead && <button className="gact" onClick={() => void openTerminal(t.lead!.id)}><Ico>{I.term}</Ico>Leader-Terminal öffnen</button>}
          <button className="gact" onClick={() => void addWorker(t.category.id)}><Ico>{I.plus}</Ico>Worker hinzufügen</button>
          <button className="gact" onClick={() => props.setTeamIdle(t.category.id, !t.idle)}><Ico>{t.idle ? I.play : I.pause}</Ico>{t.idle ? 'Team reaktivieren' : 'Team idle schalten'}</button>
          <button className="gact" onClick={() => void cancelTeamTasks(t.category.id).then(() => props.flash('Team-Tasks gestoppt'))}><Ico>{I.stop}</Ico>Team-Tasks stoppen</button>
          <button className="gact danger" onClick={() => void dissolveTeam(t.category.id)}><Ico>{I.trash}</Ico>Team auflösen</button>
        </div>
      </aside>
    );
  }

  // worker
  const t = teamOf(selection.teamId!);
  const w = t?.workers.find((x) => x.id === selection.id);
  if (!t || !w) return null;
  const rv = runtimeVisual(w.runtime);
  return (
    <aside className="ginspector">
      <Head glyph={<rv.Glyph />} color={rv.color} title={w.name} sub={`Worker · team ${t.category.name}`} onClose={props.onClose} />
      <div className="ginsp-body">
        <KV k="Runtime" v={rv.label} />
        <KV k="Status" v={props.nodeStatus(w.id, t.idle)} />
        <KV k="Memory" v="MEMORY.md · USER.md" />
      </div>
      <div className="ginsp-actions">
        <button className="gact primary" onClick={() => props.onCompose({ kind: 'agent', id: w.id, name: w.name })}><Ico>{I.arrow}</Ico>Task zuweisen</button>
        <button className="gact" onClick={() => void openTerminal(w.id)}><Ico>{I.term}</Ico>Terminal öffnen</button>
        <button className="gact danger" onClick={() => void removeAgent(w.id)}><Ico>{I.trash}</Ico>Worker entfernen</button>
      </div>
    </aside>
  );
}

function Head(props: { glyph: React.ReactNode; color: string; title: string; sub: string; onClose: () => void }): JSX.Element {
  return (
    <div className="ginsp-head">
      <div className="gglyph" style={{ ['--rt' as string]: props.color }}>{props.glyph}</div>
      <div className="t">
        <h3>{props.title}</h3>
        <p>{props.sub}</p>
      </div>
      <button className="ginsp-close" onClick={props.onClose}>✕</button>
    </div>
  );
}

function KV({ k, v }: { k: string; v: string }): JSX.Element {
  return (
    <div className="gkv">
      <span>{k}</span>
      <span className="val">{v}</span>
    </div>
  );
}

function RuntimePicker({ value, onChange }: { value: RuntimeId; onChange: (r: RuntimeId) => void }): JSX.Element {
  return (
    <div className="grt-pick">
      {TEAM_RUNTIME_ORDER.map((id) => {
        const rv = runtimeVisual(id);
        return (
          <button key={id} className={id === value ? 'on' : ''} style={{ ['--rc' as string]: rv.color }} onClick={() => onChange(id)}>
            <rv.Glyph />
            {rv.short}
          </button>
        );
      })}
    </div>
  );
}

/* ========================================================= composer ==== */
function Composer(props: {
  target: ComposerTarget;
  onCancel: () => void;
  onSend: (text: string, opts: { toWorkers: boolean }) => void;
}): JSX.Element {
  const [text, setText] = useState('');
  const [toWorkers, setToWorkers] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  const t = props.target;
  const label = t.kind === 'all' ? 'alle Teams' : t.kind === 'team' ? `team · ${t.name}` : t.name;
  const canDistribute = t.kind !== 'agent';
  const workerCount = t.kind === 'agent' ? 0 : t.workerCount;
  const distribute = canDistribute && toWorkers && workerCount > 0;
  const submit = (): void => {
    if (text.trim()) props.onSend(text, { toWorkers: distribute });
  };
  return (
    <div className="gcomposer-back" onPointerDown={props.onCancel}>
      <div className="gcomposer" onPointerDown={(e) => e.stopPropagation()}>
        <h3>Task an <b>{label}</b></h3>
        <textarea
          ref={ref}
          value={text}
          placeholder="Was soll erledigt werden? (Enter sendet, Shift+Enter = neue Zeile)"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
            if (e.key === 'Escape') props.onCancel();
          }}
        />
        {canDistribute && (
          <label className="gcomposer-dist">
            <input
              type="checkbox"
              checked={distribute}
              disabled={workerCount === 0}
              onChange={(e) => setToWorkers(e.target.checked)}
            />
            <span>
              auch an Worker verteilen
              {workerCount === 0 ? ' (keine Worker)' : ` — ${workerCount} eigene Session${workerCount === 1 ? '' : 's'}`}
            </span>
          </label>
        )}
        {distribute && (
          <div className="gcomposer-warn">
            Startet {workerCount} zusätzliche Task-Session{workerCount === 1 ? '' : 's'}; maximal vier laufen gleichzeitig.
          </div>
        )}
        <div className="gcomposer-foot">
          <button className="gact" style={{ width: 'auto' }} onClick={props.onCancel}>Abbrechen</button>
          <button className="gact primary" style={{ width: 'auto' }} onClick={submit}>Senden</button>
        </div>
      </div>
    </div>
  );
}
