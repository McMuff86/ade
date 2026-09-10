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

export function Graph({ run: suppliedRun, host, catalog, selectedParticipant, onSelect }: { run: MobileRunSummary | undefined; host: MobileHost; catalog: MobileCatalog | null;
  selectedParticipant: string | null; onSelect: (id: string) => void;
}): JSX.Element {
  const [filesOpen, setFilesOpen] = useState(false); const filePort = useRunFilesPort(host);
  const [zoom, setZoom] = useState(1);
  const { data, error, refresh } = useRunActivity(host, suppliedRun?.id);
  const run = data?.run.id === suppliedRun?.id && data && data.run.updatedAt >= suppliedRun!.updatedAt ? data.run : suppliedRun;
  const space = useRef<HTMLDivElement>(null);
  const fit = () => {
    const content = space.current; const viewport = content?.parentElement;
    if (content && viewport) setZoom(Math.max(.5, Math.min(1, viewport.clientWidth / content.scrollWidth, viewport.clientHeight / content.scrollHeight)));
  };
  if (!run) return <div className="m-graph"><Empty title="Dein Graph ist bereit"><p>Starte eine Aufgabe oder bereite einen Run vor. Hier siehst du das Team und seinen Fortschritt.</p></Empty></div>;
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
    const matches = catalog?.agents.filter((agent) => agent.name === participant.agentName) ?? [];
    const visual = matches.length === 1 ? runtimeVisual(matches[0]!.runtime) : null;
    const Glyph = visual?.Glyph;
    return <button className="m-graph-node" data-testid="mobile-graph-node" key={participant.id}
      aria-label={`Agent ${participant.agentName} · ${participant.role}`} aria-pressed={selectedParticipant === participant.id}
      onClick={(event) => { event.currentTarget.focus(); onSelect(participant.id); }}>
      <Chrome><span>ade · {participant.role}</span></Chrome>
      <span className="m-node-body"><span className="m-node-glyph" style={{ color: visual?.color }}>{Glyph ? <Glyph /> : <Avatar name={participant.agentName} size={38} />}</span>
        <strong>{participant.agentName}</strong><Status status={active ? 'running' : latest?.status ?? 'bereit'} />
        <small>{tasks.length} Tasks · {visual?.label ?? 'Agent'}</small>
        {active && <small>{outputAge(observation?.lastOutputAt, data?.checkedAt ?? Date.now())}</small>}
        {observation?.activity.at(-1) && <small>{observation.activity.at(-1)!.text}</small>}
        {observation?.fileChanges && observation.fileChanges.source === 'observed' && <small>{observation.fileChanges.created} neu · {observation.fileChanges.modified} verändert · {observation.fileChanges.deleted} gelöscht</small>}
        <small>Aktivität, Ergebnis & Dateien ansehen</small>
      </span>
    </button>;
  };
  return <div className="m-graph" data-testid="mobile-graph">
    {filesOpen && <Dialog title="Dateien dieses Runs" onClose={() => setFilesOpen(false)} fallbackId="view-tab-graph"><RunFilesPanel runId={run.id} port={filePort} online={host.status === 'online'} identity={host.identityVersion} errorText={workspaceError} /></Dialog>}
    <div className="m-graph-activity-bar"><span>{run.name} · {run.status}</span><button disabled={host.status !== 'online'} onClick={refresh}>Run aktualisieren</button><button onClick={() => setFilesOpen(true)}>Dateien dieses Runs</button>
      {error && <span role="alert">{error}</span>}</div>
    <div className="m-graph-scroll" tabIndex={0} aria-label="Graph-Canvas, zum Verschieben scrollen" onKeyDown={(event) => {
      if (event.target !== event.currentTarget) return;
      if (event.key === '+' || event.key === '=') { event.preventDefault(); setZoom((value) => Math.min(1.5, value + .1)); }
      if (event.key === '-') { event.preventDefault(); setZoom((value) => Math.max(.5, value - .1)); }
      if (event.key === '0') { event.preventDefault(); setZoom(1); }
    }}>
      <div className="m-graph-space" ref={space} style={{ zoom }}>
        <div className={`m-graph-scene ${orchestrators.length ? 'm-has-coordinator' : ''}`}>
          {!!orchestrators.length && <div className="m-orchestrators">{orchestrators.map(node)}</div>}
          <div className="m-team-grid">{[...groups].map(([id, team]) => <section className="m-team" key={id} aria-label={`Team ${team.name}`}>
            <Chrome><span>team · <strong>{team.name}</strong></span>{run.pausedTeamIds.includes(id) && <Status status="paused" />}</Chrome>
            <div className="m-team-nodes">{team.members.map(node)}</div>
          </section>)}</div>
          {!run.participants.length && <Empty title="Noch keine Teilnehmer"><p>Für diesen Run sind keine Agents hinterlegt.</p></Empty>}
        </div>
      </div>
    </div>
    <div className="m-graph-legend"><span className="m-live-dot" />Teamstruktur · {run.participants.length} Agents</div>
    <div className="m-zoom" aria-label="Graph-Zoom"><button aria-label="Graph vergrössern" disabled={zoom >= 1.5} onClick={() => setZoom((value) => Math.min(1.5, value + .1))}><Icon name="plus" /></button>
      <output aria-live="polite">{Math.round(zoom * 100)}%</output><button aria-label="Graph verkleinern" disabled={zoom <= .5} onClick={() => setZoom((value) => Math.max(.5, value - .1))}>−</button>
      <button aria-label="Graph einpassen" onClick={fit}>⊡</button><button aria-label="Graph-Zoom zurücksetzen" onClick={() => setZoom(1)}>1:1</button></div>
  </div>;
}
