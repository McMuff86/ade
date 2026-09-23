import { localizeAppMessage } from '../../shared/i18n/appMessages';
import { zoomViewAt } from '../viewTransform';
import { t as translate } from "../../shared/i18n";
import { useLocale } from "../i18n/language";
/** Graph mode: a multi-run canvas over persisted runs, participants and task events. */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { JSX } from 'react';
import {
  MAX_TASK_MINUTES_LIMIT,
  type Agent,
  type Category,
  type Repository,
  type Run,
  type RunCreateInput,
  type RunPublication,
  type RunPublicationPreview,
  type RunTaskResult,
  type RuntimeId,
  type TaskProvenance,
} from '../../shared/types';
import { MANAGED_HARNESS_OVERRIDES } from '../../shared/runtimes';
import type { ApprovalDiffResult, WslDistributionInfo } from '../../shared/ipc';
import {
  NATIVE_EXECUTION_BACKEND,
  type ExecutionBackendId,
} from '../../shared/executionBackends';
import { useAppData } from '../stores/appdata';
import { useRuns } from '../stores/runs';
import { useSessions } from '../stores/sessions';
import { DesktopSupervisionGraph } from '../supervision/SupervisionGraph';
import { useGraphStore, type GraphSelection, type Pos } from './graphStore';
import {
  buildClusters,
  failureNoticeFor,
  statusFor,
  type GraphMember,
  type NodeStatus,
  type RunClusterModel,
  type TeamModel,
} from './graphModel';
import { runtimeVisual } from './runtimeGlyphs';
import {
  cancelAllTasks,
  cancelTeamTasks,
  dispatchAgent,
  dispatchAll,
  dispatchTeam,
  openParticipantTerminal,
  setTeamPause,
} from './graphActions';
import { ActivityFeed } from './ActivityFeed';
import { SessionTail } from './SessionTail';
import { ResultDetails, outcomeText } from './ResultDetails';
import { RunReportPanel } from './RunReportPanel';
import { RepositorySyncModal } from '../repositories/RepositorySyncModal';
import { RepositorySyncPanel } from '../repositories/RepositorySyncPanel';
import './graph.css';

const CARD_W = 150;
const GAP = 14;
const TEAM_PAD = 16;
const TEAM_GAP_IN = 48;
const CLUSTER_PAD = 24;
const ORCH_Y = 64;
const TEAM_Y = 310;
const CLUSTER_H = TEAM_Y + 252;
const CLUSTER_GAP = 150;
const ORCH_W = 224;

function teamWidth(memberCount: number): number {
  return TEAM_PAD * 2 + memberCount * CARD_W + Math.max(0, memberCount - 1) * GAP;
}

/** Colored diffs render one span per line; huge patches stay responsive. */
const DIFF_RENDER_LINE_CAP = 4000;

function diffLineClass(line: string): string {
  if (line.startsWith('+++') || line.startsWith('---')
    || line.startsWith('diff ') || line.startsWith('index ')) return 'meta';
  if (line.startsWith('@@')) return 'hunk';
  if (line.startsWith('+')) return 'add';
  if (line.startsWith('-')) return 'del';
  return '';
}

function clusterWidth(cluster: RunClusterModel): number {
  const teamsWidth = cluster.teams.reduce(
    (total, team) => total + teamWidth(1 + team.workers.length),
    0,
  ) + Math.max(0, cluster.teams.length - 1) * TEAM_GAP_IN;
  return Math.max(320, ORCH_W + CLUSTER_PAD * 2, teamsWidth + CLUSTER_PAD * 2);
}

/** Graph zoom range; the same view math drives the sketch sheet (renderer/viewTransform.ts). */
const GRAPH_SCALE = { min: 0.3, max: 1.6 };

const I = {
  plus: <path d="M12 5v14M5 12h14" />,
  arrow: <path d="M4 12h13M13 6l6 6-6 6" />,
  pause: <><circle cx="12" cy="12" r="8" /><path d="M9 12h6" /></>,
  play: <path d="M8 6l10 6-10 6z" />,
  stop: <rect x="7" y="7" width="10" height="10" rx="1" />,
  term: <path d="M5 8l4 4-4 4M12 16h6" />,
  close: <path d="M7 7l10 10M17 7L7 17" />,
  trash: <path d="M4 7h16M9 7V4h6v3M6 7l1 12a2 2 0 002 2h6a2 2 0 002-2l1-12M10 11v5M14 11v5" />,
  publish: <><path d="M12 16V4M7 9l5-5 5 5" /><path d="M5 14v5h14v-5" /></>,
  report: <><path d="M6 3h9l4 4v14H6z" /><path d="M9 12h6M9 16h6M15 3v4h4" /></>,
  minus: <path d="M5 12h14" />,
  fit: <path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" />,
  grip: <path d="M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01" />,
  dockDown: <path d="M12 4v11m-5-5 5 5 5-5M5 20h14" />,
};

function Ico({ children }: { children: React.ReactNode }): JSX.Element {
  useLocale();
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  );
}

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

type ComposerTarget =
  | { kind: 'all'; workerCount: number }
  | { kind: 'team'; id: string; name: string; workerCount: number }
  | { kind: 'participant'; id: string; name: string };

function activeWorkerCount(cluster: RunClusterModel | null): number {
  if (!cluster) return 0;
  return cluster.teams.filter((team) => !team.idle)
    .reduce((count, team) => count + team.workers.length, 0);
}

function statusText(status: NodeStatus): string {
  switch (status) {
    case 'running': return translate("Terminal active");
    case 'working': return translate("working");
    case 'done': return translate("done");
    case 'failed': return translate("Failed [6665686c]");
    default: return 'idle';
  }
}

function runStatusText(status: string): string {
  switch (status) {
    case 'draft': return translate("Draft");
    case 'running': return translate("Running");
    case 'completed': return translate("Completed");
    case 'failed': return translate("Failed");
    case 'cancelled': return translate("Aborted");
    default: return status;
  }
}

function phaseText(phase: string): string {
  switch (phase) {
    case 'planning': return translate("Planning");
    case 'working': return translate("Worker");
    case 'approval': return translate("Approval");
    case 'integrating': return translate("Integration");
    case 'verifying': return translate("Verification");
    case 'completed': return translate("Finished");
    case 'failed': return translate("Error");
    case 'cancelled': return translate("Aborted");
    default: return translate("Draft");
  }
}

function taskStatusText(status: string): string {
  switch (status) {
    case 'queued': return translate("waiting");
    case 'running': return translate("running");
    case 'completed': return translate("completed");
    case 'failed': return translate("Failed [6665686c]");
    case 'cancelled': return translate("cancelled");
    default: return status;
  }
}

function edgePath(from: Pos, to: Pos): string {
  const offset = Math.max(46, (to.y - from.y) / 2);
  return `M${from.x},${from.y} C${from.x},${from.y + offset} ${to.x},${to.y - offset} ${to.x},${to.y}`;
}

export function GraphView(): JSX.Element {
  const locale = useLocale();
  const categories = useAppData((state) => state.categories);
  const agents = useAppData((state) => state.agents);
  const repositories = useAppData((state) => state.repositories);
  const workspaceBindings = useAppData((state) => state.workspaceBindings);
  const runs = useRuns((state) => state.runs);
  const participants = useRuns((state) => state.participants);
  const tasks = useRuns((state) => state.tasks);
  const events = useRuns((state) => state.events);
  const approvals = useRuns((state) => state.approvals);
  const publications = useRuns((state) => state.publications);
  const messages = useRuns((state) => state.messages);
  const results = useRuns((state) => state.results);
  const seqCursor = useRuns((state) => state.seqCursor);
  const usageByRun = useRuns((state) => state.usageByRun);
  const runsLoaded = useRuns((state) => state.loaded);
  const activeRunId = useRuns((state) => state.activeRunId);
  const setActiveRun = useRuns((state) => state.setActiveRun);
  const createRun = useRuns((state) => state.createRun);
  const deleteRun = useRuns((state) => state.deleteRun);
  const workspaceLeases = useRuns((state) => state.workspaceLeases);
  const startRun = useRuns((state) => state.startRun);
  const cancelRun = useRuns((state) => state.cancelRun);
  const resolveApproval = useRuns((state) => state.resolveApproval);
  const previewPublication = useRuns((state) => state.previewPublication);
  const publishRun = useRuns((state) => state.publishRun);
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
  const clearRunPositions = useGraphStore((state) => state.clearRunPositions);

  const sessionsSlice = useMemo(() => ({ sessions, orderByAgent }), [sessions, orderByAgent]);
  // The selected run is pinned: an older finished run chosen in the run bar
  // renders like any other cluster instead of leaving the canvas empty.
  const clusters = useMemo(
    () => buildClusters(runs, participants, agents, tasks, sessionsSlice, busy, idleTeams, 2, activeRunId),
    [runs, participants, agents, tasks, sessionsSlice, busy, idleTeams, activeRunId],
  );

  const activeCluster = clusters.find((cluster) => cluster.run.id === activeRunId) ?? null;
  const activeRun = activeCluster?.run ?? null;
  const pendingQuestions = tasks.filter((task) => task.runId === activeRunId).reduce((sum, task) => sum + (task.pendingQuestions ?? 0), 0);
  const activeRepository = activeRun?.repositoryId
    ? repositories.find((repository) => repository.id === activeRun.repositoryId)
    : null;
  const activeUsage = activeRunId ? usageByRun[activeRunId] : undefined;
  const pendingApproval = approvals.find(
    (approval) => approval.runId === activeRunId && approval.status === 'pending' && activeRun?.status === 'running',
  );
  const pendingApprovalRunIds = useMemo(() => new Set(
    approvals
      .filter((approval) => approval.status === 'pending')
      .filter((approval) => runs.find((run) => run.id === approval.runId)?.status === 'running')
      .map((approval) => approval.runId),
  ), [approvals, runs]);
  const activeRunTasks = useMemo(
    () => tasks.filter((task) => task.runId === activeRunId),
    [tasks, activeRunId],
  );
  const activeRunFailure = useMemo(
    () => failureNoticeFor(activeRun, activeRunTasks, events, results),
    [activeRun, activeRunTasks, events, results, locale],
  );
  const [reportOpen, setReportOpen] = useState(false);
  // Focus lands here when the report closes and its opener is gone (the
  // failure alert's button unmounts while the report is open).
  const reportButtonRef = useRef<HTMLButtonElement>(null);
  // A report belongs to exactly one run; switching runs closes it.
  useEffect(() => { setReportOpen(false); }, [activeRunId]);

  const [view, setView] = useState({ x: 40, y: 10, scale: 0.8 });
  const [edges, setEdges] = useState<EdgeSpec[]>([]);
  const [dots, setDots] = useState<TravelDot[]>([]);
  const [hotEdges, setHotEdges] = useState<Record<string, true>>({});
  const [flashes, setFlashes] = useState<Record<string, 'ok' | 'bad'>>({});
  const [composer, setComposer] = useState<ComposerTarget | null>(null);
  const [showNewRun, setShowNewRun] = useState(false);
  const [showGitSync, setShowGitSync] = useState(false);
  const [publicationRun, setPublicationRun] = useState<Run | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [deleteArmed, setDeleteArmed] = useState(false);
  const [approvalOpen, setApprovalOpen] = useState(false);
  const [approvalDiff, setApprovalDiff] = useState<ApprovalDiffResult | null>(null);
  const [dock, setDock] = useState<{ sessionId?: string; taskId?: string; title: string } | null>(null);
  const [dockRaw, setDockRaw] = useState(false);
  const [slotsOpen, setSlotsOpen] = useState(false);
  const [dockHeight, setDockHeight] = useState(() => {
    const stored = Number(window.localStorage.getItem('ade.graph.dockHeight'));
    return Number.isFinite(stored) && stored >= 160 ? stored : 360;
  });
  // Null = docked full-width at the bottom; set once the user drags the bar.
  const [dockPos, setDockPos] = useState<{ x: number; y: number; w: number } | null>(() => {
    try {
      return JSON.parse(window.localStorage.getItem('ade.graph.dockPos') ?? 'null') as
        | { x: number; y: number; w: number }
        | null;
    } catch {
      return null;
    }
  });

  const startDockResize = (event: React.PointerEvent): void => {
    event.preventDefault();
    const startY = event.clientY;
    const startHeight = dockHeight;
    const startPos = dockPos;
    const move = (nextEvent: PointerEvent): void => {
      const next = Math.min(
        Math.max(startHeight + (startY - nextEvent.clientY), 160),
        Math.max(240, window.innerHeight - 200),
      );
      setDockHeight(next);
      // Floating: the handle is the top edge, so keep the bottom edge fixed.
      if (startPos) setDockPos({ ...startPos, y: Math.max(0, startPos.y - (next - startHeight)) });
    };
    const up = (): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setDockHeight((height) => {
        window.localStorage.setItem('ade.graph.dockHeight', String(Math.round(height)));
        return height;
      });
      setDockPos((pos) => {
        if (pos) window.localStorage.setItem('ade.graph.dockPos', JSON.stringify(pos));
        return pos;
      });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const startDockDrag = (event: React.PointerEvent): void => {
    if ((event.target as HTMLElement).closest('button')) return;
    event.preventDefault();
    const panel = (event.currentTarget as HTMLElement).closest('.gdockpanel') as HTMLElement | null;
    const parent = panel?.offsetParent as HTMLElement | null;
    if (!panel || !parent) return;
    const rect = panel.getBoundingClientRect();
    const parentRect = parent.getBoundingClientRect();
    const offsetX = event.clientX - rect.left;
    const offsetY = event.clientY - rect.top;
    const width = rect.width;
    const move = (nextEvent: PointerEvent): void => {
      setDockPos({
        x: Math.max(0, nextEvent.clientX - parentRect.left - offsetX),
        y: Math.max(0, nextEvent.clientY - parentRect.top - offsetY),
        w: width,
      });
    };
    const up = (): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setDockPos((pos) => {
        if (pos) window.localStorage.setItem('ade.graph.dockPos', JSON.stringify(pos));
        return pos;
      });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  // Presentation-only preference: colored vs monochrome approval diffs.
  const [diffColors, setDiffColors] = useState(
    () => window.localStorage.getItem('ade.graph.diffColors') !== 'off',
  );
  const toggleDiffColors = useCallback(() => setDiffColors((on) => {
    const next = !on;
    window.localStorage.setItem('ade.graph.diffColors', next ? 'on' : 'off');
    return next;
  }), []);
  useEffect(() => { setApprovalOpen(false); }, [pendingApproval?.id]);
  // The expanded banner shows the validated commits behind the approval.
  useEffect(() => {
    setApprovalDiff(null);
    if (!approvalOpen || !pendingApproval) return;
    let live = true;
    void window.ade.invoke('run:approvalDiff', { runId: pendingApproval.runId })
      .then((diff) => { if (live) setApprovalDiff(diff); })
      .catch(() => { if (live) setApprovalDiff({ runId: pendingApproval.runId, entries: [] }); });
    return () => { live = false; };
  }, [approvalOpen, pendingApproval]);
  const canvasRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const toastTimer = useRef<number | undefined>(undefined);
  const deleteArmTimer = useRef<number | undefined>(undefined);
  const anchorsRef = useRef<Record<string, { top: Pos; bot: Pos }>>({});
  const lastSeenSeqRef = useRef<number | null>(null);
  const taskStatusRef = useRef<Map<string, string>>(new Map());
  const prefersReducedMotion = useMemo(
    () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
    [],
  );

  const flash = useCallback((message: string) => {
    setToast(message);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2_400);
  }, []);
  const openNewRun = useCallback(() => {
    select(null);
    setShowNewRun(true);
  }, [select]);

  const errorText = (error: unknown): string =>
    error instanceof Error ? error.message : String(error);

  // The arming state belongs to exactly one run; switching runs disarms it.
  useEffect(() => {
    setDeleteArmed(false);
    window.clearTimeout(deleteArmTimer.current);
  }, [activeRunId]);

  const deleteBlocked = Boolean(activeRun && (
    (activeRun.mode === 'managed' && activeRun.status === 'running')
    || workspaceLeases.some((lease) => lease.runId === activeRun.id && lease.status === 'active')
    || publications.some((publication) => publication.runId === activeRun.id)
  ));

  const requestDeleteRun = useCallback(() => {
    const state = useRuns.getState();
    const run = state.runs.find((candidate) => candidate.id === state.activeRunId);
    if (!run) return;
    if (!deleteArmed) {
      setDeleteArmed(true);
      window.clearTimeout(deleteArmTimer.current);
      deleteArmTimer.current = window.setTimeout(() => setDeleteArmed(false), 4_000);
      return;
    }
    window.clearTimeout(deleteArmTimer.current);
    setDeleteArmed(false);
    void deleteRun(run.id)
      .then(() => {
        clearRunPositions(run.id);
        flash(translate("Run \"{{value1}}\" deleted", { value1: run.name }));
      })
      .catch((error) => flash(errorText(error)));
  }, [deleteArmed, deleteRun, clearRunPositions, flash]);

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

  // Drop a stale selection when its run/participant left the visible clusters.
  useEffect(() => {
    if (!selection) return;
    const exists = clusters.some((cluster) =>
      cluster.orchestrator?.id === selection.id
      || cluster.teams.some((team) => team.id === selection.id
        || team.lead?.id === selection.id
        || team.workers.some((worker) => worker.id === selection.id)));
    if (!exists) select(null);
  }, [clusters, selection, select]);

  /* ------------------------------------------------------------- layout */

  const autoLayout = useMemo(() => {
    const clusterPositions: Record<string, Pos> = {};
    const nodePositions: Record<string, Record<string, Pos>> = {};
    let x = 90;
    for (const cluster of clusters) {
      clusterPositions[cluster.run.id] = { x, y: 70 };
      const width = clusterWidth(cluster);
      const nodes: Record<string, Pos> = {
        orchestrator: { x: width / 2 - ORCH_W / 2, y: ORCH_Y },
      };
      let teamX = CLUSTER_PAD;
      for (const team of cluster.teams) {
        nodes[team.id] = { x: teamX, y: TEAM_Y };
        teamX += teamWidth(1 + team.workers.length) + TEAM_GAP_IN;
      }
      nodePositions[cluster.run.id] = nodes;
      x += width + CLUSTER_GAP;
    }
    return { clusterPositions, nodePositions };
  }, [clusters]);

  const clusterPos = useCallback((runId: string): Pos => (
    positions[`cluster:${runId}`]
    ?? autoLayout.clusterPositions[runId]
    ?? { x: 90, y: 70 }
  ), [positions, autoLayout]);

  const nodePos = useCallback((runId: string, key: string): Pos => (
    positions[`${runId}:${key}`]
    ?? autoLayout.nodePositions[runId]?.[key]
    ?? { x: CLUSTER_PAD, y: TEAM_Y }
  ), [positions, autoLayout]);

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

  /* -------------------------------------------------------- pan and zoom */

  const panRef = useRef<{ startX: number; startY: number; x: number; y: number } | null>(null);
  const onCanvasPointerDown = (event: React.PointerEvent): void => {
    const target = event.target as HTMLElement;
    if (target.closest('.gcard') || target.closest('.gteam-bar') || target.closest('.gcluster-bar')) return;
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
    setView((current) => zoomViewAt(current, event.deltaY < 0 ? 1.1 : 0.9, { x: event.clientX - rect.left, y: event.clientY - rect.top }, GRAPH_SCALE));
  };

  const zoomBy = (factor: number): void => setView((current) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    return zoomViewAt(current, factor, { x: (rect?.width ?? 800) / 2, y: (rect?.height ?? 600) / 2 }, GRAPH_SCALE);
  });

  const fitView = useCallback(() => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect || clusters.length === 0) return;
    let left = Number.POSITIVE_INFINITY;
    let right = Number.NEGATIVE_INFINITY;
    let top = Number.POSITIVE_INFINITY;
    let bottom = Number.NEGATIVE_INFINITY;
    for (const cluster of clusters) {
      const position = clusterPos(cluster.run.id);
      left = Math.min(left, position.x);
      right = Math.max(right, position.x + clusterWidth(cluster));
      top = Math.min(top, position.y);
      bottom = Math.max(bottom, position.y + CLUSTER_H);
    }
    const padding = 70;
    const width = Math.max(320, right - left);
    const height = Math.max(320, bottom - top);
    const scale = Math.min(1.1, Math.max(0.3, Math.min(
      (rect.width - padding * 2) / width,
      (rect.height - padding * 2 - 60) / height,
    )));
    setView({
      scale,
      x: (rect.width - width * scale) / 2 - left * scale,
      // Centre vertically when there is spare room (large/fullscreen windows),
      // otherwise keep the classic top padding anchor.
      y: Math.max(padding, (rect.height - height * scale) / 2) - top * scale,
    });
  }, [clusters, clusterPos]);

  // Fullscreen toggle / window resize: refit so the content uses the new
  // canvas size instead of staying in the old viewport's corner.
  useEffect(() => {
    let timer: number | undefined;
    const onResize = (): void => {
      window.clearTimeout(timer);
      timer = window.setTimeout(fitView, 160);
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('resize', onResize);
    };
  }, [fitView]);

  useEffect(() => {
    const frame = requestAnimationFrame(fitView);
    return () => cancelAnimationFrame(frame);
    // Refit only when the visible cluster set changes, not on every drag.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clusters.length]);

  /* ------------------------------------------------------------ dragging */

  const startDrag = (
    kind: 'cluster' | 'node',
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
        // with the node (renderCluster bounding box), never left/up.
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

  const isSelected = (candidate: GraphSelection): boolean => Boolean(
    selection && selection.kind === candidate.kind && selection.id === candidate.id,
  );

  /**
   * Keyboard path for canvas nodes (cards, team bars, cluster bars): Enter or
   * Space selects; Enter on an already selected, available card opens its
   * terminal like a double-click. Escape on the canvas clears the selection.
   */
  const nodeKeyHandler = (
    onSelect: () => void,
    selected: boolean,
    onActivate?: () => void,
  ) => (event: React.KeyboardEvent): void => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === 'Enter' && selected && onActivate) onActivate();
    else onSelect();
  };
  const onGraphKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    if (reportOpen) {
      setReportOpen(false);
      return;
    }
    if (selection) {
      event.preventDefault();
      select(null);
    }
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

  /* ------------------------------------------------------------ rendering */

  const renderCard = (
    cluster: RunClusterModel,
    team: TeamModel,
    member: GraphMember,
    role: 'lead' | 'worker',
  ): JSX.Element => {
    const runtime = runtimeVisual(member.runtime);
    const status = nodeStatus(cluster, member, team.idle);
    const selected = isSelected({ kind: role, id: member.id });
    const flashClass = flashes[member.id] ? ` gflash-${flashes[member.id]}` : '';
    const branch = member.available ? branchFor(cluster.run, member.agentId) : null;
    const selectCard = (): void => selectInCluster(cluster.run.id, { kind: role, id: member.id, teamId: team.id });
    const openCard = (): void => {
      if (member.available) void openParticipantTerminal(member.agentId, member.id, cluster.run.id);
    };
    return (
      <div
        key={member.id}
        className={`gcard gcard-static${selected ? ' sel' : ''}${member.available ? '' : ' unavailable'}${flashClass}`}
        data-status={status}
        role="button"
        tabIndex={0}
        aria-pressed={selected}
        aria-label={`${role === 'lead' ? translate("Lead") : translate("Worker")} ${member.name} · ${team.name} · ${cluster.run.name} · ${member.available ? statusText(status) : translate("Not in the catalogue")}`}
        style={{ ['--rt' as string]: runtime.color }}
        onClick={(event) => {
          event.stopPropagation();
          selectCard();
        }}
        onDoubleClick={(event) => {
          event.stopPropagation();
          openCard();
        }}
        onKeyDown={nodeKeyHandler(selectCard, selected, openCard)}
      >
        <div className="gcard-bar nograb">
          <div className="glights"><i className="r" /><i className="y" /><i className="g" /></div>
          <div className="gcard-title">~ {role}</div>
        </div>
        <div className="gcard-body">
          <div className="gcard-role">~ {role}</div>
          <div className="gglyph"><runtime.Glyph /></div>
          <div className="gcard-name">{member.name}</div>
          {branch && <div className="gcard-branch" title={translate("Worktree branch {{value1}}", { value1: branch })}>⎇ {branch}</div>}
          <div className="gchip" data-s={member.available ? status : 'failed'}>
            {member.available ? statusText(status) : translate("Not in the catalogue")}
          </div>
        </div>
        <i className="ganchor top" data-anchor={`${member.id}:top`} />
        <i className="ganchor bot" data-anchor={`${member.id}:bot`} />
      </div>
    );
  };

  const renderCluster = (cluster: RunClusterModel): JSX.Element => {
    const { run } = cluster;
    const position = clusterPos(run.id);
    // The frame is the bounding box of its (freely draggable) children, so a
    // dragged card or team grows the frame instead of escaping it.
    const orchestratorBounds = nodePos(run.id, 'orchestrator');
    const width = Math.max(
      clusterWidth(cluster),
      orchestratorBounds.x + ORCH_W + CLUSTER_PAD,
      ...cluster.teams.map((team) =>
        nodePos(run.id, team.id).x + teamWidth(1 + team.workers.length) + CLUSTER_PAD),
    );
    const height = Math.max(
      CLUSTER_H,
      orchestratorBounds.y + 210 + CLUSTER_PAD,
      ...cluster.teams.map((team) => nodePos(run.id, team.id).y + 236 + CLUSTER_PAD),
    );
    const repository = run.repositoryId
      ? repositories.find((candidate) => candidate.id === run.repositoryId)
      : null;
    const usage = usageByRun[run.id];
    const orchestrator = cluster.orchestrator;
    const orchestratorRuntime = runtimeVisual(orchestrator?.runtime ?? 'claude');
    const orchestratorPosition = nodePos(run.id, 'orchestrator');
    const orchestratorSelected = orchestrator
      ? isSelected({ kind: 'orchestrator', id: orchestrator.id })
      : false;
    const orchestratorFlash = orchestrator && flashes[orchestrator.id]
      ? ` gflash-${flashes[orchestrator.id]}`
      : '';
    return (
      <section
        key={run.id}
        className={`gcluster${run.id === activeRunId ? ' active' : ''}${cluster.terminal ? ' terminal' : ''}`}
        data-run-id={run.id}
        style={{ left: position.x, top: position.y, width, height }}
      >
        <header
          className="gcluster-bar"
          role="button"
          tabIndex={0}
          aria-pressed={run.id === activeRunId}
          aria-label={`Run ${run.name} · ${runStatusText(run.status)}${run.id === activeRunId ? translate(" · Selected") : ''}`}
          onPointerDown={(event) => startDrag('cluster', run.id, 'cluster', event, () => {
            selectInCluster(run.id, null);
          })}
          onKeyDown={nodeKeyHandler(() => selectInCluster(run.id, null), run.id === activeRunId)}
        >
          <b>{run.name}</b>
          <span className="gcluster-chip" data-s={run.status}>{runStatusText(run.status)}</span>
          {run.mode === 'managed' && run.status === 'running' && (
            <span className="gcluster-phase">{phaseText(run.phase)}</span>
          )}
          <span className="gcluster-repo">
            {repository?.name ?? (run.repositoryId === undefined ? translate("Legacy default") : translate("Portable homes"))}
          </span>
          <span className="gcluster-grow" />
          {pendingApprovalRunIds.has(run.id) && (
            <span className="gcluster-approval">{translate("Approval required")}</span>
          )}
          <span className="gcluster-counts">
            {cluster.runningTaskCount > 0 && translate("{{value1}} active", { value1: cluster.runningTaskCount })}
            {cluster.runningTaskCount > 0 && cluster.queuedTaskCount > 0 && ' · '}
            {cluster.queuedTaskCount > 0 && translate("{{value1}} waiting", { value1: cluster.queuedTaskCount })}
            {cluster.runningTaskCount === 0 && cluster.queuedTaskCount === 0 && usage
              && `Tokens ${usage.inputTokens + usage.outputTokens}`}
          </span>
        </header>

        {orchestrator && (
          <div
            className={`gcard orch${orchestratorSelected ? ' sel' : ''}${orchestrator.available ? '' : ' unavailable'}${orchestratorFlash}`}
            data-status={nodeStatus(cluster, orchestrator, false)}
            role="button"
            tabIndex={0}
            aria-pressed={orchestratorSelected}
            aria-label={`Orchestrator ${orchestrator.name} · ${run.name} · ${orchestrator.available ? statusText(nodeStatus(cluster, orchestrator, false)) : translate("Not in the catalogue")}`}
            style={{
              left: orchestratorPosition.x,
              top: orchestratorPosition.y,
              ['--rt' as string]: orchestratorRuntime.color,
            }}
            onClick={(event) => {
              event.stopPropagation();
              selectInCluster(run.id, { kind: 'orchestrator', id: orchestrator.id });
            }}
            onDoubleClick={(event) => {
              event.stopPropagation();
              if (orchestrator.available) {
                void openParticipantTerminal(orchestrator.agentId, orchestrator.id, run.id);
              }
            }}
            onKeyDown={nodeKeyHandler(
              () => selectInCluster(run.id, { kind: 'orchestrator', id: orchestrator.id }),
              orchestratorSelected,
              () => {
                if (orchestrator.available) {
                  void openParticipantTerminal(orchestrator.agentId, orchestrator.id, run.id);
                }
              },
            )}
          >
            <div
              className="gcard-bar"
              onPointerDown={(event) => startDrag('node', run.id, 'orchestrator', event, () => {
                selectInCluster(run.id, { kind: 'orchestrator', id: orchestrator.id });
              })}
            >
              <div className="glights"><i className="r" /><i className="y" /><i className="g" /></div>
              <div className="gcard-title">{translate("ade · orchestrator")}</div>
            </div>
            <div className="gcard-body">
              <div className="gglyph"><orchestratorRuntime.Glyph /></div>
              <div className="gcard-name">{orchestrator.name}</div>
              {orchestrator.available && branchFor(run, orchestrator.agentId) && (
                <div className="gcard-branch" title={translate("Worktree branch {{value1}}", { value1: branchFor(run, orchestrator.agentId) })}>
                  ⎇ {branchFor(run, orchestrator.agentId)}
                </div>
              )}
              <div className="gchip" data-s={orchestrator.available ? nodeStatus(cluster, orchestrator, false) : 'failed'}>
                {orchestrator.available ? statusText(nodeStatus(cluster, orchestrator, false)) : translate("Not in the catalogue")}
              </div>
            </div>
            <i className="ganchor top" data-anchor={`${orchestrator.id}:top`} />
            <i className="ganchor bot" data-anchor={`${orchestrator.id}:bot`} />
          </div>
        )}

        {cluster.teams.map((team) => {
          const teamPosition = nodePos(run.id, team.id);
          const selected = isSelected({ kind: 'team', id: team.id });
          const managed = run.mode === 'managed';
          return (
            <div
              key={team.id}
              className={`gteam${team.idle ? ' idle' : ''}${selected ? ' sel' : ''}`}
              style={{ left: teamPosition.x, top: teamPosition.y }}
            >
              <div
                className="gteam-bar"
                role="button"
                tabIndex={0}
                aria-pressed={selected}
                aria-label={`Team ${team.name} · ${run.name} · ${statusText(team.status)}${team.idle ? translate(" · paused") : ''}`}
                onPointerDown={(event) => startDrag('node', run.id, team.id, event, () => {
                  selectInCluster(run.id, { kind: 'team', id: team.id });
                })}
                onKeyDown={nodeKeyHandler(() => selectInCluster(run.id, { kind: 'team', id: team.id }), selected)}
              >
                <div className="glights"><i className="r" /><i className="y" /><i className="g" /></div>
                <div className="gteam-tt">{translate("team ·")}{" "}<b>{team.name}</b></div>
                {team.idle && (
                  <span className="gteam-paused">{managed ? translate("paused") : translate("paused manually")}</span>
                )}
                <div className="gteam-grow" />
                <div
                  className="gteam-actions"
                  onPointerDown={(event) => event.stopPropagation()}
                  onKeyDown={(event) => event.stopPropagation()}
                >
                  <button
                    className="gtbtn"
                    disabled={cluster.terminal}
                    aria-label={managed
                      ? (team.idle ? translate("Continue scheduling") : translate("Pause scheduling"))
                      : (team.idle ? translate("Reactivate manual dispatch") : translate("Pause manually"))}
                    title={managed
                      ? (team.idle ? translate("Continue scheduling") : translate("Pause scheduling (running tasks continue)"))
                      : (team.idle ? translate("Reactivate manual dispatch") : translate("Manually pause (dispatch only)"))}
                    onClick={() => {
                      if (managed) {
                        void setTeamPause(run.id, team.id, !team.idle)
                          .then(() => flash(team.idle ? translate("Team scheduling continues") : translate("Team scheduling paused")))
                          .catch((error) => flash(errorText(error)));
                      } else {
                        setTeamIdle(team.id, !team.idle);
                      }
                    }}
                  >
                    <Ico>{team.idle ? I.play : I.pause}</Ico>
                  </button>
                  <button
                    className="gtbtn"
                    title={translate("Stop ongoing team tasks")}
                    aria-label={translate("Stop ongoing team tasks")}
                    onClick={() => void cancelTeamTasks(team.id).then(() => flash(translate("Team tasks stopped")))}
                  >
                    <Ico>{I.stop}</Ico>
                  </button>
                </div>
              </div>
              <div className="gteam-members">
                {team.lead && renderCard(cluster, team, team.lead, 'lead')}
                {team.workers.map((worker) => renderCard(cluster, team, worker, 'worker'))}
              </div>
            </div>
          );
        })}
      </section>
    );
  };

  const slotRows = clusters.filter(
    (cluster) => cluster.runningTaskCount > 0 || cluster.queuedTaskCount > 0,
  );

  const sortedRuns = [...runs].sort((a, b) => b.updatedAt - a.updatedAt);
  const openRuns = sortedRuns.filter((run) => !['completed', 'failed', 'cancelled'].includes(run.status));
  const endedRuns = sortedRuns.filter((run) => ['completed', 'failed', 'cancelled'].includes(run.status));
  const runOption = (run: Run): JSX.Element => (
    <option key={run.id} value={run.id}>
      {run.name} · {runStatusText(run.status)}
    </option>
  );

  return (
    <div className={`graph${selection ? ' graph-inspecting' : ''}`} onKeyDown={onGraphKeyDown}>
      <DesktopSupervisionGraph />
      <div className="grunbar" aria-label={translate("Run bar")}>
        <div className="grun-group grun-run" role="group" aria-label={translate("Run")}>
        <select
          aria-label={translate("Active Run")}
          value={activeRunId ?? ''}
          onChange={(event) => setActiveRun(event.target.value || null)}
          disabled={runs.length === 0}
        >
          {runs.length === 0 && <option value="">{translate("No run")}</option>}
          {openRuns.length > 0 && endedRuns.length > 0
            ? (
                <>
                  <optgroup label={translate("Active")}>{openRuns.map(runOption)}</optgroup>
                  <optgroup label={translate("Finished [4265656e]")}>{endedRuns.map(runOption)}</optgroup>
                </>
              )
            : sortedRuns.map(runOption)}
        </select>
        {activeRun && (
          <>
            <span className="grun-status" data-s={activeRun.status}>{runStatusText(activeRun.status)}</span>
            {activeRun.mode === 'managed' && (
              <span className="grun-phase">{phaseText(activeRun.phase)}</span>
            )}
            <span className="grun-repo" title={activeRepository?.rootPath}>
              {activeRepository?.name ?? (activeRun.repositoryId === undefined ? translate("Legacy default") : translate("Portable homes"))}
            </span>
            <span className="grun-goal" title={activeRun.goal || activeRun.name}>
              {activeRun.goal || translate("No run target stored")}
            </span>
            <span className="grun-counts">
              {activeRunTasks.length}{" "}{translate("Tasks")}{activeUsage && ` · Tokens ${activeUsage.inputTokens + activeUsage.outputTokens}`}
              {activeRun.mode === 'managed' && ` · Parallel ≤${activeRun.budget.maxConcurrentTasks}`}
              {activeRun.mode === 'managed' && activeRun.budget.maxTaskMinutes !== null &&
                ` · ≤${activeRun.budget.maxTaskMinutes} min/Task`}
              {activeUsage && translate(" · Approvals {{value1}}/{{value2}}", { value1: activeUsage.approvals, value2: activeRun.budget.maxApprovals })}
              {activeRun.budget.maxCostUsd !== null && activeUsage &&
                ` · $${activeUsage.costUsd.toFixed(2)}/$${activeRun.budget.maxCostUsd.toFixed(2)}`}
            </span>
          </>
        )}
        </div>
        <div className="grun-group grun-results" role="group" aria-label={translate("Results")}>
        {activeRun && <span className="grun-caption" aria-hidden="true">{translate("Results")}</span>}
        {activeRun && (
          <button
            ref={reportButtonRef}
            className={`grun-report${reportOpen ? ' active' : ''}`}
            aria-pressed={reportOpen}
            title={translate("Full report: files, tests with output, risks, commits")}
            onClick={() => setReportOpen((open) => !open)}
          >
            <Ico>{I.report}</Ico>{translate("Report")}</button>
        )}
        {pendingQuestions > 0 && <button className="grun-report" onClick={() => setReportOpen(true)} aria-label={translate("Answer {{value1}} questions", { value1: pendingQuestions })}>{translate("Questions (")}{pendingQuestions})</button>}
        {activeRun?.mode === 'managed' && activeRun.status === 'completed' && activeRun.repositoryId && (
          <button
            className="grun-publish"
            title={translate("Publish Verified ADE Branch as GitHub Draft Pull Request")}
            onClick={() => setPublicationRun(activeRun)}
          >
            <Ico>{I.publish}</Ico>
            {publications.some((publication) =>
              publication.runId === activeRun.id && publication.status === 'draft')
              ? translate("View draft PR")
              : translate("Draft PR")}
          </button>
        )}
        </div>
        <div className="grun-group grun-rare" role="group" aria-label={translate("Rare and final")}>
        <button type="button" className="btn btn-quiet" data-open-git-sync disabled={repositories.length === 0} onClick={() => setShowGitSync(true)}>{translate("Git sync")}</button>
        {activeRun && (
          <button
            className={`grun-delete${deleteArmed ? ' armed' : ''}`}
            disabled={deleteBlocked}
            title={deleteBlocked
              ? translate("Active or published run cannot be deleted")
              : translate("Delete \"{{value1}}\" with all tasks, events and artifacts", { value1: activeRun.name })}
            onClick={requestDeleteRun}
          >
            <Ico>{I.trash}</Ico>{deleteArmed ? translate("Really delete?") : translate("Delete the run")}
          </button>
        )}
        </div>
        <button className="grun-new" onClick={openNewRun}>
          <Ico>{I.plus}</Ico>{translate("New Run")}</button>
      </div>

      {activeRunFailure && !reportOpen && (
        <div className="grun-failure" role="alert">
          <div className="grun-failure-head">
            <b>{translate("Run failed")}</b>
            <span title={activeRunFailure.context}>{activeRunFailure.context}</span>
            <button type="button" className="grun-failure-report" onClick={() => setReportOpen(true)}>
              {translate("Open report")}</button>
          </div>
          <div className="grun-failure-body">
            <p>{activeRunFailure.detail}</p>
            {activeRunFailure.failedTests.length > 0 && (
              <ul className="grun-failure-tests" aria-label={translate("Failed tests")}>
                {activeRunFailure.failedTests.map((command) => <li key={command}><code>{command}</code></li>)}
              </ul>
            )}
          </div>
        </div>
      )}

      {pendingApproval && (
        <div className={`gapproval${approvalOpen ? ' open' : ''}`} role="status">
          <div className="gapproval-row">
            <div
              role="button"
              tabIndex={0}
              aria-expanded={approvalOpen}
              title={approvalOpen ? translate("Collapse") : translate("Click for text and diff of the changes")}
              onClick={() => setApprovalOpen((open) => !open)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  setApprovalOpen((open) => !open);
                }
              }}
            >
              <b>{translate("Integration is awaiting approval")}{" "}{approvalOpen ? '▾' : '▸'}</b>
              <span>{pendingApproval.reason}</span>
            </div>
            <button
              className="gact"
              onClick={() => void resolveApproval(pendingApproval.id, 'reject')
                .then(() => flash('Integration abgelehnt'))
                .catch((error) => flash(errorText(error)))}
            >
              {translate("Reject")}</button>
            <button
              className="gact primary"
              onClick={() => void resolveApproval(pendingApproval.id, 'approve')
                .then(() => flash(translate("Integration approved")))
                .catch((error) => flash(errorText(error)))}
            >
              {translate("Approve & integrate")}</button>
          </div>
          {approvalOpen && (
            <div className="gapproval-diff">
              {!approvalDiff && <span className="gapproval-note">{translate("Loading changes…")}</span>}
              {approvalDiff && approvalDiff.entries.length === 0 && (
                <span className="gapproval-note">{translate("No validated commits found.")}</span>
              )}
              {approvalDiff && approvalDiff.entries.length > 0 && (
                <div className="gapproval-diff-tools">
                  <button type="button" className="gact" onClick={toggleDiffColors}>
                    {translate("Diff colours:")}{" "}{diffColors ? translate('On') : translate('Off')}
                  </button>
                </div>
              )}
              {approvalDiff?.entries.map((entry) => {
                const lines = diffColors ? entry.diff.split('\n') : null;
                return (
                  <div key={entry.commitSha} className="gapproval-commit">
                    <div className="gapproval-commit-head">
                      <b>{entry.participantName}</b>
                      <span>⎇ {entry.branch}</span>
                      <code>{entry.commitSha.slice(0, 10)}</code>
                      <span>{entry.title}</span>
                    </div>
                    <ul className="gapproval-files">
                      {entry.files.map((file) => (
                        <li key={file.path}>
                          <code>{file.path}</code>
                          <span className="add">+{file.additions}</span>
                          <span className="del">−{file.deletions}</span>
                        </li>
                      ))}
                    </ul>
                    <pre className={`gapproval-patch${diffColors ? ' colored' : ''}`}>
                      {lines
                        ? lines.slice(0, DIFF_RENDER_LINE_CAP).map((line, index) => (
                            <span key={index} className={diffLineClass(line)}>{line}{'\n'}</span>
                          ))
                        : entry.diff}
                      {lines && lines.length > DIFF_RENDER_LINE_CAP
                        && translate("... {{value1}} more lines (switch monochrome for everything)", { value1: lines.length - DIFF_RENDER_LINE_CAP })}
                    </pre>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      <div ref={canvasRef} className="graph-canvas" onPointerDown={onCanvasPointerDown} onWheel={onWheel}>
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

          {clusters.map(renderCluster)}
        </div>
      </div>

      {runsLoaded && runs.length === 0 && (
        <div className="gempty">
          <h2>{translate("No run yet")}</h2>
          <p>{translate("For a specific goal, put together a team of existing agents.")}</p>
          <button className="gact primary" onClick={openNewRun}>
            <Ico>{I.plus}</Ico>{translate("Create first run")}</button>
        </div>
      )}

      {reportOpen && activeRunId && (
        <RunReportPanel
          runId={activeRunId}
          seqCursor={seqCursor}
          fallbackFocusRef={reportButtonRef}
          onClose={() => setReportOpen(false)}
        />
      )}

      <Inspector
        clusters={clusters}
        selection={selection}
        onClose={() => select(null)}
        onCompose={setComposer}
        setTeamIdle={setTeamIdle}
        flash={flash}
        onShowInDock={(target, title) => setDock({ ...target, title })}
      />

      {dock && (
        <div
          className="gdockpanel"
          style={dockPos
            ? { height: dockHeight, left: dockPos.x, top: dockPos.y, width: dockPos.w, right: 'auto', bottom: 'auto' }
            : { height: dockHeight }}
        >
          <div className="gdockpanel-resize" title={translate("Adjust height")} onPointerDown={startDockResize} />
          <div className="gdockpanel-bar" title={translate("Drag the bar to move")} onPointerDown={startDockDrag}>
            <Ico>{I.grip}</Ico>
            <b>{dock.title}</b>
            <span>
              {dock.sessionId
                ? (dockRaw ? translate("Raw terminal · only read") : translate("Live activity · Read only"))
                : translate("Recorded Activity · Read only")}
            </span>
            <span className="gdockpanel-grow" />
            {dockPos && (
              <button
                type="button"
                aria-label={translate("Dock at the bottom again")}
                title={translate("Dock at the bottom again")}
                onClick={() => {
                  setDockPos(null);
                  window.localStorage.removeItem('ade.graph.dockPos');
                }}
              >
                <Ico>{I.dockDown}</Ico>
              </button>
            )}
            {dock.sessionId && (
              <button
                type="button"
                className="gdockpanel-text"
                aria-pressed={dockRaw}
                title={dockRaw ? translate("Show readable activity") : translate("Show raw terminal output")}
                onClick={() => setDockRaw((raw) => !raw)}
              >
                {dockRaw ? translate("Readable") : translate("Raw")}
              </button>
            )}
            <button type="button" aria-label={translate("Close panel")} title={translate("Close panel")} onClick={() => setDock(null)}><Ico>{I.close}</Ico></button>
          </div>
          {dockRaw && dock.sessionId ? (
            <SessionTail
              sessionId={dock.sessionId}
              rows={22}
              cols={180}
              fontSize={12}
              scrollback={3000}
              fit
              className="gdockpanel-term"
            />
          ) : (
            <ActivityFeed sessionId={dock.sessionId} taskId={dock.taskId} />
          )}
        </div>
      )}

      <div className="gslots" role="status" title={translate("Global task slots: one queue across all runs")}>
        <button
          type="button"
          className="gslots-head"
          aria-expanded={slotsOpen}
          disabled={slotRows.length === 0}
          onClick={() => setSlotsOpen((open) => !open)}
        >
          {translate("Task slots")}{" "}{taskQueue.active}/{taskQueue.maxActive}
          {taskQueue.queued > 0 && translate(" · {{value1}} queued", { value1: taskQueue.queued })}
        </button>
        {slotsOpen && slotRows.map((cluster) => (
          <div key={cluster.run.id} className="gslots-row">
            <span>{cluster.run.name}</span>
            <span>
              {cluster.runningTaskCount}{" "}{translate("Active [616b7469]")}{cluster.queuedTaskCount > 0 && translate(" · {{value1}} waiting", { value1: cluster.queuedTaskCount })}
            </span>
          </div>
        ))}
      </div>

      <div className="gzoom" role="group" aria-label={translate("View")}>
        <button type="button" aria-label={translate("Zoom out [5665726b]")} title={translate("Zoom out [5665726b]")} onClick={() => zoomBy(0.87)}><Ico>{I.minus}</Ico></button>
        <output className="gzoom-level" aria-label={translate("Zoom level")}>{Math.round(view.scale * 100)}%</output>
        <button type="button" aria-label={translate("Zoom in [56657267]")} title={translate("Zoom in [56657267]")} onClick={() => zoomBy(1.15)}><Ico>{I.plus}</Ico></button>
        <button type="button" aria-label={translate("Fit view")} title={translate("Fit view")} onClick={fitView}><Ico>{I.fit}</Ico></button>
      </div>

      {activeRun && activeCluster && (
        <div className="gdock" role="group" aria-label={translate("Run control for {{value1}}", { value1: activeRun.name })}>
          <span className="gdock-caption" title={activeRun.name}>{translate("Run control")}</span>
          <div className="sep" />
          {activeRun.mode === 'manual' && activeRun.status === 'draft' && (
            <button
              className="gdbtn accent"
              disabled={!activeRun.goal.trim() || !activeCluster.orchestrator || activeCluster.teams.length === 0}
              title={translate("Plans separate worker jobs and integrates only after approval")}
              onClick={() => void startRun(activeRun.id)
                .then(() => flash(translate("Orchestration started")))
                .catch((error) => flash(errorText(error)))}
            >
              <Ico>{I.play}</Ico>{translate("Start orchestration")}</button>
          )}
          {activeRun.mode === 'manual' && (
            <>
              <button
                className="gdbtn"
                disabled={activeCluster.teams.length === 0}
                onClick={() => setComposer({ kind: 'all', workerCount: activeWorkerCount(activeCluster) })}
              >
                <Ico>{I.arrow}</Ico>{translate("Directly to teams")}</button>
              <button
                className="gdbtn"
                title={translate("Manual break: affects only the dispatch from the canvas")}
                onClick={() => activeCluster.teams.forEach((team) => setTeamIdle(team.id, true))}
              >
                <Ico>{I.pause}</Ico>{translate("Pause all")}</button>
              <button className="gdbtn" onClick={() => activeCluster.teams.forEach((team) => setTeamIdle(team.id, false))}>
                <Ico>{I.play}</Ico>{translate("Activate everyone")}</button>
            </>
          )}
          {activeRun.mode === 'managed' && activeRun.status === 'running' && (
            <button
              className="gdbtn danger"
              onClick={() => void cancelRun(activeRun.id)
                .then(() => flash(translate("Orchestration is stopped")))
                .catch((error) => flash(errorText(error)))}
            >
              <Ico>{I.stop}</Ico>{translate("Cancel run")}</button>
          )}
          {activeRun.mode === 'manual'
            && activeRunTasks.some((task) => task.status === 'queued' || task.status === 'running') && (
            <button className="gdbtn danger" onClick={() => void cancelAllTasks().then(() => flash(translate("Run tasks stopped")))}>
              <Ico>{I.stop}</Ico>{translate("Stop Tasks")}</button>
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
                ? translate("{{value1}} started, {{value2}} failed", { value1: result.started, value2: result.failed })
                : translate("{{value1}} task sessions started", { value1: result.started }));
            } else if (target.kind === 'team') {
              const result = await dispatchTeam(target.id, text, options);
              flash(result.failed
                ? translate("{{value1}} started, {{value2}} failed", { value1: result.started, value2: result.failed })
                : translate('Task distributed to {{name}}', { name: target.name }));
            } else {
              const result = await dispatchAgent(target.id, text);
              flash(result.failed ? translate("Task for {{value1}} failed", { value1: target.name }) : translate("Task sent to {{value1}}", { value1: target.name }));
            }
          }}
        />
      )}

      {showGitSync && <RepositorySyncModal repositoryId={activeRepository?.id} onClose={() => setShowGitSync(false)} />}
      {showNewRun && (
        <NewRunModal
          categories={categories}
          agents={agents}
          repositories={repositories}
          suggestedName={`Run ${runs.length + 1}`}
          onCancel={() => setShowNewRun(false)}
          onCreate={async (input) => {
            const run = await createRun(input);
            setShowNewRun(false);
            flash(translate("{{value1}} created", { value1: run.name }));
          }}
        />
      )}

      {publicationRun && (
        <PublicationModal
          run={publicationRun}
          existing={publications.find((publication) => publication.runId === publicationRun.id) ?? null}
          preview={previewPublication}
          publish={publishRun}
          onCancel={() => setPublicationRun(null)}
          onPublished={(publication) => flash(translate("Draft PR #{{value1}} created", { value1: publication.prNumber ?? '' }))}
        />
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- inspector */

interface InspectorProps {
  clusters: RunClusterModel[];
  selection: GraphSelection | null;
  onClose: () => void;
  onCompose: (target: ComposerTarget) => void;
  setTeamIdle: (teamId: string, idle: boolean) => void;
  flash: (message: string) => void;
  onShowInDock: (target: { sessionId?: string; taskId?: string }, title: string) => void;
}

interface ParticipantDetails {
  taskTitle: string | null;
  taskStatus: string | null;
  /** Latest task id when that task already ended — target for the archived feed. */
  archivedTaskId: string | null;
  attempt: number;
  result: RunTaskResult | null;
  provenance: TaskProvenance | null;
}

function Inspector(props: InspectorProps): JSX.Element | null {
  useLocale();
  const tasks = useRuns((state) => state.tasks);
  const results = useRuns((state) => state.results);
  const workspaceLeases = useRuns((state) => state.workspaceLeases);
  const busy = useGraphStore((state) => state.busy);
  const sessions = useSessions((state) => state.sessions);
  const orderByAgent = useSessions((state) => state.orderByAgent);
  const { clusters, selection } = props;
  if (!selection) return null;

  const cluster = clusters.find((candidate) =>
    candidate.orchestrator?.id === selection.id
    || candidate.teams.some((team) => team.id === selection.id
      || team.lead?.id === selection.id
      || team.workers.some((worker) => worker.id === selection.id)));
  if (!cluster) return null;
  const managed = cluster.run.mode === 'managed';
  const canDirectDispatch = cluster.run.mode === 'manual' && !cluster.terminal;

  const errorText = (error: unknown): string =>
    error instanceof Error ? error.message : String(error);

  const memberStatus = (member: GraphMember, idle: boolean): NodeStatus => statusFor(
    member.id,
    member.agentId,
    {
      idle,
      busy,
      sessions: { sessions, orderByAgent },
      tasks: tasks.filter((task) => task.runId === cluster.run.id),
    },
  );

  /** Sanitized detail block: titles, counts and versions only — never prompts or paths. */
  /**
   * Running task session of a participant — the live view target. Managed task
   * PTYs are spawned by main, so they never enter the renderer's session store
   * (which only hydrates from pty:list). The journal-backed task record is the
   * authority: it carries the session id and its live status.
   */
  const liveSessionIdFor = (participantId: string): string | null => {
    const live = tasks
      .filter((task) => task.runId === cluster.run.id
        && task.participantId === participantId
        && task.status === 'running'
        && task.sessionId)
      .sort((a, b) => b.updatedAt - a.updatedAt)[0];
    return live?.sessionId ?? null;
  };

  const leaseActiveFor = (participantId: string): boolean => workspaceLeases.some(
    (lease) => lease.runId === cluster.run.id
      && lease.participantId === participantId
      && lease.status === 'active',
  );

  /** "Session öffnen" während aktiver Lease erklärt sich statt zu scheitern. */
  const openSessionProps = (available: boolean, participantId: string): {
    disabled: boolean;
    title?: string;
  } => (leaseActiveFor(participantId)
    ? {
        disabled: true,
        title: translate("Worktree is exclusively leased from the running run – use live view or wait for run end"),
      }
    : { disabled: !available });

  const detailsFor = (participantId: string): ParticipantDetails => {
    const latestTask = tasks
      .filter((task) => task.runId === cluster.run.id && task.participantId === participantId)
      .sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null;
    const latestResult = results
      .filter((result) => result.runId === cluster.run.id && result.participantId === participantId)
      .sort((a, b) => b.createdAt - a.createdAt)[0] ?? null;
    // Provenance is parsed once in main from the context packet; the artifact
    // body itself never reaches the renderer.
    const provenance: TaskProvenance | null = latestTask?.provenance ?? null;
    return {
      taskTitle: latestTask?.title ?? null,
      taskStatus: latestTask?.status ?? null,
      archivedTaskId: latestTask
        && ['completed', 'failed', 'cancelled'].includes(latestTask.status)
        ? latestTask.id
        : null,
      attempt: latestTask?.attempt ?? 1,
      result: latestResult,
      provenance,
    };
  };

  const detailRows = (details: ParticipantDetails): JSX.Element[] => {
    const rows: JSX.Element[] = [];
    if (details.taskTitle) {
      rows.push(<KV key="task" k="Task" v={details.taskTitle} />);
      rows.push(<KV
        key="taskStatus"
        k="Task-Status"
        v={`${taskStatusText(details.taskStatus ?? '')}${details.attempt > 1 ? translate(" · Attempt {{value1}}", { value1: details.attempt }) : ''}`}
      />);
    }
    const result = details.result;
    if (result) {
      rows.push(<KV key="outcome" k="Ergebnis" v={outcomeText(result.outcome)} />);
      if (result.usage.inputTokens !== null || result.usage.outputTokens !== null) {
        rows.push(<KV
          key="tokens"
          k="Tokens"
          v={`in ${result.usage.inputTokens ?? '?'} · out ${result.usage.outputTokens ?? '?'}`}
        />);
      }
    }
    if (details.provenance) {
      rows.push(<KV
        key="versions"
        k="Prompt/Schema"
        v={`v${details.provenance.promptVersion} / v${details.provenance.resultSchemaVersion}`}
      />);
      rows.push(<KV key="adapter" k="Adapter" v={details.provenance.adapterId} />);
      if (details.provenance.modelId) {
        rows.push(<KV key="model" k="Modell" v={details.provenance.modelId} />);
      }
      if (details.provenance.reasoningEffort) {
        rows.push(<KV key="reasoning" k="Reasoning" v={details.provenance.reasoningEffort} />);
      }
      if (details.provenance.contextManifestHash) {
        rows.push(<KV key="manifest" k="Manifest" v={details.provenance.contextManifestHash.slice(0, 10)} />);
      }
    }
    return rows;
  };

  const teamOf = (id: string): TeamModel | undefined => cluster.teams.find((team) => team.id === id);

  if (selection.kind === 'orchestrator') {
    const orchestrator = cluster.orchestrator;
    if (!orchestrator) return null;
    const runtime = runtimeVisual(orchestrator.runtime);
    const details = detailsFor(orchestrator.id);
    const liveSessionId = liveSessionIdFor(orchestrator.id);
    return (
      <aside className="ginspector">
        <Head glyph={<runtime.Glyph />} color={runtime.color} title={orchestrator.name} sub={`Orchestrator · ${cluster.run.name}`} onClose={props.onClose} />
        <div className="ginsp-body">
          <KV k="Runtime" v={runtime.label} />
          <KV k="Status" v={statusText(memberStatus(orchestrator, false))} />
          <KV k="Teams" v={String(cluster.teams.length)} />
          {detailRows(details)}
          {details.result && <ResultDetails result={details.result} idPrefix={`ginsp-${orchestrator.id}`} />}
          {liveSessionId && <ActivityFeed sessionId={liveSessionId} />}
        </div>
        <div className="ginsp-actions">
          {liveSessionId && (
            <button
              className="gact primary"
              onClick={() => props.onShowInDock({ sessionId: liveSessionId }, `${orchestrator.name} · Orchestrator · ${cluster.run.name}`)}
            >
              <Ico>{I.term}</Ico>{translate("Watch live")}</button>
          )}
          {!liveSessionId && details.archivedTaskId && (
            <button
              className="gact"
              onClick={() => props.onShowInDock({ taskId: details.archivedTaskId! }, `${orchestrator.name} · Orchestrator · ${cluster.run.name}`)}
            >
              <Ico>{I.term}</Ico>{translate("Show activity")}</button>
          )}
          <button
            className="gact primary"
            disabled={!orchestrator.available || !canDirectDispatch}
            onClick={() => props.onCompose({ kind: 'participant', id: orchestrator.id, name: orchestrator.name })}
          >
            <Ico>{I.arrow}</Ico>{translate("Assign task [5461736b]")}</button>
          <button
            className="gact"
            disabled={cluster.teams.length === 0 || !canDirectDispatch}
            onClick={() => props.onCompose({ kind: 'all', workerCount: activeWorkerCount(cluster) })}
          >
            <Ico>{I.arrow}</Ico>{translate("Task to all teams")}</button>
          <button
            className="gact"
            {...openSessionProps(orchestrator.available, orchestrator.id)}
            onClick={() => void openParticipantTerminal(orchestrator.agentId, orchestrator.id, cluster.run.id)}
          >
            <Ico>{I.term}</Ico>{translate("Open session")}</button>
        </div>
      </aside>
    );
  }

  if (selection.kind === 'team' || selection.kind === 'lead') {
    const teamId = selection.kind === 'team' ? selection.id : selection.teamId!;
    const team = teamOf(teamId);
    if (!team) return null;
    const runtime = runtimeVisual(team.lead?.runtime ?? 'claude');
    const leadDetails = team.lead ? detailsFor(team.lead.id) : null;
    return (
      <aside className="ginspector">
        <Head
          glyph={<runtime.Glyph />}
          color={runtime.color}
          title={`team · ${team.name}`}
          sub={translate("{{value1}} participants · {{value2}}", { value1: team.workers.length + 1, value2: cluster.run.name })}
          onClose={props.onClose}
        />
        <div className="ginsp-body">
          <KV k="Status" v={statusText(team.status)} />
          <KV k="Teamlead" v={team.lead?.name ?? translate("Not set")} />
          <KV k="Worker" v={String(team.workers.length)} />
          {team.idle && <KV k="Pause" v={managed ? translate("Scheduling paused") : translate("Manual (dispatch only)")} />}
          {selection.kind === 'lead' && leadDetails && detailRows(leadDetails)}
          {selection.kind === 'lead' && leadDetails?.result && team.lead && (
            <ResultDetails result={leadDetails.result} idPrefix={`ginsp-${team.lead.id}`} />
          )}
        </div>
        <div className="ginsp-actions">
          <button
            className="gact primary"
            disabled={!team.lead?.available || !canDirectDispatch}
            onClick={() => props.onCompose({
              kind: 'team',
              id: team.id,
              name: team.name,
              workerCount: team.workers.length,
            })}
          >
            <Ico>{I.arrow}</Ico>{translate("Task to the team")}</button>
          {team.lead && liveSessionIdFor(team.lead.id) && (
            <button
              className="gact primary"
              onClick={() => {
                const sessionId = team.lead && liveSessionIdFor(team.lead.id);
                if (sessionId) props.onShowInDock({ sessionId }, `${team.lead!.name} · Lead · ${cluster.run.name}`);
              }}
            >
              <Ico>{I.term}</Ico>{translate("Lead watch live")}</button>
          )}
          {team.lead && !liveSessionIdFor(team.lead.id) && leadDetails?.archivedTaskId && (
            <button
              className="gact"
              onClick={() => props.onShowInDock(
                { taskId: leadDetails.archivedTaskId! },
                `${team.lead!.name} · Lead · ${cluster.run.name}`,
              )}
            >
              <Ico>{I.term}</Ico>{translate("Show lead activity")}</button>
          )}
          <button
            className="gact"
            {...openSessionProps(Boolean(team.lead?.available), team.lead?.id ?? '')}
            onClick={() => team.lead && void openParticipantTerminal(team.lead.agentId, team.lead.id, cluster.run.id)}
          >
            <Ico>{I.term}</Ico>{translate("Open lead session")}</button>
          <button
            className="gact"
            disabled={cluster.terminal}
            onClick={() => {
              if (managed) {
                void setTeamPause(cluster.run.id, team.id, !team.idle)
                  .then(() => props.flash(team.idle ? translate("Team scheduling continues") : translate("Team scheduling paused")))
                  .catch((error) => props.flash(errorText(error)));
              } else {
                props.setTeamIdle(team.id, !team.idle);
              }
            }}
          >
            <Ico>{team.idle ? I.play : I.pause}</Ico>
            {managed
              ? (team.idle ? translate("Continue scheduling") : translate("Pause scheduling"))
              : (team.idle ? translate("Reactivate the team") : translate("Pause team (manual)"))}
          </button>
          <button className="gact" onClick={() => void cancelTeamTasks(team.id).then(() => props.flash(translate("Team tasks stopped")))}>
            <Ico>{I.stop}</Ico>{translate("Stop Team Tasks")}</button>
        </div>
      </aside>
    );
  }

  const team = teamOf(selection.teamId!);
  const worker = team?.workers.find((candidate) => candidate.id === selection.id);
  if (!team || !worker) return null;
  const runtime = runtimeVisual(worker.runtime);
  const details = detailsFor(worker.id);
  const liveSessionId = liveSessionIdFor(worker.id);
  return (
    <aside className="ginspector">
      <Head glyph={<runtime.Glyph />} color={runtime.color} title={worker.name} sub={`Worker · ${team.name} · ${cluster.run.name}`} onClose={props.onClose} />
      <div className="ginsp-body">
        <KV k="Runtime" v={runtime.label} />
        <KV k="Status" v={statusText(memberStatus(worker, team.idle))} />
        <KV k="Katalog" v={worker.available ? translate("Available") : translate("Agent removed")} />
        {team.idle && <KV k="Team" v={managed ? translate("Scheduling paused") : translate("Manually paused")} />}
        {detailRows(details)}
        {details.result && <ResultDetails result={details.result} idPrefix={`ginsp-${worker.id}`} />}
        {liveSessionId && <ActivityFeed sessionId={liveSessionId} />}
      </div>
      <div className="ginsp-actions">
        {liveSessionId && (
          <button
            className="gact primary"
            onClick={() => props.onShowInDock({ sessionId: liveSessionId }, `${worker.name} · Worker · ${cluster.run.name}`)}
          >
            <Ico>{I.term}</Ico>{translate("Watch live")}</button>
        )}
        {!liveSessionId && details.archivedTaskId && (
          <button
            className="gact"
            onClick={() => props.onShowInDock({ taskId: details.archivedTaskId! }, `${worker.name} · Worker · ${cluster.run.name}`)}
          >
            <Ico>{I.term}</Ico>{translate("Show activity")}</button>
        )}
        <button
          className="gact primary"
          disabled={!worker.available || !canDirectDispatch}
          onClick={() => props.onCompose({ kind: 'participant', id: worker.id, name: worker.name })}
        >
          <Ico>{I.arrow}</Ico>{translate("Assign task [5461736b]")}</button>
        <button
          className="gact"
          {...openSessionProps(worker.available, worker.id)}
          onClick={() => void openParticipantTerminal(worker.agentId, worker.id, cluster.run.id)}
        >
          <Ico>{I.term}</Ico>{translate("Open session")}</button>
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
  useLocale();
  return (
    <div className="ginsp-head">
      <div className="gglyph" style={{ ['--rt' as string]: props.color }}>{props.glyph}</div>
      <div className="t"><h3>{props.title}</h3><p>{props.sub}</p></div>
      <button className="ginsp-close" title={translate("Close [5363686c]")} onClick={props.onClose}><Ico>{I.close}</Ico></button>
    </div>
  );
}

function KV({ k, v }: { k: string; v: string }): JSX.Element {
  useLocale();
  return <div className="gkv"><span>{k}</span><span className="val">{v}</span></div>;
}

function Composer(props: {
  target: ComposerTarget;
  onCancel: () => void;
  onSend: (text: string, options: { toWorkers: boolean }) => void;
}): JSX.Element {
  useLocale();
  const [text, setText] = useState('');
  const [toWorkers, setToWorkers] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, []);
  const target = props.target;
  const label = target.kind === 'all'
    ? translate("all teams")
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
        <h3>{translate("Task for")}{" "}<b>{label}</b></h3>
        <textarea
          ref={inputRef}
          value={text}
          maxLength={8_000}
          placeholder={translate("Describe task")}
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
            <span>{translate("Also to")}{" "}{workerCount}{" "}{translate("Distribute workers")}</span>
          </label>
        )}
        <div className="gcomposer-meta">{text.length} / 8000</div>
        <div className="gcomposer-foot">
          <button className="gact" onClick={props.onCancel}>{translate("Cancel")}</button>
          <button className="gact primary" disabled={!text.trim()} onClick={submit}>{translate("Send")}</button>
        </div>
      </div>
    </div>
  );
}

function PublicationModal(props: {
  run: Run;
  existing: RunPublication | null;
  preview: (runId: string) => Promise<RunPublicationPreview>;
  publish: (request: {
    runId: string;
    expectedHeadSha: string;
    expectedHeadBranch: string;
    commandId?: string;
  }) => Promise<RunPublication>;
  onCancel: () => void;
  onPublished: (publication: RunPublication) => void;
}): JSX.Element {
  useLocale();
  const [candidate, setCandidate] = useState<RunPublicationPreview | null>(null);
  const [published, setPublished] = useState<RunPublication | null>(
    props.existing?.status === 'draft' ? props.existing : null,
  );
  const [confirmed, setConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const modalRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const commandId = useRef(`publication-${globalThis.crypto.randomUUID()}`);

  useEffect(() => {
    let live = true;
    setCandidate(null);
    setError(null);
    void props.preview(props.run.id)
      .then((value) => { if (live) setCandidate(value); })
      .catch((previewError) => {
        if (live) setError(previewError instanceof Error ? previewError.message : String(previewError));
      });
    return () => {
      live = false;
    };
  }, [props.run.id]);
  useEffect(() => {
    returnFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    closeRef.current?.focus();
    return () => returnFocusRef.current?.focus();
  }, []);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !submitting) {
        event.preventDefault();
        props.onCancel();
        return;
      }
      if (event.key !== 'Tab' || !modalRef.current) return;
      const focusable = [...modalRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )].filter((element) => element.getAttribute('aria-hidden') !== 'true');
      if (focusable.length === 0) {
        event.preventDefault();
        modalRef.current.focus();
        return;
      }
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [props.onCancel, submitting]);

  const finalPublication = published ?? (
    candidate?.existingPublication?.status === 'draft' ? candidate.existingPublication : null
  );
  const safePrUrl = finalPublication?.prUrl
    ? safeGithubPullRequestUrl(finalPublication.prUrl)
    : null;
  const publish = async (): Promise<void> => {
    if (!candidate?.eligible || !candidate.headSha || !candidate.headBranch || !confirmed || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const publication = await props.publish({
        runId: props.run.id,
        expectedHeadSha: candidate.headSha,
        expectedHeadBranch: candidate.headBranch,
        commandId: commandId.current,
      });
      setPublished(publication);
      setConfirmed(false);
      props.onPublished(publication);
    } catch (publishError) {
      setError(publishError instanceof Error ? publishError.message : String(publishError));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="gcomposer-back" onPointerDown={() => { if (!submitting) props.onCancel(); }}>
      <section
        ref={modalRef}
        className="gpublish-modal"
        role="dialog"
        tabIndex={-1}
        aria-modal="true"
        aria-labelledby="gpublish-title"
        aria-busy={!candidate && !error}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="grun-modal-head">
          <div>
            <h2 id="gpublish-title">{translate("Publish Verified Draft PR")}</h2>
            <p>{props.run.name}{" "}{translate("· External GitHub writing process")}</p>
          </div>
          <button ref={closeRef} type="button" className="ginsp-close" title={translate("Close [5363686c]")} disabled={submitting} onClick={props.onCancel}>
            <Ico>{I.close}</Ico>
          </button>
        </div>

        <div className="gpublish-body" aria-live="polite">
          {!candidate && !error && (
            <div className="gpublish-loading">
              <span className="gpublish-spinner" aria-hidden="true" />
              {translate("Worktree, Remote, GitHub Access and Verification Certificate are checked…")}</div>
          )}

          {finalPublication && (
            <div className="gpublish-success" role="status">
              <b>{translate("Draft PR #")}{finalPublication.prNumber}{" "}{translate("is created")}</b>
              <span>
                {translate("Branch")}{" "}<code>{finalPublication.headBranch}</code> {" "}{translate("· CI")}{" "}{ciStatusText(candidate?.ciStatus ?? 'none')}
              </span>
              {safePrUrl && (
                <a href={safePrUrl} target="_blank" rel="noreferrer">{translate("Open on GitHub ↗")}</a>
              )}
              <p>{translate("ADE can neither automatically merge nor")}{" "}<code>main</code> {" "}{translate("Directly update.")}</p>
            </div>
          )}

          {candidate && !finalPublication && (
            <>
              <div className="gpublish-summary">
                <div><span>{translate("Repository")}</span><b>{candidate.providerRepository ?? candidate.repositoryName ?? '—'}</b></div>
                <div><span>{translate("Base")}</span><b>{candidate.baseBranch ?? '—'} <code>{candidate.baseSha?.slice(0, 10)}</code></b></div>
                <div><span>{translate("New branch")}</span><b><code>{candidate.headBranch ?? '—'}</code></b></div>
                <div><span>{translate("Verified")}</span><b><code>{candidate.headSha?.slice(0, 10) ?? '—'}</code></b></div>
                <div><span>{translate("Scope")}</span><b>{candidate.commitCount}{" "}{translate("Commits ·")}{" "}{candidate.changedFiles.length}{candidate.changedFilesTruncated ? '+' : ''}{" "}{translate("Files")}</b></div>
                <div><span>{translate("Provider")}</span><b>{candidate.provider === 'github' ? translate("GitHub CLI in the repo backend") : translate("Not available [6e696368]")}</b></div>
              </div>

              {!candidate.eligible && (
                <div className="gpublish-blocked" role="alert">
                  <b>{translate("Publication blocked")}</b>
                  <ul>{candidate.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
                </div>
              )}

              {candidate.eligible && (
                <>
                  <section className="gpublish-evidence">
                    <h3>{translate("Final verification")}</h3>
                    <ul>
                      {candidate.verificationCommands.map((command) => <li key={command}><code>{command}</code></li>)}
                    </ul>
                  </section>
                  <section className="gpublish-evidence">
                    <h3>{translate("Modified files")}</h3>
                    <ul className="gpublish-files">
                      {candidate.changedFiles.map((file) => <li key={file}><code>{file}</code></li>)}
                    </ul>
                  </section>
                  <label className="gpublish-confirm">
                    <input
                      type="checkbox"
                      checked={confirmed}
                      disabled={submitting}
                      onChange={(event) => setConfirmed(event.target.checked)}
                    />
                    <span>
                      {translate("I confirm the external push of this exact HEAD on the new")}{" "}<code>ade/**</code>{translate("-Branch and creating a draft PR.")}{" "}<code>main</code> {" "}{translate("remains unchanged.")}</span>
                  </label>
                </>
              )}
            </>
          )}

          {props.existing?.status === 'failed' && !finalPublication && (
            <div className="gpublish-retry">
              {translate("Previous attempt failed:")}{" "}{props.existing.error ?? translate("unknown error")}{translate("The retry checks remote branch and HEAD again.")}</div>
          )}
          {error && <div className="grun-error" role="alert">{localizeAppMessage(error)}</div>}
        </div>

        <div className="gcomposer-foot">
          <button type="button" className="gact" disabled={submitting} onClick={props.onCancel}>{translate("Close [5363686c]")}</button>
          {!finalPublication && (
            <button
              type="button"
              className="gact primary"
              disabled={!candidate?.eligible || !confirmed || submitting}
              onClick={() => void publish()}
            >
              <Ico>{I.publish}</Ico>{submitting ? translate("Publishing…") : translate("Push branch & create draft PR")}
            </button>
          )}
        </div>
      </section>
    </div>
  );
}

function ciStatusText(status: RunPublicationPreview['ciStatus']): string {
  switch (status) {
    case 'pending': return translate("running");
    case 'passed': return translate("Green");
    case 'failed': return translate("Failed [6665686c]");
    default: return translate("no checks yet");
  }
}

function safeGithubPullRequestUrl(value: string): string | null {
  try {
    const url = new URL(value);
    const parts = url.pathname.split('/').filter(Boolean);
    return url.protocol === 'https:'
      && url.hostname.toLowerCase() === 'github.com'
      && !url.username
      && !url.password
      && parts.length === 4
      && parts[2] === 'pull'
      && /^\d+$/.test(parts[3] ?? '')
      ? url.toString().replace(/\/$/, '')
      : null;
  } catch {
    return null;
  }
}

export function NewRunModal(props: {
  categories: Category[];
  agents: Record<string, Agent>;
  repositories: Repository[];
  suggestedName: string;
  onCancel: () => void;
  onCreate: (input: RunCreateInput) => Promise<void>;
}): JSX.Element {
  useLocale();
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    formRef.current?.querySelector<HTMLInputElement>('input')?.focus();
    return () => { if (opener?.isConnected) opener.focus(); else document.querySelector<HTMLElement>('.appnav [aria-selected="true"]')?.focus(); };
  }, []);
  const [name, setName] = useState(props.suggestedName);
  const [goal, setGoal] = useState('');
  const [goalPasteOverflow, setGoalPasteOverflow] = useState(false);
  const [orchestratorId, setOrchestratorId] = useState('');
  const [repositoryId, setRepositoryId] = useState(
    props.repositories.length === 1 ? props.repositories[0]!.id : '',
  );
  const [selected, setSelected] = useState<Record<string, true>>({});
  const [leaders, setLeaders] = useState<Record<string, string>>({});
  /** Per-run harness override per agent id; absent = agent's own runtime. */
  const [harness, setHarness] = useState<Record<string, RuntimeId>>({});
  const importRepository = useAppData((state) => state.importRepository);
  /** null = hidden; string = direct native/WSL repository path entry. */
  const [manualPath, setManualPath] = useState<string | null>(null);
  const [importBackend, setImportBackend] = useState<ExecutionBackendId>(NATIVE_EXECUTION_BACKEND);
  const [wslDistributions, setWslDistributions] = useState<WslDistributionInfo[]>([]);
  const [importBusy, setImportBusy] = useState(false);
  const [maxConcurrentTasks, setMaxConcurrentTasks] = useState(2);
  const [maxInputTokens, setMaxInputTokens] = useState('');
  const [maxOutputTokens, setMaxOutputTokens] = useState('');
  const [maxCostUsd, setMaxCostUsd] = useState('');
  const [maxApprovals, setMaxApprovals] = useState(1);
  /** Empty = no wall-clock limit per managed task. */
  const [maxTaskMinutes, setMaxTaskMinutes] = useState('60');
  /** Explicit opt-in: archive and reset divergent worktrees onto the orchestrator base. */
  const [resetWorktrees, setResetWorktrees] = useState(false);
  const [allowQuestions, setAllowQuestions] = useState(false);
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
  const harnessFor = (agentId: string): RuntimeId | undefined => {
    const agent = props.agents[agentId];
    const override = harness[agentId];
    return agent && override && override !== agent.runtime ? override : undefined;
  };
  const harnessOptions = (agent: Agent): RuntimeId[] => [
    agent.runtime,
    ...MANAGED_HARNESS_OVERRIDES.filter((runtime) => runtime !== agent.runtime),
  ];
  const toggleManualPath = (): void => {
    setManualPath((current) => (current === null ? '' : null));
    if (manualPath === null && wslDistributions.length === 0) {
      void window.ade.invoke('wsl:list')
        .then((result) => setWslDistributions(result.distributions))
        .catch(() => setWslDistributions([]));
    }
  };
  const importManualPath = async (): Promise<void> => {
    const path = (manualPath ?? '').trim();
    if (!path || importBusy) return;
    setImportBusy(true);
    setError(null);
    try {
      const repository = await importRepository(path, undefined, importBackend);
      setRepositoryId(repository.id);
      setManualPath(null);
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : String(importError));
    } finally {
      setImportBusy(false);
    }
  };
  const submit = async (): Promise<void> => {
    if (!name.trim() || participantCount === 0 || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const participants: RunCreateInput['participants'] = [];
      if (orchestratorId) {
        const runtime = harnessFor(orchestratorId);
        participants.push({
          agentId: orchestratorId,
          role: 'orchestrator',
          ...(runtime ? { runtime } : {}),
        });
      }
      for (const category of availableCategories) {
        const memberIds = category.agents.filter((agentId) => selected[agentId] && props.agents[agentId]);
        if (!memberIds.length) continue;
        const leadId = memberIds.includes(leaders[category.id] ?? '')
          ? leaders[category.id]!
          : memberIds[0]!;
        const teamId = globalThis.crypto?.randomUUID?.()
          ?? `team-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        for (const agentId of memberIds) {
          const runtime = harnessFor(agentId);
          participants.push({
            agentId,
            role: agentId === leadId ? 'lead' : 'worker',
            teamId,
            teamName: category.name,
            ...(runtime ? { runtime } : {}),
          });
        }
      }
      const optionalNumber = (value: string): number | null => value.trim() ? Number(value) : null;
      await props.onCreate({
        name: name.trim(),
        goal: goal.trim(),
        ...(allowQuestions ? { allowQuestions: true } : {}),
        repositoryId: repositoryId || null,
        participants,
        budget: {
          maxConcurrentTasks,
          maxInputTokens: optionalNumber(maxInputTokens),
          maxOutputTokens: optionalNumber(maxOutputTokens),
          maxCostUsd: optionalNumber(maxCostUsd),
          maxApprovals,
          maxTaskMinutes: optionalNumber(maxTaskMinutes),
        },
        ...(repositoryId && resetWorktrees ? { workspacePrepare: 'reset-to-base' as const } : {}),
      });
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : String(createError));
      setSubmitting(false);
    }
  };

  return (
    <div className="gcomposer-back" onPointerDown={() => { if (!submitting) props.onCancel(); }}>
      <form
        ref={formRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-run-title"
        className="grun-modal"
        onKeyDown={(event) => {
          if (event.key === 'Escape') { event.stopPropagation(); if (!submitting) props.onCancel(); }
          if (event.key !== 'Tab') return;
          const nodes = Array.from(formRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])') ?? []).filter(node => node.getClientRects().length > 0);
          const first = nodes[0]; const last = nodes[nodes.length - 1];
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        }}
        onPointerDown={(event) => event.stopPropagation()}
        onSubmit={(event) => { event.preventDefault(); void submit(); }}
      >
        <div className="grun-modal-head">
          <div><h2 id="new-run-title">{translate("New Run")}</h2><p>{translate("Putting together existing agents for a specific goal")}</p></div>
          <button type="button" className="ginsp-close" title={translate("Close [5363686c]")} onClick={props.onCancel}><Ico>{I.close}</Ico></button>
        </div>
        <div className="grun-modal-body">
          <label className="grun-field">
            <span>{translate("Name")}</span>
            <input value={name} maxLength={80} onChange={(event) => setName(event.target.value)} />
          </label>
          <label className="grun-field">
            <span>{translate("Objective")}</span>
            <textarea
              value={goal}
              maxLength={1_000}
              onChange={(event) => setGoal(event.target.value)}
              onPaste={(event) => {
                const pasted = event.clipboardData.getData('text');
                const field = event.currentTarget;
                const replaced = field.selectionEnd - field.selectionStart;
                if (goal.length - replaced + pasted.length > 1_000) setGoalPasteOverflow(true);
              }}
              placeholder={translate("Expected result of this run")}
            />
            <small className="grun-goal-meta">
              {goal.split('\n').length > 1 ? translate("{{value1}} lines · ", { value1: goal.split('\n').length }) : ''}{goal.length} / 1000
            </small>
            {goalPasteOverflow && goal.length >= 1_000 && (
              <small className="grun-goal-warn">
                {translate("The pasted text exceeded 1,000 characters and was truncated. Review the complete goal before creating the run.")}</small>
            )}
          </label>
          <label className="grun-field">
            <span>{translate("Orchestrator")}</span>
            <select value={orchestratorId} onChange={(event) => chooseOrchestrator(event.target.value)}>
              <option value="">{translate("None")}</option>
              {allAgents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
            </select>
          </label>
          {orchestratorId && props.agents[orchestratorId] ? (
            <label className="grun-field">
              <span>{translate("Harness")}</span>
              <select
                aria-label={translate("Harness for {{value1}}", { value1: props.agents[orchestratorId]!.name })}
                value={harness[orchestratorId] ?? props.agents[orchestratorId]!.runtime}
                onChange={(event) => setHarness((current) => ({
                  ...current,
                  [orchestratorId]: event.target.value as RuntimeId,
                }))}
              >
                {harnessOptions(props.agents[orchestratorId]!).map((runtime) => (
                  <option key={runtime} value={runtime}>
                    {runtimeVisual(runtime).label}
                    {runtime === props.agents[orchestratorId]!.runtime ? ' (Agent-Standard)' : ''}
                  </option>
                ))}
              </select>
              <small className="grun-hint">
                {translate("Applies only to this run. The selected CLI must be installed and logged in (Diagnostics).")}</small>
            </label>
          ) : null}
          <label className="grun-field">
            <span>{translate("Repository")}</span>
            <select value={repositoryId} onChange={(event) => setRepositoryId(event.target.value)}>
              <option value="">{translate("No repository (portable agent homes)")}</option>
              {[...props.repositories]
                .sort((left, right) => left.name.localeCompare(right.name))
                .map((repository) => (
                  <option key={repository.id} value={repository.id}>{repository.name}</option>
                ))}
            </select>
            <small className="grun-hint">
              {repositoryId
                ? translate("Each participant works in their own ADE worktree of this repository; the scope is frozen per task.")
                : translate("Without a repository, all participants work in their home directories (no shared git state).")}
            </small>
          </label>
          {repositoryId ? (
            <div className="grun-field grun-prepare">
              <details>
                <summary>{translate("Check and update git base before the run")}</summary>
                <RepositorySyncPanel key={repositoryId} repositoryId={repositoryId} />
              </details>
              <span id="grun-prepare-label">{translate("Worktrees")}</span>
              <label className="grun-prepare-choice">
                <input
                  type="checkbox"
                  aria-describedby="grun-prepare-hint"
                  checked={resetWorktrees}
                  onChange={(event) => setResetWorktrees(event.target.checked)}
                />
                <span>{translate("Reset diverging participant worktrees to the orchestrator base")}</span>
              </label>
              <small className="grun-hint" id="grun-prepare-hint">
                {resetWorktrees
                  ? translate("Before starting, ADE archives each diverging worktree under refs/ade/archive/<run>/<participant>, then resets it to the orchestrator worktree HEAD. Dirty worktrees and worktrees used by an active run are left untouched.")
                  : translate("Without this option, starting stops if a participant worktree differs from the orchestrator worktree HEAD and lists the affected worktrees.")}
              </small>
            </div>
          ) : null}
          <div className="grun-repo-import">
              <button
                type="button"
                className="gact"
                aria-expanded={manualPath !== null}
                title={translate("Enter and import repository path directly")}
                onClick={toggleManualPath}
              >
                {translate("Path …")}</button>
              {manualPath !== null && (
                <>
                  <select
                    aria-label={translate("Execution backend")}
                    value={importBackend}
                    disabled={importBusy}
                    onChange={(event) => setImportBackend(event.target.value as ExecutionBackendId)}
                  >
                    <option value={NATIVE_EXECUTION_BACKEND}>{translate("Native")}</option>
                    {wslDistributions.map((distribution) => (
                      // Advisory only — a cold WSL VM can miss the probe window.
                      <option key={distribution.backend} value={distribution.backend}>
                        {translate("WSL ·")}{" "}{distribution.name}{distribution.available ? '' : ' (unavailable?)'}
                      </option>
                    ))}
                  </select>
                  <input
                    type="text"
                    aria-label={translate("Repository path")}
                    placeholder={importBackend === NATIVE_EXECUTION_BACKEND
                      ? translate("C:\\repos\\project")
                      : translate("/home/name/project")}
                    value={manualPath}
                    disabled={importBusy}
                    onChange={(event) => setManualPath(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        void importManualPath();
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="gact"
                    disabled={importBusy || manualPath.trim().length === 0}
                    onClick={() => void importManualPath()}
                  >
                    {translate("Import")}</button>
                </>
              )}
            </div>

          <label><input type="checkbox" checked={allowQuestions} onChange={(event) => setAllowQuestions(event.target.checked)} />{translate("Allow queries during the run (native Codex agents)")}</label>
          {allowQuestions && <p>{translate("Codex can ask questions in the graph and on the tablet. Blocking queries pause the time limit of the respective task. All selected runtimes must be native Codex agents.")}</p>}
          <div className="grun-budget-title">
            <span>{translate("Run budgets")}</span>
            <small>{translate("Empty token/cost/time fields = no limit; token/cost limits require adapter telemetry.")}</small>
          </div>
          <div className="grun-budget">
            <label>
              <span>{translate("Parallel")}</span>
              <input
                type="number"
                min={1}
                max={4}
                value={maxConcurrentTasks}
                onChange={(event) => setMaxConcurrentTasks(Number(event.target.value))}
              />
            </label>
            <label>
              <span>{translate("Input tokens")}</span>
              <input
                type="number"
                min={1}
                placeholder={translate("Unlimited")}
                value={maxInputTokens}
                onChange={(event) => setMaxInputTokens(event.target.value)}
              />
            </label>
            <label>
              <span>{translate("Output tokens")}</span>
              <input
                type="number"
                min={1}
                placeholder={translate("Unlimited")}
                value={maxOutputTokens}
                onChange={(event) => setMaxOutputTokens(event.target.value)}
              />
            </label>
            <label>
              <span>{translate("Costs USD")}</span>
              <input
                type="number"
                min={0.01}
                step={0.01}
                placeholder={translate("Unlimited")}
                value={maxCostUsd}
                onChange={(event) => setMaxCostUsd(event.target.value)}
              />
            </label>
            <label>
              <span>{translate("Approvals")}</span>
              <input
                type="number"
                min={1}
                max={20}
                value={maxApprovals}
                onChange={(event) => setMaxApprovals(Number(event.target.value))}
              />
            </label>
            <label>
              <span>{translate("Min. per task")}</span>
              <input
                type="number"
                min={1}
                max={MAX_TASK_MINUTES_LIMIT}
                step={1}
                placeholder={translate("Unlimited")}
                value={maxTaskMinutes}
                onChange={(event) => setMaxTaskMinutes(event.target.value)}
              />
            </label>
          </div>

          <div className="grun-roster-title"><span>{translate("Teams")}</span><b>{participantCount}{" "}{translate("Participants")}</b></div>
          {availableCategories.length === 0 && (
            <div className="grun-no-agents">{translate("In terminal mode, create at least one agent first.")}</div>
          )}
          <div className="grun-roster">
            {availableCategories.map((category) => {
              const members = category.agents.map((id) => props.agents[id]).filter(Boolean) as Agent[];
              return (
                <section key={category.id} className="grun-team">
                  <h3>{category.name}</h3>
                  {members.map((agent) => {
                    const checked = Boolean(selected[agent.id]);
                    const effectiveRuntime = checked
                      ? (harness[agent.id] ?? agent.runtime)
                      : agent.runtime;
                    const runtime = runtimeVisual(effectiveRuntime);
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
                          {!checked && <span className="grun-agent-runtime">{runtime.label}</span>}
                        </label>
                        {checked && (
                          <select
                            className="grun-agent-harness"
                            aria-label={translate("Harness for {{value1}}", { value1: agent.name })}
                            value={effectiveRuntime}
                            onChange={(event) => setHarness((current) => ({
                              ...current,
                              [agent.id]: event.target.value as RuntimeId,
                            }))}
                          >
                            {harnessOptions(agent).map((option) => (
                              <option key={option} value={option}>
                                {runtimeVisual(option).label}
                                {option === agent.runtime ? ' (Standard)' : ''}
                              </option>
                            ))}
                          </select>
                        )}
                        {checked && (
                          <label className="grun-lead">
                            <input
                              type="radio"
                              name={`lead-${category.id}`}
                              checked={leaders[category.id] === agent.id}
                              onChange={() => setLeaders((current) => ({ ...current, [category.id]: agent.id }))}
                            />
                            {translate("Lead")}</label>
                        )}
                      </div>
                    );
                  })}
                </section>
              );
            })}
          </div>
          {error && <div className="grun-error">{localizeAppMessage(error)}</div>}
        </div>
        <div className="gcomposer-foot">
          <button type="button" className="gact" onClick={props.onCancel}>{translate("Cancel")}</button>
          <button type="submit" className="gact primary" disabled={!name.trim() || participantCount === 0 || submitting}>
            {submitting ? translate("Creating") : translate("Create a Run")}
          </button>
        </div>
      </form>
    </div>
  );
}
