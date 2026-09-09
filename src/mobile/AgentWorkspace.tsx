import { useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type JSX } from 'react';
import type { MobileWorkspaceOperation, MobileWorkspaceResult } from '../shared/remote';
import type { MobileHost } from './useMobileHost';
import { MobileClientError } from './client';
import { Dialog } from './ui';
import { RemoteTerminalPane } from './RemoteTerminalPane';
import { FileEditor, type FileDrafts } from './FileEditor';
import { AgentProfile, type ProfileDrafts } from './AgentProfile';
import { DashboardLink } from './DashboardLink';
import { TabletKeyboardContext } from './useTabletViewport';

export function workspaceError(error: unknown): string {
  if (error instanceof MobileClientError) {
    if (error.code === 'scope_not_granted') return 'Für dieses Gerät am PC unter Settings → Verbundene Geräte den Zugriff auf Workspace-Dateien freigeben.';
    if (error.status === 404) return 'Diese Funktion benötigt die neue ADE-Version auf dem PC.';
    if (error.message !== error.code) return error.message;
  }
  return 'Workspace konnte nicht geladen werden. Verbindung prüfen und erneut versuchen.';
}

export function AgentWorkspace({ host, agentId, initialRepositoryId, initialTab, initialTerminalId, projectEntry, profileIntent, onProfileIntentConsumed, onNavigate, onClose, onTask, onManage, fileDrafts, profileDrafts }: {
  host: MobileHost; agentId: string; initialRepositoryId: string;
  initialTab?: 'files' | 'terminal'; initialTerminalId?: string;
  projectEntry?: boolean;
  profileIntent?: string; onProfileIntentConsumed?: () => void;
  onNavigate?: (repositoryId: string, tab: 'files' | 'terminal') => void;
  onClose: () => void; onTask: (repositoryId: string) => void; onManage: () => void;
  fileDrafts: FileDrafts;
  profileDrafts: ProfileDrafts;
}): JSX.Element {
  const [repositoryId, selectRepository] = useState(() => host.catalog?.repositories.some((repo) => repo.id === initialRepositoryId)
    ? initialRepositoryId : '');
  const [tab, selectTab] = useState<'files' | 'git' | 'terminal' | 'profile'>(initialTab ?? 'files');
  const keyboardOpen = useContext(TabletKeyboardContext);
  const [keyboardControls, setKeyboardControls] = useState(false);
  const keyboardToggle = useRef<HTMLButtonElement>(null);
  const wasKeyboardOpen = useRef(false);
  useLayoutEffect(() => {
    if (!keyboardOpen) {
      setKeyboardControls(false);
      // Chromium can move focus to body as soon as the focused toggle is hidden.
      if (wasKeyboardOpen.current && (document.activeElement === keyboardToggle.current || document.activeElement === document.body)) {
        keyboardToggle.current?.closest('dialog')?.querySelector<HTMLElement>('[data-dialog-heading]')?.focus();
      }
    }
    wasKeyboardOpen.current = keyboardOpen;
  }, [keyboardOpen]);
  const setTab = (value: typeof tab) => { selectTab(value); onNavigate?.(repositoryId, value === 'terminal' ? 'terminal' : 'files'); };
  const setRepositoryId = (value: string) => { selectRepository(value); onNavigate?.(value, tab === 'terminal' ? 'terminal' : 'files'); };
  const [overview, setOverview] = useState<MobileWorkspaceResult['overview']>();
  const [listing, setListing] = useState<MobileWorkspaceResult | null>(null);
  const [detail, setDetail] = useState<MobileWorkspaceResult | null>(null);
  const [title, setTitle] = useState(''); const [directory, setDirectory] = useState('');
  const [search, setSearch] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const version = useRef(0); const heading = useRef<HTMLHeadingElement>(null); const detailOpener = useRef<HTMLElement | null>(null);
  const agent = host.catalog?.agents.find((item) => item.id === agentId);
  const query = useCallback((input: MobileWorkspaceOperation) =>
    host.request<MobileWorkspaceResult>('/api/v1/workspace/query', 'POST', { ...input, agentId, repositoryId: repositoryId || null }), [host.request, agentId, repositoryId]);
  const refresh = useCallback(async () => {
    const own = ++version.current; setBusy(true); setError(''); setDetail(null); setListing(null); setOverview(undefined); setDirectory(''); setSearch('');
    try {
      const state = await query({ operation: 'overview' });
      const tree = state.overview?.ready ? await query({ operation: 'tree', path: '' }) : null;
      if (own !== version.current) return;
      setOverview(state.overview); setListing(tree);
    } catch (reason) { if (own === version.current) setError(workspaceError(reason)); }
    finally { if (own === version.current) setBusy(false); }
  }, [query, repositoryId]);
  useEffect(() => { void refresh(); return () => { version.current++; }; }, [refresh, host.identityVersion]);
  useEffect(() => { if (!repositoryId) selectTab((current) => current === 'git' ? 'files' : current); }, [repositoryId]);
  useLayoutEffect(() => { if (detail) heading.current?.focus(); }, [detail]);
  const load = async (input: MobileWorkspaceOperation, detailTitle?: string) => {
    const own = ++version.current; setBusy(true); setError('');
    if (detailTitle) { detailOpener.current = document.activeElement as HTMLElement; setDetail(null); }
    try {
      const result = await query(input); if (own !== version.current) return;
      if (detailTitle) { setTitle(detailTitle); setDetail(result); } else { setListing(result); setDetail(null); }
    } catch (reason) { if (own === version.current) setError(workspaceError(reason)); }
    finally { if (own === version.current) setBusy(false); }
  };
  const closeDetail = () => { setDetail(null); requestAnimationFrame(() => {
    const opener = detailOpener.current; (opener?.isConnected ? opener : document.getElementById('workspace-refresh'))?.focus();
  }); };
  const folder = (path: string) => { setDirectory(path); setSearch(''); void load({ operation: 'tree', path }); };
  const disabled = busy || host.status !== 'online';
  return <Dialog title={projectEntry ? `Projekt · ${host.catalog?.repositories.find((repo) => repo.id === repositoryId)?.name ?? 'Workspace'}` : `Workspace · ${agent?.name ?? 'Agent'}`} onClose={onClose} fallbackId="mobile-title" className={`m-agent-workspace ${tab === 'terminal' ? 'm-terminal-workspace' : ''}`}
    headerActions={tab === 'terminal' && <button ref={keyboardToggle} hidden={!keyboardOpen} className="m-keyboard-controls-toggle"
      aria-label="Terminal-Bedienung" aria-expanded={keyboardControls} aria-controls="workspace-terminal-controls"
      onPointerDown={(event) => event.preventDefault()} onClick={() => setKeyboardControls((value) => !value)}>{keyboardControls ? 'Bedienung einklappen' : 'Bedienung'}</button>}>
    <div className="m-tablet-workbench">{!projectEntry && <aside className="m-project-rail" aria-label="Workspace-Projekte"><h3>Projekte</h3>
      <button aria-pressed={!repositoryId} onClick={() => setRepositoryId('')}>Eigener Workspace</button>
      {host.catalog?.repositories.map((repo) => <button key={repo.id} aria-pressed={repositoryId === repo.id} onClick={() => setRepositoryId(repo.id)}>{repo.name}</button>)}
    </aside>}<div className="m-tablet-workbench-main">
    <div className="m-workspace-controls">{!projectEntry && <label>Projekt<select aria-label="Workspace-Projekt" value={repositoryId} onChange={(event) => setRepositoryId(event.target.value)}>
      <option value="">Ohne Projekt · Eigener Workspace</option>{host.catalog?.repositories.map((repo) => <option key={repo.id} value={repo.id}>{repo.name}</option>)}</select></label>}
      <button id="workspace-refresh" disabled={disabled} onClick={() => void refresh()}>Workspace aktualisieren</button>
      <button disabled={!repositoryId || host.status !== 'online'} onClick={() => onTask(repositoryId)}>Aufgabe vergeben</button>{agent && <DashboardLink agent={agent} />}</div>
    {overview?.ready && <p className="m-field-note">{projectEntry ? 'ADE-Arbeitskopie · ' : ''}{repositoryId ? `Branch ${overview.branch} · ` : ''}{overview.busy ? 'Workspace wird verwendet' : 'Keine laufende Sitzung'}</p>}
    <nav className="m-management-tabs" aria-label="Workspace-Bereich"><button aria-pressed={tab === 'files'} onClick={() => { setTab('files'); setDetail(null); }}>Dateien</button>
      <button disabled={!repositoryId} title={!repositoryId ? 'Für Git ein Projekt auswählen' : undefined} aria-pressed={tab === 'git'} onClick={() => { setTab('git'); setDetail(null); }}>Git-Änderungen</button>
      <button aria-pressed={tab === 'terminal'} onClick={() => { setTab('terminal'); setDetail(null); }}>Terminal</button>
      <button aria-pressed={tab === 'profile'} onClick={() => { setTab('profile'); setDetail(null); }}>Agent-Profil</button></nav>
    {host.status !== 'online' && <p role="status">Verbindung unterbrochen. Angezeigte Daten können veraltet sein.</p>}
    {busy && tab !== 'terminal' && <p role="status">Workspace wird geladen…</p>}{error && tab !== 'terminal' && <p role="alert" className="m-alert">{error}</p>}
    {!repositoryId && <p>Dateien und Terminal verwenden den eigenen Agent-Ordner. Für verwaltete Aufgaben und Git ein Projekt auswählen.</p>}
    {tab !== 'terminal' && overview?.notice && <p>{overview.notice}</p>}
    {tab !== 'terminal' && overview && !overview.ready && (repositoryId ? <button onClick={onManage}>Workspaces verwalten</button> : <button onClick={() => setTab('terminal')}>Terminal öffnen</button>)}
    <div className="m-terminal-slot" hidden={tab !== 'terminal'}><RemoteTerminalPane key={`${agentId}:${repositoryId}:${host.identityVersion}`} host={host} agentId={agentId} repositoryId={repositoryId || null} active={tab === 'terminal'}
      projectEntry={projectEntry}
      compactControls={keyboardOpen && !keyboardControls}
      initialTerminalId={repositoryId === initialRepositoryId ? initialTerminalId : undefined}
      profileIntent={!repositoryId ? profileIntent : undefined} onProfileIntentConsumed={onProfileIntentConsumed} /></div>
    {tab === 'profile' && <AgentProfile host={host} agentId={agentId} drafts={profileDrafts} />}
    {overview?.ready && (tab === 'files' || tab === 'git') && <div className={`m-workbench-split ${detail ? 'has-detail' : ''}`}>
      <section className="m-workbench-list" aria-label={tab === 'files' ? 'Workspace-Dateien' : 'Geänderte Dateien'}>
        {tab === 'files' ? <><form onSubmit={(event) => { event.preventDefault(); void load({ operation: 'search', search: search.trim() }); }}>
          <label>Dateinamen suchen<input type="search" value={search} maxLength={80} onChange={(event) => setSearch(event.target.value)} /></label>
          <button disabled={disabled || !search.trim()}>Dateien suchen</button></form>
          <p className="m-workspace-location">{directory || 'Workspace'}</p>
          <button disabled={disabled || !directory && !search} onClick={() => folder(directory.split('/').slice(0, -1).join('/'))}>Übergeordneter Ordner</button>
          {!listing?.entries?.length && !busy && <p>Keine sichtbaren Dateien in dieser Auswahl.</p>}
          <ul>{listing?.entries?.map((entry) => <li key={entry.path}><button disabled={disabled} title={entry.path}
            onClick={() => entry.kind === 'directory' ? folder(entry.path) : void load({ operation: 'file', path: entry.path }, entry.path)}>
            <span aria-hidden="true">{entry.kind === 'directory' ? '▸ ' : '· '}</span>{search ? entry.path : entry.name}</button></li>)}</ul>
          {listing?.limited && <p>Auswahl begrenzt. Einen Unterordner öffnen oder gezielter suchen.</p>}</>
          : <>{!overview.changes.length && <p>Keine sichtbaren uncommitteten Änderungen.</p>}<ul>{overview.changes.map((change) => <li key={change.path}>
            <strong>{change.path}</strong><span className="m-field-note"> {change.state}</span><div className="m-management-actions">
              {change.unstaged && <button disabled={disabled} onClick={() => void load({ operation: 'diff', path: change.path, staged: false }, `${change.path} · Arbeitsdatei`)}>Arbeitsdatei vergleichen</button>}
              {change.staged && <button disabled={disabled} onClick={() => void load({ operation: 'diff', path: change.path, staged: true }, `${change.path} · Vorgemerkt`)}>Vorgemerkte Änderung</button>}</div></li>)}</ul>
            <h3>Letzte Commits</h3><ol>{overview.commits.map((commit) => <li key={commit.sha}><code>{commit.sha.slice(0, 8)}</code> {commit.subject}</li>)}</ol>
            <button onClick={onManage}>Git-Abgleich öffnen</button></>}
      </section>
      <section className="m-workbench-detail" aria-label="Dateiinhalt">{detail ? <><button onClick={closeDetail}>Zurück zur Liste</button>
        <h3 ref={heading} tabIndex={-1}>{title}</h3>{detail.file?.notice && <p>{detail.file.notice}</p>}
        {detail.limited && <p>Diff ist gekürzt.</p>}
        {detail.file ? <FileEditor key={`${agentId}:${repositoryId}:${detail.file.path}`} host={host} file={detail.file} workspaceVersion={detail.workspaceVersion}
          agentId={agentId} repositoryId={repositoryId || null} busyWorkspace={overview.busy} drafts={fileDrafts} onSaved={() => { void refresh(); document.getElementById('workspace-refresh')?.focus(); }} />
          : <pre tabIndex={0} aria-label="Git-Diff">{detail.diff?.split('\n').map((line, index) =>
          <span key={index} className={line.startsWith('+') ? 'm-diff-add' : line.startsWith('-') ? 'm-diff-delete' : undefined}>{line}{'\n'}</span>)}</pre>}</>
        : <p>Eine Datei oder Änderung auswählen.</p>}</section>
    </div>}
    </div></div>
  </Dialog>;
}
