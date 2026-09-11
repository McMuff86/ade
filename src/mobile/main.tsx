import { useEffect, useLayoutEffect, useRef, useState, type JSX } from 'react';
import { createRoot } from 'react-dom/client';
import { useMobileHost, type PendingCommand } from './useMobileHost';
import { Dialog, Empty, finalStates, Icon, Status, VIEWS, type View } from './ui';
import { Overview, RunRow } from './Overview';
import { Graph } from './Graph';
import { RunInspector } from './RunInspector';
import { HostRestartSection } from './HostRestartSection';
import { compareBuilds } from '../shared/buildInfo';
import { RemoteManager, useRemoteAdministration } from './RemoteManager';
import { AgentWorkspace } from './AgentWorkspace';
import { ContinueWork } from './ContinueWork';
import { ProjectStart } from './ProjectStart';
import { Projects, ProjectWorkspace } from './Projects';
import type { ProjectOpenIntent } from './ProjectDirectoryPage';
import { useDeviceDraft } from './deviceDrafts';
import { TabletKeyboardContext, useTabletViewport } from './useTabletViewport';
import { useFileDrafts } from './FileEditor';
import { MobileAvatar, useProfileDrafts } from './AgentProfile';
import { completeProjectDraft, filterProjectRuns, initialProjectDraft, selectProjectDraft, updateProjectDraft } from './projectDrafts';
import { emptyDraft, PendingNotice, WorkComposer, type WorkDraft } from './WorkComposer';
import '../renderer/theme/tokens.css';
import './mobile.css';
import './tablet.css';

function preference(key: string, fallback: string): string { try { return localStorage.getItem(`ade-mobile-${key}`) ?? fallback; } catch { return fallback; } }
function savePreference(key: string, value: string): void { try { localStorage.setItem(`ade-mobile-${key}`, value); } catch { /* Appearance remains available without storage. */ } }
function pairFragment(): string {
  const code = new URLSearchParams(location.hash.slice(1)).get('pair') ?? '';
  if (location.hash) history.replaceState(null, '', '/'); return code;
}

function MobileApp(): JSX.Element {
  const host = useMobileHost();
  const admin = useRemoteAdministration(host);
  const fileDrafts = useFileDrafts(host.identityVersion);
  const profileDrafts = useProfileDrafts(host.identityVersion);
  const [management, setManagement] = useState(false);
  const [workspace, setWorkspace] = useDeviceDraft<{ agentId: string; repositoryId: string | null; terminalId?: string; tab?: 'files' | 'terminal' } | null>(host.deviceId, 'last-workspace', null);
  const [projectStart, setProjectStart] = useState(false);
  const [projectIntent, setProjectIntent] = useState<ProjectOpenIntent>();
  const [projectWorkspace, setProjectWorkspace] = useDeviceDraft<string | null>(host.deviceId, 'open-project', null);
  const [profileIntent, setProfileIntent] = useState<{ agentId: string; key: string } | null>(null);
  const openTerminal = (agentId: string) => {
    setProfileIntent({ agentId, key: crypto.randomUUID() }); setWorkspace({ agentId, repositoryId: null, tab: 'terminal' });
  };
  const keyboardOpen = useTabletViewport();
  const openAgent = (agentId: string) => setWorkspace({ agentId, repositoryId: projectFilter || host.catalog?.agents.find((agent) => agent.id === agentId)?.defaultRepositoryId || null });
  const openProject = (repositoryId: string) => {
    setWorkspace(null); setProjectWorkspace(null); setView('projects'); setProjectIntent({ key: crypto.randomUUID(), repositoryId });
  };
  const [challenge, setChallenge] = useState(pairFragment);
  const [deviceName, setDeviceName] = useState('Mein Mobilgerät');
  const [theme, setTheme] = useState<'dark' | 'light'>(() => preference('theme', 'dark') === 'light' ? 'light' : 'dark');
  const [view, setView] = useState<View>(() => { const value = preference('view', 'overview'); return value === 'work' || value === 'graph' || value === 'projects' ? value : 'overview'; });
  const [draftState, setDraftState, draftsDurable] = useDeviceDraft(host.deviceId, 'task-drafts', initialProjectDraft(emptyDraft()));
  const draft = draftState.drafts[draftState.active]!;
  const setDraft = (value: WorkDraft | ((current: WorkDraft) => WorkDraft)) => setDraftState((current) =>
    updateProjectDraft(current, typeof value === 'function' ? value(current.drafts[current.active]!) : value));
  const [projectFilter, setProjectFilter] = useState('');
  const [agentFilter, setAgentFilter] = useState('');
  const [composer, setComposer] = useState(false);
  const [settings, setSettings] = useState(false);
  const [selected, setSelected] = useState<{ runId: string; participantId: string | null } | null>(null);
  const [graphRunId, setGraphRunId] = useState('');
  const [focusVersion, setFocusVersion] = useState(0);
  const [filter, setFilter] = useState<'all' | 'open' | 'finished'>('all');
  const [search, setSearch] = useState('');
  const [compact, setCompact] = useState(() => matchMedia('(max-width: 699px)').matches);
  const inspectorOpener = useRef<HTMLElement | null>(null);
  const previousIdentity = useRef(host.identityVersion);

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme; savePreference('theme', theme);
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#0E0F12' : '#F3EFE7');
  }, [theme]);
  useEffect(() => { savePreference('view', view); }, [view]);
  useEffect(() => {
    const changed = () => { const code = pairFragment(); if (code) setChallenge(code); };
    const media = matchMedia('(max-width: 699px)'); const resize = () => setCompact(media.matches);
    window.addEventListener('hashchange', changed); media.addEventListener('change', resize);
    return () => { window.removeEventListener('hashchange', changed); media.removeEventListener('change', resize); };
  }, []);
  useEffect(() => {
    if (previousIdentity.current === host.identityVersion) return;
    previousIdentity.current = host.identityVersion;
    setDraftState(initialProjectDraft(emptyDraft())); setProjectFilter(''); setAgentFilter('');
    setSelected(null); setGraphRunId(''); setSearch(''); setComposer(false); setSettings(false); setManagement(false);
  }, [host.identityVersion]);
  useEffect(() => {
    if (!host.catalog) return;
    const catalog = host.catalog;
    setDraft((current) => ({ ...current,
      repositoryId: catalog.repositories.some((repo) => repo.id === current.repositoryId) ? current.repositoryId : catalog.repositories[0]?.id ?? '',
      agentIds: current.agentIds.filter((id) => catalog.agents.some((agent) => agent.id === id)),
    }));
  }, [host.catalog]);

  const runs = [...host.runs].sort((a, b) => b.updatedAt - a.updatedAt);
  const visibleRuns = filterProjectRuns(runs, projectFilter, agentFilter);
  const selectedRun = runs.find((run) => run.id === selected?.runId);
  const graphRun = visibleRuns.find((run) => run.id === graphRunId) ?? visibleRuns[0];
  const filtered = visibleRuns.filter((run) => (filter === 'all' || (filter === 'open') === !finalStates.has(run.status))
    && `${run.name} ${run.repositoryName ?? ''} ${run.participants.map((participant) => participant.agentName).join(' ')}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  const select = (runId: string, participantId: string | null = null) => {
    inspectorOpener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setSelected({ runId, participantId }); setFocusVersion((value) => value + 1);
  };
  const clearSelection = () => {
    setSelected(null);
    const opener = inspectorOpener.current;
    if (opener?.isConnected && !(opener instanceof HTMLButtonElement && opener.disabled)) opener.focus();
    else document.getElementById(`view-tab-${view}`)?.focus();
  };
  const navigate = (next: View) => { setView(next); setSelected(null); };
  const newWork = (mode: WorkDraft['mode'], agentId?: string, repositoryId?: string) => {
    setDraftState((current) => {
      const active = current.drafts[current.active]!;
      return selectProjectDraft(current, { ...active, mode, repositoryId: repositoryId ?? (projectFilter || active.repositoryId),
        agentIds: mode === 'task' ? active.agentIds.slice(0, 1) : active.agentIds }, agentId);
    }); setComposer(true);
  };
  const send = async (command: PendingCommand) => {
    const result = await host.send(command); if (!result) return;
    if (command.path === '/api/v1/tasks' || command.path === '/api/v1/runs') {
      const submitted = command.payload as { repositoryId: string; prompt?: string; goal?: string; name?: string };
      setDraftState((current) => completeProjectDraft(current, submitted.repositoryId, command.path === '/api/v1/tasks' ? 'task' : 'run',
        submitted.prompt ?? submitted.goal ?? '', submitted.name ?? ''));
      setProjectFilter(''); setAgentFilter(''); setComposer(false); setView('graph'); setGraphRunId(result.run.id);
    }
    select(result.run.id);
  };
  const inspector = selectedRun && <RunInspector run={selectedRun} participantId={selected?.participantId ?? null} host={host} onSend={(command) => void send(command)} focusVersion={focusVersion} />;

  return <TabletKeyboardContext.Provider value={keyboardOpen}><div className="m-app" onKeyDown={(event) => {
    if (event.key === 'Escape' && selected && !composer && !settings && !management && !compact) { event.preventDefault(); clearSelection(); }
  }}>
    <header className="m-titlebar"><button className="m-logo" id="mobile-title" onClick={() => navigate('overview')} aria-label="ADE Overview">ade<span>_</span></button>
      <span className="m-titlebar-sub">agentic development environment</span>
      {host.paired && <div className="m-view-switch" role="tablist" aria-label="View mode">{VIEWS.map((item, index) => <button key={item.id} id={`view-tab-${item.id}`} role="tab"
        aria-selected={view === item.id} aria-controls="mobile-view-panel" tabIndex={view === item.id ? 0 : -1} onClick={() => navigate(item.id)} onKeyDown={(event) => {
          const next = event.key === 'ArrowRight' ? (index + 1) % VIEWS.length : event.key === 'ArrowLeft' ? (index + VIEWS.length - 1) % VIEWS.length : event.key === 'Home' ? 0 : event.key === 'End' ? VIEWS.length - 1 : null;
          if (next !== null) { event.preventDefault(); navigate(VIEWS[next]!.id); document.getElementById(`view-tab-${VIEWS[next]!.id}`)?.focus(); }
        }}><Icon name={item.id} />{item.label}</button>)}</div>}
      <span className="m-header-spacer" /><span className={`m-connection ${host.status}`} role="status"><span className="m-live-dot" />{host.paired ? host.status === 'online' ? 'Verbunden' : host.status === 'connecting' ? 'Verbinde…' : 'Offline' : 'Privater Zugriff'}</span>
      <button className="m-icon-button" aria-label="Settings" title="Settings" onClick={(event) => { event.currentTarget.focus(); setSettings(true); }}><Icon name="settings" /></button>
      <button className="m-icon-button" aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'} onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}><Icon name={theme === 'dark' ? 'sun' : 'moon'} /></button>
    </header>
    <div className="m-messages">
      {host.status === 'online' && compareBuilds(admin.state?.build) === 'different' && <p className="m-notice">Browser und PC verwenden unterschiedliche Builds.
        <button onClick={(event) => { event.currentTarget.focus(); setSettings(true); }}>Build-Stand ansehen</button></p>}
      {host.error && !composer && <p className="m-alert" role="alert">{host.error}</p>}
      {host.notice && <p className="m-notice" role="status">{host.notice}<button aria-label="Hinweis schliessen" onClick={host.dismissNotice}><Icon name="close" /></button></p>}
      {host.paired && host.status !== 'online' && <p className="m-notice">Verbindung zum PC wird wiederhergestellt. Angezeigte Daten können veraltet sein; dein Entwurf bleibt erhalten.</p>}
      {!composer && <PendingNotice host={host} onRetry={(command) => void send(command)} />}
      {admin.pending && !management && <p className="m-notice">Eine Verwaltungsaktion ist noch nicht bestätigt. <button onClick={() => setManagement(true)}>Verwaltung öffnen</button></p>}
    </div>
    {host.paired === null ? <main className="m-pair"><p role="status">Geräteverbindung wird geladen…</p></main> : !host.paired ? <main className="m-pair">
      <div className="m-pair-mark">ade<span>_</span></div><h1>Mit deinem PC verbinden</h1><p>Tailscale auf diesem Gerät verbinden. In ADE am PC unter Einstellungen → Mobiler Zugriff einen Pairing-Code erstellen.</p>
      <section><h2>Gerät koppeln</h2><p>QR-Code am PC scannen oder den einmaligen Code hier einfügen. Er gilt fünf Minuten.</p>
        <form onSubmit={(event) => { event.preventDefault(); void host.pair(challenge.trim(), deviceName.trim()).then((ok) => {
          if (ok) { setChallenge(''); document.getElementById('mobile-title')?.focus(); }
        }); }}>
          <label>Gerätename<input value={deviceName} maxLength={80} autoComplete="off" required onChange={(event) => setDeviceName(event.target.value)} /></label>
          <label>Pairing-Code<input value={challenge} onChange={(event) => setChallenge(event.target.value)} maxLength={43} autoComplete="off" autoCapitalize="none" spellCheck={false} required /></label>
          <button className="m-primary" disabled={host.busy || !deviceName.trim() || !/^[A-Za-z0-9_-]{43}$/.test(challenge.trim())}>{host.busy ? 'Wird gekoppelt…' : 'Dieses Gerät verbinden'}</button>
        </form></section>
    </main> : <>
      <div className="m-toolbar"><div className="m-toolbar-context">{view === 'graph' ? <label className="m-sr-only-label">Aktiver Run<select aria-label="Aktiver Run" value={graphRun?.id ?? ''} onChange={(event) => { setGraphRunId(event.target.value); setSelected(null); }}>
        {!visibleRuns.length && <option value="">Kein Run</option>}{visibleRuns.map((run) => <option key={run.id} value={run.id}>{run.name}</option>)}</select></label> : <h1>{view === 'overview' ? 'Overview' : view === 'projects' ? 'Projekte' : 'Work'}</h1>}
        {view === 'graph' && graphRun && <Status status={graphRun.status} />}<span className="m-toolbar-note">{view === 'overview' ? 'Dein Workspace auf einen Blick' : view === 'projects' ? 'Projekt öffnen und loslegen' : view === 'work' ? `${runs.length} Runs` : graphRun?.phase ?? 'Orchestrierung'}</span></div>
        <div className="m-toolbar-actions"><button onClick={(event) => { event.currentTarget.focus(); setManagement(true); }}>Verwalten</button>{view === 'graph' && graphRun && <button aria-label="Run-Details öffnen" onClick={(event) => { event.currentTarget.focus(); select(graphRun.id); }}>Details</button>}
          <button disabled={host.status !== 'online'} onClick={host.refreshNow}>Aktualisieren</button>
          <button onClick={(event) => { event.currentTarget.focus(); setProjectStart(true); }}>Neues Projekt</button>
          {view !== 'projects' && <><button aria-label="Neue Aufgabe" disabled={host.busy || !!host.pending} onClick={(event) => { event.currentTarget.focus(); newWork('task'); }} title={draft.prompt && draft.mode === 'task' ? 'Entwurf fortsetzen' : 'Neue Aufgabe'}><Icon name="plus" />Neue Aufgabe{draft.prompt && draft.mode === 'task' && <span className="m-draft-dot" aria-label="Entwurf vorhanden" />}</button>
          <button className="m-primary" disabled={host.busy || !!host.pending} onClick={(event) => { event.currentTarget.focus(); newWork('run'); }}><Icon name="plus" />Neuer Run</button></>}</div>
      </div>
      {(view === 'work' || view === 'graph') && <div className="m-project-filters"><label>Projektfilter<select aria-label="Projektfilter" value={projectFilter} onChange={(event) => { setProjectFilter(event.target.value); setSelected(null); }}>
        <option value="">Alle Projekte</option>{host.catalog?.repositories.map((repo) => <option key={repo.id} value={repo.id}>{repo.name}</option>)}</select></label>
        <label>Agentfilter<select aria-label="Agentfilter" value={agentFilter} onChange={(event) => { setAgentFilter(event.target.value); setSelected(null); }}><option value="">Alle Agents</option>
          {host.catalog?.agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select></label>
        <p>{visibleRuns.filter((run) => !finalStates.has(run.status)).length} offene Runs in dieser Auswahl · Task-Slots gelten für alle Projekte.</p></div>}
      <div className={`m-workspace ${selectedRun && !compact ? 'm-inspecting' : ''}`}>
        <main id="mobile-view-panel" role="tabpanel" aria-labelledby={`view-tab-${view}`} className={`m-view m-view-${view}`} tabIndex={0}>
          {view === 'overview' ? <><ContinueWork host={host} onProject={openProject}
            onSession={(session) => { if (session.projectWorkspaceId) { setView('projects'); setProjectIntent({ key: crypto.randomUUID(), workspaceId: session.projectWorkspaceId, terminalId: session.id }); }
              else setWorkspace({ agentId: session.agentId!, repositoryId: session.repositoryId ?? null, terminalId: session.id, tab: 'terminal' }); }} />
            <Overview host={host} selected={selected?.runId ?? null} onRun={(id) => { setGraphRunId(id); setView('graph'); select(id); }} onAgent={openAgent} onTerminal={openTerminal} onProject={openProject} /></>
            : view === 'projects' ? <Projects host={host} onProject={setProjectWorkspace} intent={projectIntent} onIntentConsumed={() => setProjectIntent(undefined)} />
            : view === 'graph' ? <Graph run={graphRun} host={host} catalog={host.catalog} selectedParticipant={selected && selected.runId === graphRun?.id ? selected.participantId : null} onSelect={(id) => { if (graphRun) select(graphRun.id, id); }} />
              : <div className="m-work"><aside className="m-work-rail" aria-label="Agent-Workspaces"><h2>Agents</h2>{host.catalog?.agents.map((agent) => <button key={agent.id} onClick={(event) => { event.currentTarget.focus(); openAgent(agent.id); }}><MobileAvatar host={host} agent={agent} size={26} /><span>{agent.name}</span></button>)}</aside>
                <div className="m-work-content"><div className="m-work-filters"><label>Runs durchsuchen<input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name, Projekt oder Agent" /></label>
                  <label>Status<select aria-label="Status" value={filter} onChange={(event) => setFilter(event.target.value as typeof filter)}><option value="all">Alle Runs</option><option value="open">Offene Runs</option><option value="finished">Beendete Runs</option></select></label></div>
                  {!host.catalog ? <p className="m-loading" role="status">Runs werden geladen…</p> : !filtered.length ? <Empty title={runs.length ? 'Keine passenden Runs' : 'Noch keine Runs'}><p>{runs.length ? 'Suche oder Statusfilter ändern.' : 'Starte eine Aufgabe oder bereite einen Managed Run vor.'}</p></Empty>
                    : <ul className="m-work-list">{filtered.map((run) => <li key={run.id}><RunRow run={run} selected={selected?.runId === run.id} onSelect={() => select(run.id)} /></li>)}</ul>}
                </div></div>}
        </main>
        {inspector && !compact && <aside className="m-inspector" aria-label="Run-Details"><div className="m-inspector-bar"><span>Inspector</span><button className="m-icon-button" aria-label="Inspector schliessen" onClick={clearSelection}><Icon name="close" /></button></div>{inspector}</aside>}
      </div>
      <footer className="m-statusbar"><span className="m-slot-status"><span className="m-live-dot" />Task-Slots {host.health ? `${host.health.queue.active}/${host.health.queue.maxActive}` : '—'}</span>
        <span className="m-last-seen">{host.lastSeen ? `Bestätigt ${new Date(host.lastSeen).toLocaleTimeString()}` : 'Warte auf den PC'}</span><button onClick={host.reconnect}><Icon name="refresh" /><span>Erneut verbinden</span></button></footer>
    </>}
    {inspector && compact && !composer && !settings && !management && <Dialog title="Run-Details" onClose={clearSelection} fallbackId={`view-tab-${view}`} restoreFocusTo={inspectorOpener.current} className="m-inspector-dialog">{inspector}</Dialog>}
    {composer && host.paired && <WorkComposer draft={draft} setDraft={setDraft} catalog={host.catalog} host={host} onSend={(command) => void send(command)} onClose={() => setComposer(false)} />}
    {management && host.paired && <RemoteManager host={host} admin={admin} onClose={() => setManagement(false)} />}
    {projectWorkspace && host.paired && host.catalog && <ProjectWorkspace key={`${host.identityVersion}:${projectWorkspace}`} host={host} repositoryId={projectWorkspace}
      fileDrafts={fileDrafts} profileDrafts={profileDrafts} onClose={() => setProjectWorkspace(null)}
      onTask={(agentId) => { newWork('task', agentId, projectWorkspace); setProjectWorkspace(null); }}
      onManage={() => { setProjectWorkspace(null); setManagement(true); }} />}
    {host.paired && <ProjectStart key={host.deviceId} host={host} open={projectStart} onClose={() => setProjectStart(false)} onOpen={() => setProjectStart(true)}
      onStarted={(session) => { setProjectStart(false); setView('projects'); setProjectIntent({ key: crypto.randomUUID(), workspaceId: session.projectWorkspaceId }); }} />}
    {!draftsDurable && <p role="status">Auftragsentwürfe bleiben nur in dieser geöffneten Seite; der Browser-Speicher ist nicht verfügbar.</p>}
    {workspace && host.paired && host.catalog && <AgentWorkspace key={`${host.identityVersion}:${workspace.agentId}`} host={host} agentId={workspace.agentId} fileDrafts={fileDrafts} profileDrafts={profileDrafts}
      initialRepositoryId={workspace.repositoryId ?? ''} initialTab={workspace.tab} initialTerminalId={workspace.terminalId}
      profileIntent={profileIntent?.agentId === workspace.agentId ? profileIntent.key : undefined} onProfileIntentConsumed={() => setProfileIntent(null)}
      onNavigate={(repositoryId, tab) => setWorkspace((current) => current ? { agentId: current.agentId, repositoryId: repositoryId || null, tab } : null)}
      onClose={() => setWorkspace(null)} onTask={(repositoryId) => { newWork('task', workspace.agentId, repositoryId); setWorkspace(null); }}
      onManage={() => { setWorkspace(null); setManagement(true); }} />}
    {settings && <Dialog title="Settings" onClose={() => setSettings(false)} fallbackId="mobile-title">
      {host.paired && <HostRestartSection host={host} onNavigate={(target) => { setSettings(false); navigate(target);
        requestAnimationFrame(() => document.getElementById(`view-tab-${target}`)?.focus()); }} />}
      <section className="m-settings-section"><h3>Darstellung</h3><p>Theme auf diesem Gerät. Deine PC-Einstellung bleibt unabhängig.</p>
      <div className="m-mode-choice"><label><input type="radio" name="theme" checked={theme === 'dark'} onChange={() => setTheme('dark')} />Dark</label><label><input type="radio" name="theme" checked={theme === 'light'} onChange={() => setTheme('light')} />Light</label></div></section>
      <section className="m-settings-section"><h3>Verbindung</h3><p>Privat über Tailscale. PC eingeschaltet und ADE geöffnet lassen.</p><p>Als App nutzen: Im Browser „Zum Home-Bildschirm“ oder „App installieren“ wählen.</p>
        {host.paired && <><button disabled={host.busy} className="m-danger" onClick={() => { void host.disconnect(); setSettings(false); }}>Dieses Gerät lokal trennen</button><p className="m-field-note">Zum vollständigen Widerruf: Gerät in ADE am PC entfernen.</p></>}</section>
    </Dialog>}
  </div></TabletKeyboardContext.Provider>;
}

createRoot(document.getElementById('root')!).render(<MobileApp />);
