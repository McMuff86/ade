import { localizedState } from '../../shared/i18n/states';
import { localizeAppMessage } from '../../shared/i18n/appMessages';
import { intlLocale } from '../../shared/i18n';
import { t as translate } from "../../shared/i18n";
import { useLocale } from "../i18n/language";
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { useAppData } from '../stores/appdata';
import { useRuns } from '../stores/runs';
import { useMode } from '../stores/mode';
import { Avatar } from '../rail/Avatar';
import { useOnboarding } from '../onboarding/useOnboarding';
import { OnboardingModals } from '../onboarding/OnboardingModals';
import { RunReportPanel } from '../graph/RunReportPanel';
import { SingleTaskModal } from './SingleTaskModal';
import { CliWorkPanel } from './CliWorkPanel';
import './work.css';

const finished = new Set(['completed', 'failed', 'cancelled']);
const NewRunModal = lazy(() => import('../graph/GraphView').then(module => ({ default: module.NewRunModal })));

/** Desktop counterpart of mobile Work, using the existing renderer-safe run view. */
export function WorkView() {
  useLocale();
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
  return <section className={`work-view${report ? ' work-inspecting' : ''}`} aria-label={translate("Jobs")}>
    <header className="work-toolbar"><h1 ref={fallback} tabIndex={-1}>{translate("Jobs")}</h1><span>{runs.length}{" "}{translate("Runs")}</span>
      <button className="work-quiet" disabled={loading} onClick={() => void reload()}>{translate("Refresh")}</button>
      <button onClick={() => setComposer('task')}>{translate("Assign agent work")}</button>
      <button className="work-primary" onClick={() => setComposer('run')}>{translate("New Run")}</button>
    </header>
    {error && <p role="alert">{translate("Runs could not be loaded:")}{" "}{localizeAppMessage(error)}</p>}
    <div className="work-filters">
      <label>{translate("Project filters")}<select aria-label={translate("Project filters")} value={project} onChange={event => { setProject(event.target.value); filterChanged(); }}><option value="">{translate("All projects")}</option>{repositories.map(repo => <option key={repo.id} value={repo.id}>{repo.name}</option>)}</select></label>
      <label>{translate("Agent filter")}<select aria-label={translate("Agent filter")} value={agent} onChange={event => { setAgent(event.target.value); filterChanged(); }}><option value="">{translate("All agents")}</option>{Object.values(agents).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <p>{rows.filter(row => !finished.has(row.run.status)).length}{" "}{translate("Open runs in this selection")}</p>
    </div>
    <div className="work-body"><aside aria-label={translate("Agent workspaces")} className="work-agents"><h2>{translate("Agents")}</h2>
      {!Object.keys(agents).length && <p>{translate("No agents yet")}</p>}
      {Object.values(agents).map(item => <button key={item.id} aria-label={item.name} title={translate("Open agent profile")} onClick={() => useOnboarding.getState().openAgentCard(item.id)}><Avatar name={item.name} photo={item.photo} runtime={item.runtime} shape="round" size={26} /><span>{item.name}</span></button>)}
    </aside><div className="work-content">
      <CliWorkPanel project={project} profile={agent} />
      <h2>{translate("Managed runs")}</h2>
      <div className="work-filters"><label>{translate("Search for runs")}<input type="search" value={search} placeholder={translate("Name, project or agent")} onChange={event => setSearch(event.target.value)} /></label>
        <label>{translate("Status [53746174]")}<select aria-label={translate("Status [53746174]")} value={status} onChange={event => setStatus(event.target.value)}><option value="all">{translate("All runs")}</option><option value="open">{translate("Open runs")}</option><option value="finished">{translate("Completed runs")}</option></select></label></div>
      {loading && <p role="status">{translate("Loading runs…")}</p>}
      {!loading && !error && !visible.length && <div className="work-empty"><h2>{runs.length ? translate("No matching runs") : translate("No runs yet")}</h2><p>{runs.length ? translate("Change search or filter.") : translate("Start a task or prepare a managed run.")}</p></div>}
      <ul className="work-list">{visible.map(({ run, repository, members }) => <li key={run.id}>
        <button className="work-row" aria-pressed={report === run.id} onClick={() => { setActiveRun(run.id); setReport(run.id); }}>
          <strong>{run.name}</strong><span>{repository || translate("Personal workspace")}</span><span>{localizedState(run.status)} · {localizedState(run.phase)}</span>
          <span>{members.map(member => member.agentName).join(', ')}</span><span>{tasks.filter(task => task.runId === run.id).length}{" "}{translate("Tasks ·")}{" "}{new Date(run.updatedAt).toLocaleString(intlLocale())}</span>
        </button><button aria-label={translate("Open in the graph: {{value1}}", { value1: run.name })} onClick={() => { setActiveRun(run.id); useMode.getState().setMode('graph'); requestAnimationFrame(() => document.getElementById('mode-tab-graph')?.focus()); }}>{translate("Open the graph")}</button>
      </li>)}</ul>
    </div></div>
    {report && <RunReportPanel key={report} runId={report} seqCursor={seqCursor} fallbackFocusRef={fallback} onClose={() => setReport(null)} />}
    {composer === 'run' && <Suspense fallback={<p role="status">{translate('Loading…')} <button type="button" onClick={() => setComposer(null)}>{translate('Cancel')}</button></p>}><NewRunModal categories={categories} agents={agents} repositories={repositories} suggestedName={`Run ${runs.length + 1}`} onCancel={() => setComposer(null)} onCreate={async input => { await createRun(input); setComposer(null); }} /></Suspense>}
    {composer === 'task' && <SingleTaskModal initialAgent={agent} initialRepository={project} onClose={() => setComposer(null)} onSubmitted={runId => { setComposer(null); void reload().then(() => { setActiveRun(runId); setReport(runId); }); }} />}
    <OnboardingModals />
  </section>;
}
