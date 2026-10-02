import { localizeAppMessage } from '../../shared/i18n/appMessages';
import { t as translate } from "../../shared/i18n";
import { useLocale } from "../i18n/language";
import { useLayoutEffect, useRef, useState, type JSX } from 'react';
import type { ProjectDirectoryEntry, ProjectDirectoryView, ProjectMissingEntry, ProjectWorkspaceView } from '../../shared/remote';
import { ProjectUsageLine, ProjectUsageRangeSwitch, type ProjectUsageState } from '../usage/ProjectUsage';
import './projects.css';

/** Shared presentation; filesystem access and mutations stay in the platform adapters. */
export function ProjectDirectory({ directory, busy, error, online = true, onRefresh, onOpen, onMembership, onRemoveMissing, canManage = true, usage }: {
  directory?: ProjectDirectoryView; busy: boolean; error: string; online?: boolean;
  /** Tokens per project from the shell's transport; absent shells (e.g. pickers) show no usage. */
  usage?: ProjectUsageState;
  onRefresh: () => void; onOpen: (entry: ProjectDirectoryEntry, opener: HTMLButtonElement) => void;
  onMembership?: (entry: ProjectDirectoryEntry, included: boolean) => Promise<void>; canManage?: boolean;
  /** Deregisters a project whose folder is gone; the adapter reports errors through `error`. */
  onRemoveMissing?: (entry: ProjectMissingEntry) => Promise<void>;
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
  // Removing the last missing project unmounts its section; focus then moves to
  // the stable refresh button once it is enabled again.
  const refreshButton = useRef<HTMLButtonElement>(null); const focusRefresh = useRef(false);
  useLayoutEffect(() => {
    if (focusRefresh.current && !busy && !directory?.missing?.length) { focusRefresh.current = false; refreshButton.current?.focus(); }
  });
  const mine = (entry: ProjectDirectoryEntry) => entry.inMyProjects ?? !!entry.repositoryId;
  const entries = directory?.entries.filter((entry) => (filter === 'all' || mine(entry)) && entry.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  return <section className="project-directory" aria-label={translate("Project folder")}>
    <div className="project-directory-tools"><label><span>{translate("Search for projects")}</span><input type="search" value={search} placeholder={translate("Search for projects")} onChange={(event) => setSearch(event.target.value)} /></label>
      <button ref={refreshButton} disabled={busy || !online} onClick={onRefresh}>{translate("Update project folders")}</button></div>
    <div className="project-workspace-actions project-filter-segment" role="group" aria-label={translate("Project filters")}><button aria-pressed={filter === 'all'} onClick={() => chooseFilter('all')}>{translate("All")}</button>
      <button ref={filterButton} aria-pressed={filter === 'mine'} onClick={() => chooseFilter('mine')}>{translate("My ADE Projects")}</button></div>
    {usage && <ProjectUsageRangeSwitch usage={usage} />}
    <p>{translate("Add projects to “My ADE Projects” to see them in the overview. Removing a project from the selection preserves its files, terminals and history.")}</p>
    {!online && <p role="status">{translate("PC not connected. Displayed project folders may be obsolete.")}</p>}
    {error && <p role="alert">{localizeAppMessage(error)}</p>}
    {busy && <p role="status">{translate("Loading project folders…")}</p>}
    {directory?.notice && <p role="status">{localizeAppMessage(directory.notice)}</p>}
    {directory?.limited && <p role="status">{translate("The list is limited. Select a smaller project root on the PC or register further repositories on the PC.")}</p>}
    {!!directory?.missing?.length && <MissingProjects missing={directory.missing} busy={busy} online={online} canManage={canManage} onRemove={onRemoveMissing}
      onEmptied={(pending) => { focusRefresh.current = pending; }} />}
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
      {usage && entry.repositoryId && <ProjectUsageLine usage={usage} repositoryId={entry.repositoryId} />}
      {entry.notice && <p>{localizeAppMessage(entry.notice)}</p>}{entry.kind === 'folder' && <p>{translate("Initialize Git on PC first.")}</p>}
    </li>)}</ul>
  </section>;
}

/**
 * Registered projects whose folder was deleted on the PC. They are hidden from
 * the list above; removing one only deregisters it after an explicit confirm.
 */
function MissingProjects({ missing, busy, online, canManage, onRemove, onEmptied }: {
  missing: ProjectMissingEntry[]; busy: boolean; online: boolean; canManage: boolean; onRemove?: (entry: ProjectMissingEntry) => Promise<void>; onEmptied: (pending: boolean) => void;
}): JSX.Element {
  const [confirming, setConfirming] = useState<string>();
  const confirmButton = useRef<HTMLButtonElement>(null); const heading = useRef<HTMLHeadingElement>(null);
  const openers = useRef(new Map<string, HTMLButtonElement>()); const restore = useRef<string | undefined>(undefined);
  useLayoutEffect(() => {
    if (confirming) { confirmButton.current?.focus(); return; }
    const target = restore.current; restore.current = undefined;
    if (target === 'heading') heading.current?.focus(); else if (target) openers.current.get(target)?.focus();
  });
  const cancel = (id: string) => { restore.current = id; setConfirming(undefined); };
  const confirm = (entry: ProjectMissingEntry) => {
    const last = missing.length === 1; if (last) onEmptied(true);
    void onRemove?.(entry).then(() => { if (!last) restore.current = 'heading'; setConfirming(undefined); })
      .catch(() => { if (last) onEmptied(false); cancel(entry.repositoryId); });
  };
  return <section className="project-missing" aria-labelledby="project-missing-heading">
    <h3 id="project-missing-heading" ref={heading} tabIndex={-1}>{missing.length === 1 ? translate("1 project no longer found") : translate("{{count}} projects no longer found", { count: missing.length })}</h3>
    <p>{translate("Their folders were deleted or moved on the PC, so they are hidden from the list. If a folder returns, the project appears again.")}</p>
    <ul>{missing.map((entry) => <li key={entry.repositoryId}>
      <strong>{entry.name}</strong>
      {entry.removal === 'history' && <p>{translate("Stays hidden: runs, agents or another workspace still refer to it. Its history remains.")}</p>}
      {entry.removal === 'active' && <p>{translate("A terminal is still open in this project. Close it first to remove the project.")}</p>}
      {entry.removal === 'allowed' && onRemove && (confirming === entry.repositoryId
        ? <div role="group" aria-label={translate("Confirm removal: {{value1}}", { value1: entry.name })}
          onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); cancel(entry.repositoryId); } }}>
          <p>{translate("Remove “{{value1}}” from ADE? Only the registration goes; there are no files left to delete. Run history remains.", { value1: entry.name })}</p>
          <button ref={confirmButton} disabled={busy || !online} onClick={() => confirm(entry)}>{translate("Remove registration")}</button>
          <button disabled={busy} onClick={() => cancel(entry.repositoryId)}>{translate("Cancel")}</button>
        </div>
        : <button ref={(node) => { if (node) openers.current.set(entry.repositoryId, node); else openers.current.delete(entry.repositoryId); }}
          disabled={busy || !online || !canManage} aria-label={translate("Remove from ADE: {{value1}}", { value1: entry.name })}
          onClick={() => setConfirming(entry.repositoryId)}>{translate("Remove from ADE")}</button>)}
      {entry.removal === 'allowed' && onRemove && !canManage && <p>{translate("Removing projects requires project management rights for this device.")}</p>}
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
