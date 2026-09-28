import { t as translate } from "../../shared/i18n";
import { useLocale } from "../i18n/language";
/**
 * Graph mode: a multi-run canvas over persisted runs, participants and task events.
 *
 * This container owns the cross-surface state (selection, report, dock target,
 * composer, dialogs, toast) and composes the surfaces in a fixed DOM order,
 * which is also the Tab order and the stacking order of equal z-indexes:
 * run bar → banners → canvas → empty state → report → inspector → dock panel
 * → task slots → view controls → run control dock → toast → dialogs.
 * Styles: graph.css imports one stylesheet per surface.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { JSX } from 'react';
import type { Run } from '../../shared/types';
import { useAppData } from '../stores/appdata';
import { useRuns } from '../stores/runs';
import { useSessions } from '../stores/sessions';
import { DesktopSupervisionGraph } from '../supervision/SupervisionGraph';
import { useGraphStore } from './graphStore';
import { buildClusters, failureNoticeFor } from './graphModel';
import { useGraphLayout } from './graphLayout';
import { useGraphViewport } from './useGraphViewport';
import { GraphCanvas } from './GraphCanvas';
import { RunBar } from './RunBar';
import { ApprovalBanner, RunFailureAlert } from './RunBanners';
import { GraphEmpty, RunControlDock, TaskSlots, ZoomControls } from './GraphChrome';
import { GraphDockPanel, type DockTarget } from './GraphDockPanel';
import { GraphInspector } from './GraphInspector';
import { Composer, sendComposerTask, type ComposerTarget } from './Composer';
import { PublicationModal } from './PublicationModal';
import { NewRunModal } from './NewRunModal';
import { RunReportPanel } from './RunReportPanel';
import { RepositorySyncModal } from '../repositories/RepositorySyncModal';
import './graph.css';

export { NewRunModal } from './NewRunModal';

export function GraphView(): JSX.Element {
  const locale = useLocale();
  const categories = useAppData((state) => state.categories);
  const agents = useAppData((state) => state.agents);
  const repositories = useAppData((state) => state.repositories);
  const runs = useRuns((state) => state.runs);
  const participants = useRuns((state) => state.participants);
  const tasks = useRuns((state) => state.tasks);
  const events = useRuns((state) => state.events);
  const approvals = useRuns((state) => state.approvals);
  const publications = useRuns((state) => state.publications);
  const results = useRuns((state) => state.results);
  const seqCursor = useRuns((state) => state.seqCursor);
  const runsLoaded = useRuns((state) => state.loaded);
  const activeRunId = useRuns((state) => state.activeRunId);
  const createRun = useRuns((state) => state.createRun);
  const previewPublication = useRuns((state) => state.previewPublication);
  const publishRun = useRuns((state) => state.publishRun);
  const sessions = useSessions((state) => state.sessions);
  const orderByAgent = useSessions((state) => state.orderByAgent);
  const busy = useGraphStore((state) => state.busy);
  const idleTeams = useGraphStore((state) => state.idleTeams);
  const positions = useGraphStore((state) => state.positions);
  const selection = useGraphStore((state) => state.selection);
  const select = useGraphStore((state) => state.select);
  const setTeamIdle = useGraphStore((state) => state.setTeamIdle);

  const sessionsSlice = useMemo(() => ({ sessions, orderByAgent }), [sessions, orderByAgent]);
  // The selected run is pinned: an older finished run chosen in the run bar
  // renders like any other cluster instead of leaving the canvas empty.
  const clusters = useMemo(
    () => buildClusters(runs, participants, agents, tasks, sessionsSlice, busy, idleTeams, 2, activeRunId),
    [runs, participants, agents, tasks, sessionsSlice, busy, idleTeams, activeRunId],
  );

  const activeCluster = clusters.find((cluster) => cluster.run.id === activeRunId) ?? null;
  const activeRun = activeCluster?.run ?? null;
  const activeRepository = activeRun?.repositoryId
    ? repositories.find((repository) => repository.id === activeRun.repositoryId)
    : null;
  const pendingApproval = approvals.find(
    (approval) => approval.runId === activeRunId && approval.status === 'pending' && activeRun?.status === 'running',
  );
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

  const [composer, setComposer] = useState<ComposerTarget | null>(null);
  const [showNewRun, setShowNewRun] = useState(false);
  const [showGitSync, setShowGitSync] = useState(false);
  const [publicationRun, setPublicationRun] = useState<Run | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [dock, setDock] = useState<DockTarget | null>(null);
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

  const layout = useGraphLayout(clusters, positions);
  const clearSelection = useCallback(() => select(null), [select]);
  const viewport = useGraphViewport(clusters, layout.clusterPos, clearSelection);

  /**
   * Closing the details column unmounts whatever had focus inside it, so focus
   * goes back to the node it described (cards and team bars carry data-node-id).
   */
  const closeDetails = useCallback(() => {
    const nodeId = useGraphStore.getState().selection?.id;
    const focusWasInside = Boolean(document.activeElement?.closest('.ginspector'));
    select(null);
    if (!nodeId || (!focusWasInside && document.activeElement !== document.body)) return;
    requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(`.graph [data-node-id="${CSS.escape(nodeId)}"]`)?.focus();
    });
  }, [select]);

  const onGraphKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    if (reportOpen) {
      setReportOpen(false);
      return;
    }
    if (selection) {
      event.preventDefault();
      closeDetails();
    }
  };

  return (
    <div className={`graph${selection ? ' graph-inspecting' : ''}`} onKeyDown={onGraphKeyDown}>
      <DesktopSupervisionGraph />
      <RunBar
        activeRun={activeRun}
        activeRepository={activeRepository}
        activeRunTasks={activeRunTasks}
        repositoryCount={repositories.length}
        reportOpen={reportOpen}
        reportButtonRef={reportButtonRef}
        onToggleReport={() => setReportOpen((open) => !open)}
        onOpenReport={() => setReportOpen(true)}
        onPublish={setPublicationRun}
        onGitSync={() => setShowGitSync(true)}
        onNewRun={openNewRun}
        flash={flash}
      />

      {activeRunFailure && !reportOpen && (
        <RunFailureAlert failure={activeRunFailure} onOpenReport={() => setReportOpen(true)} />
      )}

      {pendingApproval && <ApprovalBanner approval={pendingApproval} flash={flash} />}

      <GraphCanvas clusters={clusters} viewport={viewport} layout={layout} flash={flash} />

      {runsLoaded && runs.length === 0 && <GraphEmpty onCreate={openNewRun} />}

      {reportOpen && activeRunId && (
        <RunReportPanel
          runId={activeRunId}
          seqCursor={seqCursor}
          fallbackFocusRef={reportButtonRef}
          onClose={() => setReportOpen(false)}
        />
      )}

      <GraphInspector
        clusters={clusters}
        selection={selection}
        onClose={closeDetails}
        onCompose={setComposer}
        setTeamIdle={setTeamIdle}
        flash={flash}
        onShowInDock={(target, title) => setDock({ ...target, title })}
      />

      <GraphDockPanel target={dock} onClose={() => setDock(null)} />

      <TaskSlots clusters={clusters} />

      <ZoomControls scale={viewport.view.scale} onZoom={viewport.zoomBy} onFit={viewport.fitView} />

      {activeRun && activeCluster && (
        <RunControlDock run={activeRun} cluster={activeCluster} tasks={activeRunTasks} onCompose={setComposer} flash={flash} />
      )}

      {toast && <div className="gtoast">{toast}</div>}

      {composer && (
        <Composer
          target={composer}
          onCancel={() => setComposer(null)}
          onSend={async (text, options) => {
            const target = composer;
            setComposer(null);
            flash(await sendComposerTask(target, text, options));
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
