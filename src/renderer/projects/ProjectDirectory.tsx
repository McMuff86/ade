import { useRef, useState, type JSX } from 'react';
import type { ProjectDirectoryEntry, ProjectDirectoryView, ProjectWorkspaceView } from '../../shared/remote';
import './projects.css';

/** Shared presentation; filesystem access and mutations stay in the platform adapters. */
export function ProjectDirectory({ directory, busy, error, online = true, onRefresh, onOpen, onMembership, canManage = true }: {
  directory?: ProjectDirectoryView; busy: boolean; error: string; online?: boolean;
  onRefresh: () => void; onOpen: (entry: ProjectDirectoryEntry, opener: HTMLButtonElement) => void;
  onMembership?: (entry: ProjectDirectoryEntry, included: boolean) => Promise<void>; canManage?: boolean;
}): JSX.Element {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'mine'>(() => {
    try { return localStorage.getItem('ade:project-directory-filter') === 'all' ? 'all' : 'mine'; }
    catch { return 'mine'; }
  });
  const chooseFilter = (value: 'all' | 'mine') => {
    setFilter(value);
    try { localStorage.setItem('ade:project-directory-filter', value); } catch { /* Filtering remains usable without storage. */ }
  };
  const filterButton = useRef<HTMLButtonElement>(null);
  const mine = (entry: ProjectDirectoryEntry) => entry.inMyProjects ?? !!entry.repositoryId;
  const entries = directory?.entries.filter((entry) => (filter === 'all' || mine(entry)) && entry.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  return <section className="project-directory" aria-label="Projektordner">
    <div className="project-directory-tools"><label>Projekte durchsuchen<input type="search" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
      <button disabled={busy || !online} onClick={onRefresh}>Projektordner aktualisieren</button></div>
    <div className="project-workspace-actions" aria-label="Projektfilter"><button aria-pressed={filter === 'all'} onClick={() => chooseFilter('all')}>Alle</button>
      <button ref={filterButton} aria-pressed={filter === 'mine'} onClick={() => chooseFilter('mine')}>Meine ADE Projekte</button></div>
    <p>Füge Projekte zu „Meine ADE Projekte“ hinzu, um sie in der Übersicht zu sehen. Entfernen aus der Auswahl erhält Dateien, Terminals und Verlauf.</p>
    {!online && <p role="status">PC nicht verbunden. Angezeigte Projektordner können veraltet sein.</p>}
    {error && <p role="alert">{error}</p>}
    {busy && <p role="status">Projektordner werden geladen…</p>}
    {directory?.notice && <p role="status">{directory.notice}</p>}
    {directory?.limited && <p role="status">Die Liste ist begrenzt. Einen kleineren Projekt-Stamm am PC wählen oder weitere Repositories am PC registrieren.</p>}
    {entries && !entries.length && <p>{search ? 'Keine passenden Projektordner. Suche ändern.' : filter === 'mine' ? 'Noch keine eigenen Projekte. Unter Alle ein Projekt hinzufügen.' : 'Noch keine Projektordner. Unter Settings den Projekt-Stamm speichern oder ein neues Projekt anlegen.'}</p>}
    <ul className="project-directory-grid">{entries?.map((entry) => <li key={entry.id}>
      <button aria-label={`Workspace öffnen: ${entry.name}`} disabled={!online || busy || entry.kind !== 'repository'} onClick={(event) => {
        event.currentTarget.focus(); onOpen(entry, event.currentTarget);
      }}><strong>{entry.name}</strong><span>{entry.kind === 'repository' ? 'Git-Repository' : entry.kind === 'folder' ? 'Ordner ohne Git' : 'Nicht verfügbar'}</span>
        <span>{mine(entry) ? 'Mein ADE Projekt' : 'Nicht in meiner ADE-Auswahl'} · {entry.backend}</span></button>
      {onMembership && (entry.repositoryId || entry.kind === 'repository') && <button disabled={!online || busy || !canManage}
        aria-label={`${mine(entry) ? 'Aus meinen ADE Projekten entfernen' : 'Zu meinen ADE Projekten hinzufügen'}: ${entry.name}`}
        onClick={() => { void onMembership(entry, !mine(entry)).then(() => {
          if (filter === 'mine' && mine(entry)) filterButton.current?.focus();
        }).catch(() => undefined); }}>
        {mine(entry) ? 'Aus meinen ADE Projekten entfernen' : 'Zu meinen ADE Projekten hinzufügen'}</button>}
      {entry.notice && <p>{entry.notice}</p>}{entry.kind === 'folder' && <p>Git zuerst am PC initialisieren.</p>}
    </li>)}</ul>
  </section>;
}

export function ProjectWorkspaceSummary({ workspace, workspacePath }: { workspace: ProjectWorkspaceView; workspacePath?: string }): JSX.Element {
  return <section className="project-workspace-summary" aria-label="Geöffneter Projekt-Workspace">
    <dl><div><dt>Projekt</dt><dd>{workspace.name}</dd></div><div><dt>Branch</dt><dd>{workspace.branch}</dd></div>
      <div><dt>Workspace</dt><dd>{workspace.kind === 'worktree' ? 'Vorhandene Git-Arbeitskopie' : 'Vorhandener Projektordner'}</dd></div>
      <div><dt>Agent-Profil</dt><dd>Ohne Agent-Profil</dd></div></dl>
    <p>Dieser Workspace ist unabhängig von deinen Agent-Arbeitskopien.</p>
    {workspacePath && <details className="project-workspace-path"><summary>Vollständigen Workspace-Pfad anzeigen</summary>
      <p>Stammordner dieses Workspace. Das aktuelle Shell-Verzeichnis kann davon abweichen.</p>
      <code>{workspacePath}</code></details>}
  </section>;
}
