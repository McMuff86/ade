import { useLocale } from "../i18n/language";
/**
 * The pannable, zoomable world: run clusters with their nodes, the edges
 * measured from the rendered anchors, and short journal-driven pulses.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { JSX } from 'react';
import type { Run } from '../../shared/types';
import { useAppData } from '../stores/appdata';
import { useRuns } from '../stores/runs';
import { useSessions } from '../stores/sessions';
import { useGraphStore, type GraphSelection, type Pos } from './graphStore';
import { statusFor, type GraphMember, type NodeStatus, type RunClusterModel } from './graphModel';
import { edgePath, type GraphLayout } from './graphLayout';
import type { GraphViewport } from './useGraphViewport';
import { RunCluster, type DragKind, type GraphNodeContext } from './GraphNodes';

interface EdgeSpec {
  key: string;
  d: string;
  dim: boolean;
  cable: boolean;
}

interface TravelDot {
  id: string;
  d: string;
  cable: boolean;
}

export function GraphCanvas(props: {
  clusters: RunClusterModel[];
  viewport: GraphViewport;
  layout: GraphLayout;
  flash: (message: string) => void;
}): JSX.Element {
  useLocale();
  const { clusters, viewport, layout, flash } = props;
  const { view } = viewport;
  const { clusterPos, nodePos } = layout;
  const agents = useAppData((state) => state.agents);
  const repositories = useAppData((state) => state.repositories);
  const workspaceBindings = useAppData((state) => state.workspaceBindings);
  const runs = useRuns((state) => state.runs);
  const tasks = useRuns((state) => state.tasks);
  const approvals = useRuns((state) => state.approvals);
  const messages = useRuns((state) => state.messages);
  const usageByRun = useRuns((state) => state.usageByRun);
  const activeRunId = useRuns((state) => state.activeRunId);
  const setActiveRun = useRuns((state) => state.setActiveRun);
  const sessions = useSessions((state) => state.sessions);
  const orderByAgent = useSessions((state) => state.orderByAgent);
  const busy = useGraphStore((state) => state.busy);
  const positions = useGraphStore((state) => state.positions);
  const selection = useGraphStore((state) => state.selection);
  const setPosition = useGraphStore((state) => state.setPosition);
  const select = useGraphStore((state) => state.select);
  const setTeamIdle = useGraphStore((state) => state.setTeamIdle);

  const sessionsSlice = useMemo(() => ({ sessions, orderByAgent }), [sessions, orderByAgent]);
  const pendingApprovalRunIds = useMemo(() => new Set(
    approvals
      .filter((approval) => approval.status === 'pending')
      .filter((approval) => runs.find((run) => run.id === approval.runId)?.status === 'running')
      .map((approval) => approval.runId),
  ), [approvals, runs]);

  const [edges, setEdges] = useState<EdgeSpec[]>([]);
  const [dots, setDots] = useState<TravelDot[]>([]);
  const [hotEdges, setHotEdges] = useState<Record<string, true>>({});
  const [flashes, setFlashes] = useState<Record<string, 'ok' | 'bad'>>({});
  const worldRef = useRef<HTMLDivElement>(null);
  const anchorsRef = useRef<Record<string, { top: Pos; bot: Pos }>>({});
  const lastSeenSeqRef = useRef<number | null>(null);
  const taskStatusRef = useRef<Map<string, string>>(new Map());
  const prefersReducedMotion = useMemo(
    () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
    [],
  );

  /**
   * The worktree branch an agent works on inside this run's repository scope.
   * Explicit no-repository runs have no branch; legacy runs fall back to the
   * agent's default repository binding.
   */
  const branchFor = useCallback((run: Run, agentId: string): string | null => {
    const repositoryId = run.repositoryId === null
      ? undefined
      : run.repositoryId ?? agents[agentId]?.defaultRepositoryId;
    if (!repositoryId) return null;
    const binding = workspaceBindings.find((candidate) =>
      candidate.agentId === agentId
      && candidate.repositoryId === repositoryId
      && candidate.status !== 'invalid');
    return binding?.branch || null;
  }, [workspaceBindings, agents]);

  /** Selecting anything inside a cluster also makes that run the active one. */
  const selectInCluster = useCallback((runId: string, sel: GraphSelection | null) => {
    if (runId !== useRuns.getState().activeRunId) setActiveRun(runId);
    select(sel);
  }, [select, setActiveRun]);

  /* ------------------------------------------------------------- edges */

  const modelSig = useMemo(() => clusters.map((cluster) => (
    `${cluster.run.id}:${cluster.run.status}:${cluster.orchestrator?.id ?? '-'}|${cluster.teams
      .map((team) => `${team.id}:${team.lead?.id ?? '-'}:${team.workers.map((worker) => worker.id).join(',')}:${team.idle}`)
      .join('|')}`
  )).join('||'), [clusters]);
  const positionSig = useMemo(() => JSON.stringify(positions), [positions]);

  const computeEdges = useCallback(() => {
    const world = worldRef.current;
    if (!world) return;
    const worldRect = world.getBoundingClientRect();
    const scale = view.scale || 1;
    const anchors: Record<string, { top: Pos; bot: Pos }> = {};
    for (const element of world.querySelectorAll<HTMLElement>('[data-anchor]')) {
      const [id, side] = (element.dataset.anchor ?? '').split(/:(top|bot)$/);
      if (!id || !side) continue;
      const rect = element.getBoundingClientRect();
      const point = {
        x: (rect.left + rect.width / 2 - worldRect.left) / scale,
        y: (rect.top + rect.height / 2 - worldRect.top) / scale,
      };
      const entry = anchors[id] ?? { top: point, bot: point };
      if (side === 'top') entry.top = point;
      else entry.bot = point;
      anchors[id] = entry;
    }
    anchorsRef.current = anchors;

    const next: EdgeSpec[] = [];
    for (const cluster of clusters) {
      const orchestratorBottom = cluster.orchestrator
        ? anchors[cluster.orchestrator.id]?.bot
        : undefined;
      for (const team of cluster.teams) {
        if (!team.lead) continue;
        const leadAnchor = anchors[team.lead.id];
        if (orchestratorBottom && leadAnchor) {
          next.push({
            key: `${cluster.orchestrator!.id}->${team.lead.id}`,
            d: edgePath(orchestratorBottom, leadAnchor.top),
            dim: team.idle || cluster.terminal,
            cable: true,
          });
        }
        if (!leadAnchor) continue;
        for (const worker of team.workers) {
          const workerAnchor = anchors[worker.id];
          if (workerAnchor) {
            next.push({
              key: `${team.lead.id}->${worker.id}`,
              d: edgePath(leadAnchor.bot, workerAnchor.top),
              dim: team.idle || cluster.terminal,
              cable: false,
            });
          }
        }
      }
    }
    setEdges(next);
  }, [clusters, view.scale]);

  useLayoutEffect(() => {
    const frame = requestAnimationFrame(computeEdges);
    return () => cancelAnimationFrame(frame);
  }, [modelSig, positionSig, computeEdges]);

  useEffect(() => {
    window.addEventListener('resize', computeEdges);
    return () => window.removeEventListener('resize', computeEdges);
  }, [computeEdges]);

  /* ------------------------------------------- journal-driven animation */

  // Travel dots ride only on NEW journaled messages (seq cursor), never on a
  // timer and never on mount replay. Reduced motion drops the moving dot and
  // keeps the short edge highlight.
  useEffect(() => {
    const maxSeq = messages.reduce((max, message) => Math.max(max, message.seq), 0);
    if (lastSeenSeqRef.current === null) {
      lastSeenSeqRef.current = maxSeq;
      return;
    }
    if (maxSeq <= lastSeenSeqRef.current) return;
    const fresh = messages
      .filter((message) => message.seq > lastSeenSeqRef.current!)
      .slice(-6);
    lastSeenSeqRef.current = maxSeq;

    const anchors = anchorsRef.current;
    const created: TravelDot[] = [];
    const hot: Record<string, true> = {};
    for (const message of fresh) {
      const to = anchors[message.toParticipantId];
      if (!to) continue;
      const from = message.fromParticipantId ? anchors[message.fromParticipantId] : undefined;
      if (message.fromParticipantId) hot[`${message.fromParticipantId}->${message.toParticipantId}`] = true;
      if (from && !prefersReducedMotion) {
        created.push({
          id: `${message.id}:${message.seq}`,
          d: edgePath(from.bot, to.top),
          cable: message.kind === 'plan' || message.kind === 'assignment',
        });
      }
    }
    if (!created.length && !Object.keys(hot).length) return;
    setDots((current) => [...current, ...created]);
    setHotEdges((current) => ({ ...current, ...hot }));
    window.setTimeout(() => {
      setDots((current) => current.filter((dot) => !created.some((item) => item.id === dot.id)));
      setHotEdges((current) => {
        const nextHot = { ...current };
        for (const key of Object.keys(hot)) delete nextHot[key];
        return nextHot;
      });
    }, 1_300);
  }, [messages, prefersReducedMotion]);

  // Short node pulse on real task completion/failure transitions.
  useEffect(() => {
    const previous = taskStatusRef.current;
    const next = new Map<string, string>();
    const add: Record<string, 'ok' | 'bad'> = {};
    for (const task of tasks) {
      next.set(task.id, task.status);
      const before = previous.get(task.id);
      if (before && before !== task.status) {
        if (task.status === 'completed') add[task.participantId] = 'ok';
        if (task.status === 'failed') add[task.participantId] = 'bad';
      }
    }
    taskStatusRef.current = next;
    if (!Object.keys(add).length) return;
    setFlashes((current) => ({ ...current, ...add }));
    window.setTimeout(() => {
      setFlashes((current) => {
        const cleaned = { ...current };
        for (const key of Object.keys(add)) delete cleaned[key];
        return cleaned;
      });
    }, 750);
  }, [tasks]);

  /* ------------------------------------------------------------ dragging */

  const startDrag = (
    kind: DragKind,
    runId: string,
    key: string,
    event: React.PointerEvent,
    onPlainClick?: () => void,
  ): void => {
    event.stopPropagation();
    const storageKey = kind === 'cluster' ? `cluster:${runId}` : `${runId}:${key}`;
    const start = kind === 'cluster' ? clusterPos(runId) : nodePos(runId, key);
    const startX = event.clientX;
    const startY = event.clientY;
    let moved = false;
    const move = (nextEvent: PointerEvent): void => {
      const deltaX = (nextEvent.clientX - startX) / view.scale;
      const deltaY = (nextEvent.clientY - startY) / view.scale;
      if (Math.abs(deltaX) + Math.abs(deltaY) > 3) moved = true;
      const next = { x: start.x + deltaX, y: start.y + deltaY };
      if (kind === 'node') {
        // Nodes stay inside their cluster frame: the frame grows right/down
        // with the node (RunCluster bounding box), never left/up.
        next.x = Math.max(8, next.x);
        next.y = Math.max(44, next.y);
      }
      setPosition(storageKey, next);
    };
    const up = (): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (!moved) onPlainClick?.();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const nodeStatus = (cluster: RunClusterModel, member: GraphMember, idle: boolean): NodeStatus => statusFor(
    member.id,
    member.agentId,
    {
      idle,
      busy,
      sessions: sessionsSlice,
      tasks: tasks.filter((task) => task.runId === cluster.run.id),
    },
  );

  const ctx: GraphNodeContext = {
    activeRunId,
    flashes,
    isSelected: (candidate) => Boolean(
      selection && selection.kind === candidate.kind && selection.id === candidate.id,
    ),
    clusterPos,
    nodePos,
    branchFor,
    nodeStatus,
    selectInCluster,
    startDrag,
    setTeamIdle,
    flash,
  };

  return (
    <div ref={viewport.canvasRef} className="graph-canvas" onPointerDown={viewport.onCanvasPointerDown} onWheel={viewport.onWheel}>
      <div
        ref={worldRef}
        className="graph-world"
        style={{ transform: `translate(${view.x}px,${view.y}px) scale(${view.scale})` }}
      >
        <svg className="graph-edges">
          {edges.map((edge) => (
            <path
              key={edge.key}
              className={`gedge${hotEdges[edge.key] ? ' hot' : ''}`}
              d={edge.d}
              fill="none"
              stroke={edge.cable ? 'var(--cable)' : 'var(--accent)'}
              strokeWidth={edge.cable ? 3.2 : 2}
              strokeLinecap="round"
              opacity={edge.dim ? 0.28 : 0.75}
            />
          ))}
          {dots.map((dot) => (
            <circle key={dot.id} className={`gdot${dot.cable ? ' cable' : ''}`} r={4.5}>
              <animateMotion dur="1.1s" repeatCount="1" fill="freeze" path={dot.d} />
            </circle>
          ))}
        </svg>

        {clusters.map((cluster) => (
          <RunCluster
            key={cluster.run.id}
            cluster={cluster}
            ctx={ctx}
            repository={cluster.run.repositoryId
              ? repositories.find((candidate) => candidate.id === cluster.run.repositoryId)
              : null}
            usage={usageByRun[cluster.run.id]}
            approvalPending={pendingApprovalRunIds.has(cluster.run.id)}
          />
        ))}
      </div>
    </div>
  );
}
