import { localizeAppMessage } from '../../shared/i18n/appMessages';
import { t as translate } from "../../shared/i18n";
import { useLocale } from "../i18n/language";
import { useRef, useState, type JSX } from 'react';
import type { ProjectDirectoryEntry, ProjectDirectoryView, ProjectWorkspaceView } from '../../shared/remote';
import './projects.css';

/** Shared presentation; filesystem access and mutations stay in the platform adapters. */
export function ProjectDirectory({ directory, busy, error, online = true, onRefresh, onOpen, onMembership, canManage = true }: {
  directory?: ProjectDirectoryView; busy: boolean; error: string; online?: boolean;
  onRefresh: () => void; onOpen: (entry: ProjectDirectoryEntry, opener: HTMLButtonElement) => void;
  onMembership?: (entry: ProjectDirectoryEntry, included: boolean) => Promise<void>; canManage?: boolean;
}): JSX.Element {
  useLocale();
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
  return <section className="project-directory" aria-label={translate("Project folder")}>
    <div className="project-directory-tools"><label>{translate("Search for projects")}<input type="search" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
      <button disabled={busy || !online} onClick={onRefresh}>{translate("Update project folders")}</button></div>
    <div className="project-workspace-actions" aria-label={translate("Project filters")}><button aria-pressed={filter === 'all'} onClick={() => chooseFilter('all')}>{translate("All")}</button>
      <button ref={filterButton} aria-pressed={filter === 'mine'} onClick={() => chooseFilter('mine')}>{translate("My ADE Projects")}</button></div>
    <p>{translate("Add projects to “My ADE Projects” to see them in the overview. Removing a project from the selection preserves its files, terminals and history.")}</p>
    {!online && <p role="status">{translate("PC not connected. Displayed project folders may be obsolete.")}</p>}
    {error && <p role="alert">{localizeAppMessage(error)}</p>}
    {busy && <p role="status">{translate("Loading project folders…")}</p>}
    {directory?.notice && <p role="status">{localizeAppMessage(directory.notice)}</p>}
    {directory?.limited && <p role="status">{translate("The list is limited. Select a smaller project root on the PC or register further repositories on the PC.")}</p>}
    {entries && !entries.length && <p>{search ? translate("No matching project folders. Change search.") : filter === 'mine' ? translate("No personal projects yet. Add a project under All.") : translate("No project folders yet. Under Settings, save the project root or create a new project.")}</p>}
    <ul className="project-directory-grid">{entries?.map((entry) => <li key={entry.id}>
      <button aria-label={translate("Open Workspace: {{value1}}", { value1: entry.name })} disabled={!online || busy || entry.kind !== 'repository'} onClick={(event) => {
        event.currentTarget.focus(); onOpen(entry, event.currentTarget);
      }}><strong>{entry.name}</strong><span>{entry.kind === 'repository' ? translate("Git repository") : entry.kind === 'folder' ? translate("Folders without Git") : translate("Not available")}</span>
        <span>{mine(entry) ? translate("My ADE project") : translate("Not in my ADE selection")} · {entry.backend}</span></button>
      {onMembership && (entry.repositoryId || entry.kind === 'repository') && <button disabled={!online || busy || !canManage}
        aria-label={`${mine(entry) ? translate("Remove from my ADE projects") : translate("Add to my ADE projects")}: ${entry.name}`}
        onClick={() => { void onMembership(entry, !mine(entry)).then(() => {
          if (filter === 'mine' && mine(entry)) filterButton.current?.focus();
        }).catch(() => undefined); }}>
        {mine(entry) ? translate("Remove from my ADE projects") : translate("Add to my ADE projects")}</button>}
      {entry.notice && <p>{localizeAppMessage(entry.notice)}</p>}{entry.kind === 'folder' && <p>{translate("Initialize Git on PC first.")}</p>}
    </li>)}</ul>
  </section>;
}

export function ProjectWorkspaceSummary({ workspace, workspacePath }: { workspace: ProjectWorkspaceView; workspacePath?: string }): JSX.Element {
  useLocale();
  return <section className="project-workspace-summary" aria-label={translate("Open project workspace")}>
    <dl><div><dt>{translate("Project")}</dt><dd>{workspace.name}</dd></div><div><dt>{translate("Branch")}</dt><dd>{workspace.branch}</dd></div>
      <div><dt>{translate("Workspace")}</dt><dd>{workspace.kind === 'worktree' ? translate("Existing Git working copy") : translate("Existing project folder")}</dd></div>
      <div><dt>{translate("Agent Profile")}</dt><dd>{translate("Without an agent profile")}</dd></div></dl>
    <p>{translate("This workspace is independent of your agent working copies.")}</p>
    {workspacePath && <details className="project-workspace-path"><summary>{translate("View the full workspace path")}</summary>
      <p>{translate("The root folder of this workspace. The current shell directory may differ from this.")}</p>
      <code>{workspacePath}</code></details>}
  </section>;
}
