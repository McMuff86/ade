import { t as translate } from "../../shared/i18n";
import { useLocale } from "../i18n/language";
/** Anchored graph chrome: task slots, view controls, run control dock and the empty state. */

import { useState } from 'react';
import type { JSX } from 'react';
import type { Run, RunTaskView } from '../../shared/types';
import { useRuns } from '../stores/runs';
import { useSessions } from '../stores/sessions';
import { useGraphStore } from './graphStore';
import { activeWorkerCount, type RunClusterModel } from './graphModel';
import { cancelAllTasks } from './graphActions';
import { errorText } from './graphText';
import { I, Ico } from './graphIcons';
import type { ComposerTarget } from './Composer';

/** Global task slots: one queue across all runs, expandable per run. */
export function TaskSlots(props: { clusters: RunClusterModel[] }): JSX.Element {
  useLocale();
  const taskQueue = useSessions((state) => state.taskQueue);
  const [slotsOpen, setSlotsOpen] = useState(false);
  const slotRows = props.clusters.filter(
    (cluster) => cluster.runningTaskCount > 0 || cluster.queuedTaskCount > 0,
  );
  return (
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
  );
}

export function ZoomControls(props: { scale: number; onZoom: (factor: number) => void; onFit: () => void }): JSX.Element {
  useLocale();
  return (
    <div className="gzoom" role="group" aria-label={translate("View")}>
      <button type="button" aria-label={translate("Zoom out [5665726b]")} title={translate("Zoom out [5665726b]")} onClick={() => props.onZoom(0.87)}><Ico>{I.minus}</Ico></button>
      <output className="gzoom-level" aria-label={translate("Zoom level")}>{Math.round(props.scale * 100)}%</output>
      <button type="button" aria-label={translate("Zoom in [56657267]")} title={translate("Zoom in [56657267]")} onClick={() => props.onZoom(1.15)}><Ico>{I.plus}</Ico></button>
      <button type="button" aria-label={translate("Fit view")} title={translate("Fit view")} onClick={props.onFit}><Ico>{I.fit}</Ico></button>
    </div>
  );
}

/** Bottom dock with the run-level actions of the active run. */
export function RunControlDock(props: {
  run: Run;
  cluster: RunClusterModel;
  tasks: RunTaskView[];
  onCompose: (target: ComposerTarget) => void;
  flash: (message: string) => void;
}): JSX.Element {
  useLocale();
  const { run, cluster, flash } = props;
  const startRun = useRuns((state) => state.startRun);
  const cancelRun = useRuns((state) => state.cancelRun);
  const setTeamIdle = useGraphStore((state) => state.setTeamIdle);
  return (
    <div className="gdock" role="group" aria-label={translate("Run control for {{value1}}", { value1: run.name })}>
      <span className="gdock-caption" title={run.name}>{translate("Run control")}</span>
      <div className="sep" />
      {run.mode === 'manual' && run.status === 'draft' && (
        <button
          className="gdbtn accent"
          disabled={!run.goal.trim() || !cluster.orchestrator || cluster.teams.length === 0}
          title={translate("Plans separate worker jobs and integrates only after approval")}
          onClick={() => void startRun(run.id)
            .then(() => flash(translate("Orchestration started")))
            .catch((error) => flash(errorText(error)))}
        >
          <Ico>{I.play}</Ico>{translate("Start orchestration")}</button>
      )}
      {run.mode === 'manual' && (
        <>
          <button
            className="gdbtn"
            disabled={cluster.teams.length === 0}
            onClick={() => props.onCompose({ kind: 'all', workerCount: activeWorkerCount(cluster) })}
          >
            <Ico>{I.arrow}</Ico>{translate("Directly to teams")}</button>
          <button
            className="gdbtn"
            title={translate("Manual break: affects only the dispatch from the canvas")}
            onClick={() => cluster.teams.forEach((team) => setTeamIdle(team.id, true))}
          >
            <Ico>{I.pause}</Ico>{translate("Pause all")}</button>
          <button className="gdbtn" onClick={() => cluster.teams.forEach((team) => setTeamIdle(team.id, false))}>
            <Ico>{I.play}</Ico>{translate("Activate everyone")}</button>
        </>
      )}
      {run.mode === 'managed' && run.status === 'running' && (
        <button
          className="gdbtn danger"
          onClick={() => void cancelRun(run.id)
            .then(() => flash(translate("Orchestration is stopped")))
            .catch((error) => flash(errorText(error)))}
        >
          <Ico>{I.stop}</Ico>{translate("Cancel run")}</button>
      )}
      {run.mode === 'manual'
        && props.tasks.some((task) => task.status === 'queued' || task.status === 'running') && (
        <button className="gdbtn danger" onClick={() => void cancelAllTasks().then(() => flash(translate("Run tasks stopped")))}>
          <Ico>{I.stop}</Ico>{translate("Stop Tasks")}</button>
      )}
    </div>
  );
}

export function GraphEmpty(props: { onCreate: () => void }): JSX.Element {
  useLocale();
  return (
    <div className="gempty">
      <h2>{translate("No run yet")}</h2>
      <p>{translate("For a specific goal, put together a team of existing agents.")}</p>
      <button className="gact primary" onClick={props.onCreate}>
        <Ico>{I.plus}</Ico>{translate("Create first run")}</button>
    </div>
  );
}
