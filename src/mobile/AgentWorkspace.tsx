import { useCallback, useEffect, useLayoutEffect, useRef, useState, type JSX } from 'react';
import type { MobileWorkspaceOperation, MobileWorkspaceResult } from '../shared/remote';
import type { MobileHost } from './useMobileHost';
import { MobileClientError } from './client';
import { Dialog } from './ui';
import { RemoteTerminalPane } from './RemoteTerminalPane';
import { FileEditor, type FileDrafts } from './FileEditor';
import { AgentProfile, type ProfileDrafts } from './AgentProfile';

export function workspaceError(error: unknown): string {
  if (error instanceof MobileClientError) {
    if (error.code === 'scope_not_granted') return 'Für dieses Gerät am PC unter Settings → Verbundene Geräte den Zugriff auf Workspace-Dateien freigeben.';
    if (error.status === 404) return 'Diese Funktion benötigt die neue ADE-Version auf dem PC.';
    if (error.message !== error.code) return error.message;
  }
  return 'Workspace konnte nicht geladen werden. Verbindung prüfen und erneut versuchen.';
}

export function AgentWorkspace({ host, agentId, initialRepositoryId, onClose, onTask, onManage, fileDrafts, profileDrafts }: {
  host: MobileHost; agentId: string; initialRepositoryId: string;
  onClose: () => void; onTask: (repositoryId: string) => void; onManage: () => void;
  fileDrafts: FileDrafts;
  profileDrafts: ProfileDrafts;
}): JSX.Element {
  const [repositoryId, setRepositoryId] = useState(() => host.catalog?.repositories.some((repo) => repo.id === initialRepositoryId)
    ? initialRepositoryId : host.catalog?.repositories[0]?.id ?? '');
  const [tab, setTab] = useState<'files' | 'git' | 'terminal' | 'profile'>('files');
  const [overview, setOverview] = useState<MobileWorkspaceResult['overview']>();
  const [listing, setListing] = useState<MobileWorkspaceResult | null>(null);
  const [detail, setDetail] = useState<MobileWorkspaceResult | null>(null);
  const [title, setTitle] = useState(''); const [directory, setDirectory] = useState('');
  const [search, setSearch] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const version = useRef(0); const heading = useRef<HTMLHeadingElement>(null); const detailOpener = useRef<HTMLElement | null>(null);
  const agent = host.catalog?.agents.find((item) => item.id === agentId);
  const query = useCallback((input: MobileWorkspaceOperation) =>
    host.request<MobileWorkspaceResult>('/api/v1/workspace/query', 'POST', { ...input, agentId, repositoryId }), [host.request, agentId, repositoryId]);
  const refresh = useCallback(async () => {
    const own = ++version.current; setBusy(true); setError(''); setDetail(null); setListing(null); setOverview(undefined); setDirectory(''); setSearch('');
    if (!repositoryId) { setBusy(false); return; }
    try {
      const state = await query({ operation: 'overview' });
      const tree = state.overview?.ready ? await query({ operation: 'tree', path: '' }) : null;
      if (own !== version.current) return;
      setOverview(state.overview); setListing(tree);
    } catch (reason) { if (own === version.current) setError(workspaceError(reason)); }
    finally { if (own === version.current) setBusy(false); }
  }, [query, repositoryId]);
  useEffect(() => { void refresh(); return () => { version.current++; }; }, [refresh, host.identityVersion]);
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
  return <Dialog title={`Workspace · ${agent?.name ?? 'Agent'}`} onClose={onClose} fallbackId="mobile-title" className="m-agent-workspace">
    <div className="m-workspace-controls"><label>Projekt<select aria-label="Workspace-Projekt" value={repositoryId} onChange={(event) => setRepositoryId(event.target.value)}>
      <option value="">Projekt wählen</option>{host.catalog?.repositories.map((repo) => <option key={repo.id} value={repo.id}>{repo.name}</option>)}</select></label>
      <button id="workspace-refresh" disabled={disabled} onClick={() => void refresh()}>Workspace aktualisieren</button>
      <button disabled={!repositoryId || host.status !== 'online'} onClick={() => onTask(repositoryId)}>Aufgabe vergeben</button></div>
    {overview?.ready && <p className="m-field-note">Branch {overview.branch} · {overview.busy ? 'Workspace wird verwendet' : 'Keine laufende Sitzung'}</p>}
    <nav className="m-management-tabs" aria-label="Workspace-Bereich"><button aria-pressed={tab === 'files'} onClick={() => { setTab('files'); setDetail(null); }}>Dateien</button>
      <button aria-pressed={tab === 'git'} onClick={() => { setTab('git'); setDetail(null); }}>Git-Änderungen</button>
      <button aria-pressed={tab === 'terminal'} onClick={() => { setTab('terminal'); setDetail(null); }}>Terminal</button>
      <button aria-pressed={tab === 'profile'} onClick={() => { setTab('profile'); setDetail(null); }}>Agent-Profil</button></nav>
    {host.status !== 'online' && <p role="status">Verbindung unterbrochen. Angezeigte Daten können veraltet sein.</p>}
    {busy && <p role="status">Workspace wird geladen…</p>}{error && <p role="alert" className="m-alert">{error}</p>}
    {!repositoryId && <p>Wähle ein Projekt für diesen Agent.</p>}
    {overview?.notice && <p>{overview.notice}</p>}
    {overview && !overview.ready && <button onClick={onManage}>Workspaces verwalten</button>}
    <div hidden={tab !== 'terminal'}><RemoteTerminalPane key={`${agentId}:${repositoryId}:${host.identityVersion}`} host={host} agentId={agentId} repositoryId={repositoryId} active={tab === 'terminal'} /></div>
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
          agentId={agentId} repositoryId={repositoryId} busyWorkspace={overview.busy} drafts={fileDrafts} onSaved={() => { void refresh(); document.getElementById('workspace-refresh')?.focus(); }} />
          : <pre tabIndex={0} aria-label="Git-Diff">{detail.diff?.split('\n').map((line, index) =>
          <span key={index} className={line.startsWith('+') ? 'm-diff-add' : line.startsWith('-') ? 'm-diff-delete' : undefined}>{line}{'\n'}</span>)}</pre>}</>
        : <p>Eine Datei oder Änderung auswählen.</p>}</section>
    </div>}
  </Dialog>;
}
