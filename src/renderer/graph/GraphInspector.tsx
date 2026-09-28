import { t as translate } from "../../shared/i18n";
import { useLocale } from "../i18n/language";
/** Graph inspector: details and actions of the selected orchestrator, team, lead or worker. */

import type { JSX } from 'react';
import type { RunTaskResult, TaskProvenance } from '../../shared/types';
import { useRuns } from '../stores/runs';
import { useSessions } from '../stores/sessions';
import { useGraphStore, type GraphSelection } from './graphStore';
import {
  activeWorkerCount,
  statusFor,
  type GraphMember,
  type NodeStatus,
  type RunClusterModel,
  type TeamModel,
} from './graphModel';
import { runtimeVisual } from './runtimeGlyphs';
import { cancelTeamTasks, openParticipantTerminal, setTeamPause } from './graphActions';
import { ActivityFeed } from './ActivityFeed';
import { ResultDetails, outcomeText } from './ResultDetails';
import { errorText, statusText, taskStatusText } from './graphText';
import { I, Ico } from './graphIcons';
import type { ComposerTarget } from './Composer';

interface GraphInspectorProps {
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

export function GraphInspector(props: GraphInspectorProps): JSX.Element | null {
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
      <aside className="ginspector" aria-label={translate("Details")}>
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
      <aside className="ginspector" aria-label={translate("Details")}>
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
    <aside className="ginspector" aria-label={translate("Details")}>
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
      <button type="button" className="ginsp-close" aria-label={translate("Close details")} title={translate("Close details")} onClick={props.onClose}><Ico>{I.close}</Ico></button>
    </div>
  );
}

function KV({ k, v }: { k: string; v: string }): JSX.Element {
  useLocale();
  return <div className="gkv"><span>{k}</span><span className="val">{v}</span></div>;
}
