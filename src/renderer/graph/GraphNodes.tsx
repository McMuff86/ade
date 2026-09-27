import { t as translate } from "../../shared/i18n";
import { useLocale } from "../i18n/language";
/** Canvas nodes: the run cluster frame, orchestrator and member cards, team frames. */

import type { JSX } from 'react';
import type { Repository, Run, RunUsage } from '../../shared/types';
import type { GraphSelection, Pos } from './graphStore';
import type { GraphMember, NodeStatus, RunClusterModel, TeamModel } from './graphModel';
import { runtimeVisual } from './runtimeGlyphs';
import { cancelTeamTasks, openParticipantTerminal, setTeamPause } from './graphActions';
import { CLUSTER_H, CLUSTER_PAD, ORCH_W, clusterWidth, teamWidth } from './graphLayout';
import { errorText, phaseText, runStatusText, statusText } from './graphText';
import { I, Ico } from './graphIcons';

export type DragKind = 'cluster' | 'node';

/** Everything a node needs from the canvas: layout, selection, pulses and actions. */
export interface GraphNodeContext {
  activeRunId: string | null;
  flashes: Record<string, 'ok' | 'bad'>;
  isSelected: (candidate: GraphSelection) => boolean;
  clusterPos: (runId: string) => Pos;
  nodePos: (runId: string, key: string) => Pos;
  branchFor: (run: Run, agentId: string) => string | null;
  nodeStatus: (cluster: RunClusterModel, member: GraphMember, idle: boolean) => NodeStatus;
  selectInCluster: (runId: string, sel: GraphSelection | null) => void;
  startDrag: (
    kind: DragKind,
    runId: string,
    key: string,
    event: React.PointerEvent,
    onPlainClick?: () => void,
  ) => void;
  setTeamIdle: (teamId: string, idle: boolean) => void;
  flash: (message: string) => void;
}

/**
 * Keyboard path for canvas nodes (cards, team bars, cluster bars): Enter or
 * Space selects; Enter on an already selected, available card opens its
 * terminal like a double-click. Escape on the canvas clears the selection.
 */
export const nodeKeyHandler = (
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

export function RunCluster(props: {
  cluster: RunClusterModel;
  ctx: GraphNodeContext;
  repository: Repository | null | undefined;
  usage: RunUsage | undefined;
  approvalPending: boolean;
}): JSX.Element {
  useLocale();
  const { cluster, ctx, repository, usage } = props;
  const { run } = cluster;
  const position = ctx.clusterPos(run.id);
  // The frame is the bounding box of its (freely draggable) children, so a
  // dragged card or team grows the frame instead of escaping it.
  const orchestratorBounds = ctx.nodePos(run.id, 'orchestrator');
  const width = Math.max(
    clusterWidth(cluster),
    orchestratorBounds.x + ORCH_W + CLUSTER_PAD,
    ...cluster.teams.map((team) =>
      ctx.nodePos(run.id, team.id).x + teamWidth(1 + team.workers.length) + CLUSTER_PAD),
  );
  const height = Math.max(
    CLUSTER_H,
    orchestratorBounds.y + 210 + CLUSTER_PAD,
    ...cluster.teams.map((team) => ctx.nodePos(run.id, team.id).y + 236 + CLUSTER_PAD),
  );
  const active = run.id === ctx.activeRunId;
  return (
    <section
      className={`gcluster${active ? ' active' : ''}${cluster.terminal ? ' terminal' : ''}`}
      data-run-id={run.id}
      style={{ left: position.x, top: position.y, width, height }}
    >
      <header
        className="gcluster-bar"
        role="button"
        tabIndex={0}
        aria-pressed={active}
        aria-label={`Run ${run.name} · ${runStatusText(run.status)}${active ? translate(" · Selected") : ''}`}
        onPointerDown={(event) => ctx.startDrag('cluster', run.id, 'cluster', event, () => {
          ctx.selectInCluster(run.id, null);
        })}
        onKeyDown={nodeKeyHandler(() => ctx.selectInCluster(run.id, null), active)}
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
        {props.approvalPending && (
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

      {cluster.orchestrator && (
        <OrchestratorCard cluster={cluster} orchestrator={cluster.orchestrator} ctx={ctx} />
      )}

      {cluster.teams.map((team) => <TeamFrame key={team.id} cluster={cluster} team={team} ctx={ctx} />)}
    </section>
  );
}

function OrchestratorCard(props: {
  cluster: RunClusterModel;
  orchestrator: GraphMember;
  ctx: GraphNodeContext;
}): JSX.Element {
  useLocale();
  const { cluster, orchestrator, ctx } = props;
  const { run } = cluster;
  const runtime = runtimeVisual(orchestrator.runtime ?? 'claude');
  const position = ctx.nodePos(run.id, 'orchestrator');
  const selected = ctx.isSelected({ kind: 'orchestrator', id: orchestrator.id });
  const flashClass = ctx.flashes[orchestrator.id] ? ` gflash-${ctx.flashes[orchestrator.id]}` : '';
  const status = ctx.nodeStatus(cluster, orchestrator, false);
  const branch = orchestrator.available ? ctx.branchFor(run, orchestrator.agentId) : null;
  const selectCard = (): void => ctx.selectInCluster(run.id, { kind: 'orchestrator', id: orchestrator.id });
  const openCard = (): void => {
    if (orchestrator.available) {
      void openParticipantTerminal(orchestrator.agentId, orchestrator.id, run.id);
    }
  };
  return (
    <div
      className={`gcard orch${selected ? ' sel' : ''}${orchestrator.available ? '' : ' unavailable'}${flashClass}`}
      data-status={status}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={`Orchestrator ${orchestrator.name} · ${run.name} · ${orchestrator.available ? statusText(status) : translate("Not in the catalogue")}`}
      style={{
        left: position.x,
        top: position.y,
        ['--rt' as string]: runtime.color,
      }}
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
      <div
        className="gcard-bar"
        onPointerDown={(event) => ctx.startDrag('node', run.id, 'orchestrator', event, selectCard)}
      >
        <div className="glights"><i className="r" /><i className="y" /><i className="g" /></div>
        <div className="gcard-title">{translate("ade · orchestrator")}</div>
      </div>
      <div className="gcard-body">
        <div className="gglyph"><runtime.Glyph /></div>
        <div className="gcard-name">{orchestrator.name}</div>
        {branch && (
          <div className="gcard-branch" title={translate("Worktree branch {{value1}}", { value1: branch })}>
            ⎇ {branch}
          </div>
        )}
        <div className="gchip" data-s={orchestrator.available ? status : 'failed'}>
          {orchestrator.available ? statusText(status) : translate("Not in the catalogue")}
        </div>
      </div>
      <i className="ganchor top" data-anchor={`${orchestrator.id}:top`} />
      <i className="ganchor bot" data-anchor={`${orchestrator.id}:bot`} />
    </div>
  );
}

function TeamFrame(props: { cluster: RunClusterModel; team: TeamModel; ctx: GraphNodeContext }): JSX.Element {
  useLocale();
  const { cluster, team, ctx } = props;
  const { run } = cluster;
  const teamPosition = ctx.nodePos(run.id, team.id);
  const selected = ctx.isSelected({ kind: 'team', id: team.id });
  const managed = run.mode === 'managed';
  return (
    <div
      className={`gteam${team.idle ? ' idle' : ''}${selected ? ' sel' : ''}`}
      style={{ left: teamPosition.x, top: teamPosition.y }}
    >
      <div
        className="gteam-bar"
        role="button"
        tabIndex={0}
        aria-pressed={selected}
        aria-label={`Team ${team.name} · ${run.name} · ${statusText(team.status)}${team.idle ? translate(" · paused") : ''}`}
        onPointerDown={(event) => ctx.startDrag('node', run.id, team.id, event, () => {
          ctx.selectInCluster(run.id, { kind: 'team', id: team.id });
        })}
        onKeyDown={nodeKeyHandler(() => ctx.selectInCluster(run.id, { kind: 'team', id: team.id }), selected)}
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
                  .then(() => ctx.flash(team.idle ? translate("Team scheduling continues") : translate("Team scheduling paused")))
                  .catch((error) => ctx.flash(errorText(error)));
              } else {
                ctx.setTeamIdle(team.id, !team.idle);
              }
            }}
          >
            <Ico>{team.idle ? I.play : I.pause}</Ico>
          </button>
          <button
            className="gtbtn"
            title={translate("Stop ongoing team tasks")}
            aria-label={translate("Stop ongoing team tasks")}
            onClick={() => void cancelTeamTasks(team.id).then(() => ctx.flash(translate("Team tasks stopped")))}
          >
            <Ico>{I.stop}</Ico>
          </button>
        </div>
      </div>
      <div className="gteam-members">
        {team.lead && <MemberCard key={team.lead.id} cluster={cluster} team={team} member={team.lead} role="lead" ctx={ctx} />}
        {team.workers.map((worker) => (
          <MemberCard key={worker.id} cluster={cluster} team={team} member={worker} role="worker" ctx={ctx} />
        ))}
      </div>
    </div>
  );
}

function MemberCard(props: {
  cluster: RunClusterModel;
  team: TeamModel;
  member: GraphMember;
  role: 'lead' | 'worker';
  ctx: GraphNodeContext;
}): JSX.Element {
  useLocale();
  const { cluster, team, member, role, ctx } = props;
  const runtime = runtimeVisual(member.runtime);
  const status = ctx.nodeStatus(cluster, member, team.idle);
  const selected = ctx.isSelected({ kind: role, id: member.id });
  const flashClass = ctx.flashes[member.id] ? ` gflash-${ctx.flashes[member.id]}` : '';
  const branch = member.available ? ctx.branchFor(cluster.run, member.agentId) : null;
  const selectCard = (): void => ctx.selectInCluster(cluster.run.id, { kind: role, id: member.id, teamId: team.id });
  const openCard = (): void => {
    if (member.available) void openParticipantTerminal(member.agentId, member.id, cluster.run.id);
  };
  return (
    <div
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
}
