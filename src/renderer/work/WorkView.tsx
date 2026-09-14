import { useEffect, useRef, useState } from 'react';
import { useAppData } from '../stores/appdata';
import { useRuns } from '../stores/runs';
import { useMode } from '../stores/mode';
import { Avatar } from '../rail/Avatar';
import { useOnboarding } from '../onboarding/useOnboarding';
import { OnboardingModals } from '../onboarding/OnboardingModals';
import { NewRunModal } from '../graph/GraphView';
import { RunReportPanel } from '../graph/RunReportPanel';
import { SingleTaskModal } from './SingleTaskModal';
import { CliWorkPanel } from './CliWorkPanel';
import './work.css';

const finished = new Set(['completed', 'failed', 'cancelled']);

/** Desktop counterpart of mobile Work, using the existing renderer-safe run view. */
export function WorkView() {
  const { agents, repositories, categories } = useAppData();
  const { runs, participants, tasks, seqCursor, refresh, createRun, setActiveRun } = useRuns();
  const [project, setProject] = useState('');
  const [agent, setAgent] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [report, setReport] = useState<string | null>(null);
  const [composer, setComposer] = useState<'run' | 'task' | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const fallback = useRef<HTMLHeadingElement>(null);
  const version = useRef(0);
  const reload = async () => {
    const request = ++version.current; setLoading(true);
    try { await refresh(); if (request === version.current) setError(''); }
    catch (reason) { if (request === version.current) setError(String(reason)); }
    finally { if (request === version.current) setLoading(false); }
  };
  useEffect(() => { void reload(); return () => { version.current++; }; }, []);
  useEffect(() => { if (report && !runs.some(run => run.id === report)) setReport(null); }, [runs, report]);
  const rows = runs.map(run => ({ run,
    repository: repositories.find(repo => repo.id === run.repositoryId)?.name ?? '',
    members: participants.filter(member => member.runId === run.id),
  })).filter(row => (!project || row.run.repositoryId === project) && (!agent || row.members.some(member => member.agentId === agent)));
  const visible = rows.filter(row => (status === 'all' || (status === 'open') === !finished.has(row.run.status))
    && `${row.run.name} ${row.repository} ${row.members.map(member => member.agentName).join(' ')}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()))
    .sort((a, b) => b.run.updatedAt - a.run.updatedAt);
  const filterChanged = () => setReport(null);
  return <section className={`work-view${report ? ' work-inspecting' : ''}`} aria-label="Work">
    <header className="work-toolbar"><h1 ref={fallback} tabIndex={-1}>Work</h1><span>{runs.length} Runs</span>
      <button disabled={loading} onClick={() => void reload()}>Aktualisieren</button>
      <button onClick={() => setComposer('task')}>Neue Aufgabe</button>
      <button onClick={() => setComposer('run')}>Neuer Run</button>
    </header>
    {error && <p role="alert">Runs konnten nicht geladen werden: {error}</p>}
    <div className="work-filters">
      <label>Projektfilter<select aria-label="Projektfilter" value={project} onChange={event => { setProject(event.target.value); filterChanged(); }}><option value="">Alle Projekte</option>{repositories.map(repo => <option key={repo.id} value={repo.id}>{repo.name}</option>)}</select></label>
      <label>Agentfilter<select aria-label="Agentfilter" value={agent} onChange={event => { setAgent(event.target.value); filterChanged(); }}><option value="">Alle Agents</option>{Object.values(agents).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <p>{rows.filter(row => !finished.has(row.run.status)).length} offene Runs in dieser Auswahl</p>
    </div>
    <div className="work-body"><aside aria-label="Agent-Workspaces" className="work-agents"><h2>Agents</h2>
      {!Object.keys(agents).length && <p>Noch keine Agents</p>}
      {Object.values(agents).map(item => <button key={item.id} aria-label={item.name} title="Agentprofil öffnen" onClick={() => useOnboarding.getState().openAgentCard(item.id)}><Avatar name={item.name} photo={item.photo} shape="round" size={26} /><span>{item.name}</span></button>)}
    </aside><div className="work-content">
      <CliWorkPanel project={project} profile={agent} />
      <h2>Managed Runs</h2>
      <div className="work-filters"><label>Runs durchsuchen<input type="search" value={search} placeholder="Name, Projekt oder Agent" onChange={event => setSearch(event.target.value)} /></label>
        <label>Status<select aria-label="Status" value={status} onChange={event => setStatus(event.target.value)}><option value="all">Alle Runs</option><option value="open">Offene Runs</option><option value="finished">Beendete Runs</option></select></label></div>
      {loading && <p role="status">Runs werden geladen…</p>}
      {!loading && !error && !visible.length && <div className="work-empty"><h2>{runs.length ? 'Keine passenden Runs' : 'Noch keine Runs'}</h2><p>{runs.length ? 'Suche oder Filter ändern.' : 'Starte eine Aufgabe oder bereite einen Managed Run vor.'}</p></div>}
      <ul className="work-list">{visible.map(({ run, repository, members }) => <li key={run.id}>
        <button className="work-row" aria-pressed={report === run.id} onClick={() => { setActiveRun(run.id); setReport(run.id); }}>
          <strong>{run.name}</strong><span>{repository || 'Eigener Workspace'}</span><span>{run.status} · {run.phase}</span>
          <span>{members.map(member => member.agentName).join(', ')}</span><span>{tasks.filter(task => task.runId === run.id).length} Tasks · {new Date(run.updatedAt).toLocaleString()}</span>
        </button><button aria-label={`Im Graph öffnen: ${run.name}`} onClick={() => { setActiveRun(run.id); useMode.getState().setMode('graph'); requestAnimationFrame(() => document.getElementById('mode-tab-graph')?.focus()); }}>Graph öffnen</button>
      </li>)}</ul>
    </div></div>
    {report && <RunReportPanel key={report} runId={report} seqCursor={seqCursor} fallbackFocusRef={fallback} onClose={() => setReport(null)} />}
    {composer === 'run' && <NewRunModal categories={categories} agents={agents} repositories={repositories} suggestedName={`Run ${runs.length + 1}`} onCancel={() => setComposer(null)} onCreate={async input => { await createRun(input); setComposer(null); }} />}
    {composer === 'task' && <SingleTaskModal initialAgent={agent} initialRepository={project} onClose={() => setComposer(null)} onSubmitted={runId => { setComposer(null); void reload().then(() => { setActiveRun(runId); setReport(runId); }); }} />}
    <OnboardingModals />
  </section>;
}
