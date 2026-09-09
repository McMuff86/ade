import { useState, type JSX } from 'react';
import type { ProjectDirectoryEntry, ProjectDirectoryView, ProjectWorkspaceView } from '../../shared/remote';
import './projects.css';

/** Shared presentation; filesystem access and mutations stay in the platform adapters. */
export function ProjectDirectory({ directory, busy, error, online = true, onRefresh, onOpen }: {
  directory?: ProjectDirectoryView; busy: boolean; error: string; online?: boolean;
  onRefresh: () => void; onOpen: (entry: ProjectDirectoryEntry, opener: HTMLButtonElement) => void;
}): JSX.Element {
  const [search, setSearch] = useState('');
  const entries = directory?.entries.filter((entry) => entry.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  return <section className="project-directory" aria-label="Projektordner">
    <div className="project-directory-tools"><label>Projekte durchsuchen<input type="search" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
      <button disabled={busy || !online} onClick={onRefresh}>Projektordner aktualisieren</button></div>
    <p>Ordner im Projekt-Stamm und registrierte Repositories. Öffne den vorhandenen Workspace; ein Agent-Profil ist optional.</p>
    {!online && <p role="status">PC nicht verbunden. Angezeigte Projektordner können veraltet sein.</p>}
    {error && <p role="alert">{error}</p>}
    {busy && <p role="status">Projektordner werden geladen…</p>}
    {directory?.notice && <p role="status">{directory.notice}</p>}
    {directory?.limited && <p role="status">Die Liste ist begrenzt. Einen kleineren Projekt-Stamm am PC wählen oder weitere Repositories am PC registrieren.</p>}
    {entries && !entries.length && <p>{search ? 'Keine passenden Projektordner. Suche ändern.' : 'Noch keine Projektordner. Unter Settings den Projekt-Stamm speichern oder ein neues Projekt anlegen.'}</p>}
    <ul className="project-directory-grid">{entries?.map((entry) => <li key={entry.id}>
      <button aria-label={`Workspace öffnen: ${entry.name}`} disabled={!online || busy || entry.kind !== 'repository'} onClick={(event) => {
        event.currentTarget.focus(); onOpen(entry, event.currentTarget);
      }}><strong>{entry.name}</strong><span>{entry.kind === 'repository' ? 'Git-Repository' : entry.kind === 'folder' ? 'Ordner ohne Git' : 'Nicht verfügbar'}</span>
        <span>{entry.repositoryId ? 'In ADE erfasst' : 'Im Projekt-Stamm gefunden'} · {entry.backend}</span></button>
      {entry.notice && <p>{entry.notice}</p>}{entry.kind === 'folder' && <p>Git zuerst am PC initialisieren.</p>}
    </li>)}</ul>
  </section>;
}

export function ProjectWorkspaceSummary({ workspace }: { workspace: ProjectWorkspaceView }): JSX.Element {
  return <section className="project-workspace-summary" aria-label="Geöffneter Projekt-Workspace">
    <dl><div><dt>Projekt</dt><dd>{workspace.name}</dd></div><div><dt>Branch</dt><dd>{workspace.branch}</dd></div>
      <div><dt>Workspace</dt><dd>{workspace.kind === 'worktree' ? 'Vorhandene Git-Arbeitskopie' : 'Vorhandener Projektordner'}</dd></div>
      <div><dt>Agent-Profil</dt><dd>Ohne Agent-Profil</dd></div></dl>
    <p>Dieser Workspace ist unabhängig von deinen Agent-Arbeitskopien.</p>
  </section>;
}
