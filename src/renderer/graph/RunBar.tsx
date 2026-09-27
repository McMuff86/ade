import { t as translate } from "../../shared/i18n";
import { useLocale } from "../i18n/language";
/** Top run bar: run picker and facts, results, rare actions, and the one primary action. */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import type { Repository, Run, RunTaskView } from '../../shared/types';
import { useRuns } from '../stores/runs';
import { useGraphStore } from './graphStore';
import { errorText, phaseText, runStatusText } from './graphText';
import { I, Ico } from './graphIcons';

export function RunBar(props: {
  activeRun: Run | null;
  activeRepository: Repository | null | undefined;
  activeRunTasks: RunTaskView[];
  repositoryCount: number;
  reportOpen: boolean;
  reportButtonRef: React.RefObject<HTMLButtonElement | null>;
  onToggleReport: () => void;
  onOpenReport: () => void;
  onPublish: (run: Run) => void;
  onGitSync: () => void;
  onNewRun: () => void;
  flash: (message: string) => void;
}): JSX.Element {
  useLocale();
  const { activeRun, activeRepository, activeRunTasks, flash } = props;
  const runs = useRuns((state) => state.runs);
  const activeRunId = useRuns((state) => state.activeRunId);
  const setActiveRun = useRuns((state) => state.setActiveRun);
  const usageByRun = useRuns((state) => state.usageByRun);
  const publications = useRuns((state) => state.publications);
  const workspaceLeases = useRuns((state) => state.workspaceLeases);
  const deleteRun = useRuns((state) => state.deleteRun);
  const clearRunPositions = useGraphStore((state) => state.clearRunPositions);
  const activeUsage = activeRunId ? usageByRun[activeRunId] : undefined;
  const pendingQuestions = activeRunTasks.reduce((sum, task) => sum + (task.pendingQuestions ?? 0), 0);

  const [deleteArmed, setDeleteArmed] = useState(false);
  const deleteArmTimer = useRef<number | undefined>(undefined);

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

  const sortedRuns = [...runs].sort((a, b) => b.updatedAt - a.updatedAt);
  const openRuns = sortedRuns.filter((run) => !['completed', 'failed', 'cancelled'].includes(run.status));
  const endedRuns = sortedRuns.filter((run) => ['completed', 'failed', 'cancelled'].includes(run.status));
  const runOption = (run: Run): JSX.Element => (
    <option key={run.id} value={run.id}>
      {run.name} · {runStatusText(run.status)}
    </option>
  );

  return (
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
          ref={props.reportButtonRef}
          className={`grun-report${props.reportOpen ? ' active' : ''}`}
          aria-pressed={props.reportOpen}
          title={translate("Full report: files, tests with output, risks, commits")}
          onClick={props.onToggleReport}
        >
          <Ico>{I.report}</Ico>{translate("Report")}</button>
      )}
      {pendingQuestions > 0 && <button className="grun-report" onClick={props.onOpenReport} aria-label={translate("Answer {{value1}} questions", { value1: pendingQuestions })}>{translate("Questions (")}{pendingQuestions})</button>}
      {activeRun?.mode === 'managed' && activeRun.status === 'completed' && activeRun.repositoryId && (
        <button
          className="grun-publish"
          title={translate("Publish Verified ADE Branch as GitHub Draft Pull Request")}
          onClick={() => props.onPublish(activeRun)}
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
      <button type="button" className="btn btn-quiet" data-open-git-sync disabled={props.repositoryCount === 0} onClick={props.onGitSync}>{translate("Git sync")}</button>
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
      <button className="grun-new" onClick={props.onNewRun}>
        <Ico>{I.plus}</Ico>{translate("New Run")}</button>
    </div>
  );
}
