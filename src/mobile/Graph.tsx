import { localizedState } from '../shared/i18n/states';
import { localizeAppMessage } from '../shared/i18n/appMessages';
import { t as translate } from "../shared/i18n";
import { useLocale } from "../renderer/i18n/language";
import { useRef, useState, type JSX } from 'react';
import type { MobileCatalog, MobileRunSummary } from '../shared/remote';
import type { RunSummaryParticipant } from '../shared/types';
import { Avatar } from '../renderer/rail/Avatar';
import { runtimeVisual } from '../renderer/graph/runtimeGlyphs';
import { Chrome, Dialog, Empty, Icon, Status } from './ui';
import { outputAge, useRunActivity } from './RunActivityPanel';
import type { MobileHost } from './useMobileHost';
import { RunFilesPanel } from '../renderer/graph/RunFilesPanel';
import { useRunFilesPort } from './useRunFilesPort';
import { workspaceError } from './AgentWorkspace';

export function Graph({ run: suppliedRun, host, selectedParticipant, onSelect }: { run: MobileRunSummary | undefined; host: MobileHost; catalog: MobileCatalog | null;
  selectedParticipant: string | null; onSelect: (id: string) => void;
}): JSX.Element {
  useLocale();
  const [filesOpen, setFilesOpen] = useState(false); const filePort = useRunFilesPort(host);
  const [zoom, setZoom] = useState(1);
  const { data, error, refresh } = useRunActivity(host, suppliedRun?.id);
  const run = data?.run.id === suppliedRun?.id && data && data.run.updatedAt >= suppliedRun!.updatedAt ? data.run : suppliedRun;
  const space = useRef<HTMLDivElement>(null);
  const fit = () => {
    const content = space.current; const viewport = content?.parentElement;
    if (content && viewport) setZoom(Math.max(.5, Math.min(1, viewport.clientWidth / content.scrollWidth, viewport.clientHeight / content.scrollHeight)));
  };
  if (!run) return <div className="m-graph"><Empty title={translate("Your graph is ready")}><p>{translate("Start a task or prepare a run. Here you see the team and its progress.")}</p></Empty></div>;
  const orchestrators = run.participants.filter((participant) => participant.role === 'orchestrator');
  const members = run.participants.filter((participant) => participant.role !== 'orchestrator');
  const groups = new Map<string, { name: string; members: RunSummaryParticipant[] }>();
  for (const participant of members) {
    const key = participant.teamId ?? 'unassigned';
    if (!groups.has(key)) groups.set(key, { name: participant.teamName ?? 'Agents', members: [] });
    groups.get(key)!.members.push(participant);
  }
  const node = (participant: RunSummaryParticipant) => {
    const tasks = run.tasks.filter((task) => task.participantId === participant.id);
    const latest = [...tasks].sort((a, b) => b.createdAt - a.createdAt)[0];
    const active = tasks.some((task) => task.status === 'running');
    const observation = data?.tasks.find((item) => item.id === (tasks.find((task) => task.status === 'running') ?? latest)?.id);
    const visual = participant.runtime ? runtimeVisual(participant.runtime) : null;
    const Glyph = visual?.Glyph;
    return <button className="m-graph-node" data-testid="mobile-graph-node" key={participant.id}
      aria-label={translate("Agent {{value1}} · {{value2}}", { value1: participant.agentName, value2: participant.role })} aria-pressed={selectedParticipant === participant.id}
      onClick={(event) => { event.currentTarget.focus(); onSelect(participant.id); }}>
      <Chrome><span>{translate("ade ·")}{" "}{participant.role}</span></Chrome>
      <span className="m-node-body"><span className="m-node-glyph" style={{ color: visual?.color }}>{Glyph ? <Glyph /> : <Avatar name={participant.agentName} size={38} />}</span>
        <strong>{participant.agentName}</strong><Status status={active ? 'running' : latest?.status ?? translate("ready")} />
        <small>{tasks.length}{" "}{translate("Tasks ·")}{" "}{visual?.label ?? 'Agent'}</small>
        {active && <small>{outputAge(observation?.lastOutputAt, data?.checkedAt ?? Date.now())}</small>}
        {observation?.activity.at(-1) && <small>{observation.activity.at(-1)!.text}</small>}
        {observation?.fileChanges && observation.fileChanges.source === 'observed' && <small>{observation.fileChanges.created}{" "}{translate("new ·")}{" "}{observation.fileChanges.modified}{" "}{translate("modified ·")}{" "}{observation.fileChanges.deleted}{" "}{translate("deleted")}</small>}
        <small>{translate("View activity, result & files")}</small>
      </span>
    </button>;
  };
  return <div className="m-graph" data-testid="mobile-graph">
    {filesOpen && <Dialog title={translate("Files of this run")} onClose={() => setFilesOpen(false)} fallbackId="view-tab-graph"><RunFilesPanel runId={run.id} port={filePort} online={host.status === 'online'} identity={host.identityVersion} errorText={workspaceError} /></Dialog>}
    <div className="m-graph-activity-bar"><span>{run.name} · {localizedState(run.status)}</span><div className="m-graph-action-group" role="group" aria-label={translate("Run")}><button disabled={host.status !== 'online'} onClick={refresh}>{translate("Refresh run")}</button></div><div className="m-graph-action-group" role="group" aria-label={translate("Results")}><button onClick={() => setFilesOpen(true)}>{translate("Files of this run")}</button></div>
      {error && <span role="alert">{localizeAppMessage(error)}</span>}</div>
    <div className="m-graph-scroll" tabIndex={0} aria-label={translate("Graph canvas; scroll to pan")} onKeyDown={(event) => {
      if (event.target !== event.currentTarget) return;
      if (event.key === '+' || event.key === '=') { event.preventDefault(); setZoom((value) => Math.min(1.5, value + .1)); }
      if (event.key === '-') { event.preventDefault(); setZoom((value) => Math.max(.5, value - .1)); }
      if (event.key === '0') { event.preventDefault(); setZoom(1); }
    }}>
      <div className="m-graph-space" ref={space} style={{ zoom }}>
        <div className={`m-graph-scene ${orchestrators.length ? 'm-has-coordinator' : ''}`}>
          {!!orchestrators.length && <div className="m-orchestrators">{orchestrators.map(node)}</div>}
          <div className="m-team-grid">{[...groups].map(([id, team]) => <section className="m-team" key={id} aria-label={translate("Team {{value1}}", { value1: team.name })}>
            <Chrome><span>{translate("team ·")}{" "}<strong>{team.name}</strong></span>{run.pausedTeamIds.includes(id) && <Status status="paused" />}</Chrome>
            <div className="m-team-nodes">{team.members.map(node)}</div>
          </section>)}</div>
          {!run.participants.length && <Empty title={translate("No participants yet")}><p>{translate("There are no agents for this run.")}</p></Empty>}
        </div>
      </div>
    </div>
    <div className="m-graph-legend"><span className="m-live-dot" />{translate("Team structure ·")}{" "}{run.participants.length}{" "}{translate("Agents")}</div>
    <div className="m-zoom" role="group" aria-label={translate("Graph Zoom")}><button aria-label={translate("Zoom in")} disabled={zoom >= 1.5} onClick={() => setZoom((value) => Math.min(1.5, value + .1))}><Icon name="plus" /></button>
      <output aria-live="polite">{Math.round(zoom * 100)}%</output><button aria-label={translate("Zoom out")} disabled={zoom <= .5} onClick={() => setZoom((value) => Math.max(.5, value - .1))}>−</button>
      <button aria-label={translate("Fit graph to view")} onClick={fit}>⊡</button><button aria-label={translate("Reset graph zoom")} onClick={() => setZoom(1)}>1:1</button></div>
  </div>;
}
