import { localizeAppMessage } from '../shared/i18n/appMessages';
import { t as translate } from "../shared/i18n";
import { useLocale } from "../renderer/i18n/language";
import { useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type JSX } from 'react';
import type { MobileWorkspaceOperation, MobileWorkspaceResult } from '../shared/remote';
import type { MobileHost } from './useMobileHost';
import { MobileClientError } from './client';
import { Dialog } from './ui';
import { RemoteTerminalPane } from './RemoteTerminalPane';
import { FileEditor, type FileDrafts } from './FileEditor';
import { AgentProfile, type ProfileDrafts } from './AgentProfile';
import { DashboardLink } from './DashboardLink';
import { CommitDetails } from './CommitDetails';
import { TabletKeyboardContext } from './useTabletViewport';
import { useWorkspaceSelection, WorkspaceAssignmentDialog } from './WorkspaceAssignment';

export function workspaceError(error: unknown): string {
  if (error instanceof MobileClientError) {
    if (error.code === 'scope_not_granted') return translate("On the PC, open Settings → Connected devices and enable workspace file access for this device.");
    if (error.status === 404) return translate("This function requires the new ADE version on the PC.");
    if (error.message !== error.code) return error.message;
  }
  return translate("Workspace couldn't load. Check connection and try again.");
}

/** Git has no stable start state, so a reopened dialog returns to the file list instead. */
const rememberedTab = (tab: 'files' | 'git' | 'terminal' | 'profile'): 'files' | 'terminal' | 'profile' => tab === 'git' ? 'files' : tab;

export function AgentWorkspace({ host, agentId, initialRepositoryId, initialTab, initialTerminalId, projectEntry, profileIntent, onProfileIntentConsumed, onNavigate, onClose, onTask, onManage, fileDrafts, profileDrafts }: {
  host: MobileHost; agentId: string; initialRepositoryId: string;
  initialTab?: 'files' | 'terminal' | 'profile'; initialTerminalId?: string;
  projectEntry?: boolean;
  profileIntent?: string; onProfileIntentConsumed?: () => void;
  onNavigate?: (repositoryId: string, tab: 'files' | 'terminal' | 'profile') => void;
  onClose: () => void; onTask: (repositoryId: string) => void; onManage: () => void;
  fileDrafts: FileDrafts;
  profileDrafts: ProfileDrafts;
}): JSX.Element {
  useLocale();
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
  const setTab = (value: typeof tab) => {
    if (value !== tab && pendingDetail.current) {
      version.current++; pendingDetail.current = false; setBusy(false); setError(''); setRetryDetail(null);
    }
    selectTab(value); onNavigate?.(repositoryId, rememberedTab(value));
  };
  const setRepositoryId = (value: string) => { selectRepository(value); onNavigate?.(value, rememberedTab(tab)); };
  const [overview, setOverview] = useState<MobileWorkspaceResult['overview']>();
  const [listing, setListing] = useState<MobileWorkspaceResult | null>(null);
  const [detail, setDetail] = useState<MobileWorkspaceResult | null>(null);
  const [title, setTitle] = useState(''); const [directory, setDirectory] = useState('');
  const [search, setSearch] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const [retryDetail, setRetryDetail] = useState<{ input: MobileWorkspaceOperation; title: string } | null>(null);
  const version = useRef(0); const heading = useRef<HTMLHeadingElement>(null); const detailOpener = useRef<HTMLElement | null>(null);
  const pendingDetail = useRef(false);
  const agent = host.catalog?.agents.find((item) => item.id === agentId);
  const assigned = useWorkspaceSelection(host, agentId, repositoryId || null);
  const [assignmentOpen, setAssignmentOpen] = useState(false);
  const query = useCallback((input: MobileWorkspaceOperation) =>
    host.request<MobileWorkspaceResult>('/api/v1/workspace/query', 'POST', { ...input, ...assigned.selection }), [host.request, assigned.selection]);
  const refresh = useCallback(async () => {
    pendingDetail.current = false;
    const own = ++version.current; setBusy(true); setError(''); setRetryDetail(null); setDetail(null); setListing(null); setOverview(undefined); setDirectory(''); setSearch('');
    try {
      const state = await query({ operation: 'overview' });
      const tree = state.overview?.ready ? await query({ operation: 'tree', path: '' }) : null;
      if (own !== version.current) return;
      setOverview(state.overview); setListing(tree);
    } catch (reason) { if (own === version.current) setError(workspaceError(reason)); }
    finally { if (own === version.current) setBusy(false); }
  }, [query, repositoryId]);
  useEffect(() => { if (!assigned.loading && !assigned.error) void refresh(); else { setOverview(undefined); setListing(null); setDetail(null); }
    return () => { version.current++; }; }, [refresh, host.identityVersion, assigned.loading, assigned.error]);
  useEffect(() => { if (!repositoryId) selectTab((current) => current === 'git' ? 'files' : current); }, [repositoryId]);
  useLayoutEffect(() => { if (detail) heading.current?.focus(); }, [detail]);
  const load = async (input: MobileWorkspaceOperation, detailTitle?: string) => {
    pendingDetail.current = !!detailTitle;
    const own = ++version.current; setBusy(true); setError(''); setRetryDetail(null);
    if (detailTitle) { detailOpener.current = document.activeElement as HTMLElement; setDetail(null); }
    try {
      const result = await query(input); if (own !== version.current) return;
      if (detailTitle) { setTitle(detailTitle); setDetail(result); } else { setListing(result); setDetail(null); }
    } catch (reason) { if (own === version.current) { setError(workspaceError(reason)); if (detailTitle) setRetryDetail({ input, title: detailTitle }); } }
    finally { if (own === version.current) { pendingDetail.current = false; setBusy(false); } }
  };
  const closeDetail = () => { setDetail(null); requestAnimationFrame(() => {
    const opener = detailOpener.current; (opener?.isConnected ? opener : document.getElementById('workspace-refresh'))?.focus();
  }); };
  const folder = (path: string) => { setDirectory(path); setSearch(''); void load({ operation: 'tree', path }); };
  const disabled = busy || assigned.loading || !!assigned.error || host.status !== 'online';
  return <Dialog title={projectEntry ? translate("Project · {{value1}}", { value1: host.catalog?.repositories.find((repo) => repo.id === repositoryId)?.name ?? 'Workspace' }) : `Workspace · ${agent?.name ?? 'Agent'}`} onClose={onClose} fallbackId="mobile-title" className={`m-agent-workspace ${tab === 'terminal' ? 'm-terminal-workspace' : ''}`}
    headerActions={tab === 'terminal' && <button ref={keyboardToggle} hidden={!keyboardOpen} className="m-keyboard-controls-toggle"
      aria-label={translate("Terminal controls")} aria-expanded={keyboardControls} aria-controls="workspace-terminal-controls"
      onPointerDown={(event) => event.preventDefault()} onClick={() => setKeyboardControls((value) => !value)}>{keyboardControls ? translate("Collapse controls") : translate("Controls")}</button>}>
    <div className="m-tablet-workbench">{!projectEntry && <aside className="m-project-rail" aria-label={translate("Workspace projects")}><h3>{translate("Projects")}</h3>
      <button aria-pressed={!repositoryId} onClick={() => setRepositoryId('')}>{translate("Personal workspace")}</button>
      {host.catalog?.repositories.map((repo) => <button key={repo.id} aria-pressed={repositoryId === repo.id} onClick={() => setRepositoryId(repo.id)}>{repo.name}</button>)}
    </aside>}<div className="m-tablet-workbench-main">
    <div className="m-workspace-controls">{!projectEntry && <label>{translate("Project")}<select aria-label={translate("Workspace project")} value={repositoryId} onChange={(event) => setRepositoryId(event.target.value)}>
      <option value="">{translate("No project · Personal workspace")}</option>{host.catalog?.repositories.map((repo) => <option key={repo.id} value={repo.id}>{repo.name}</option>)}</select></label>}
      <button id="workspace-refresh" disabled={busy || assigned.loading || host.status !== 'online'} onClick={() => { if (repositoryId) assigned.refresh(); else void refresh(); }}>{translate("Refresh workspace")}</button>
      <button id="workspace-assignment" disabled={host.status !== 'online'} onClick={() => setAssignmentOpen(true)}>{translate("Check workspace assignment")}</button>
      <button disabled={!repositoryId || host.status !== 'online'} onClick={() => onTask(repositoryId)}>{translate("Assign task")}</button>{agent && <DashboardLink agent={agent} />}</div>
    {overview?.ready && <p className="m-field-note">{translate("Assignment:")}{" "}{assigned.view?.label ?? (repositoryId ? translate("Dedicated ADE working copy") : translate("Dedicated agent folder"))} · {repositoryId ? `Branch ${overview.branch} · ` : ''}{translate("Usage at last refresh:")}{" "}{overview.busy ? translate("In use by a terminal or job") : translate("Not in use")}</p>}
    {assigned.loading && <p role="status">{translate("Loading workspace assignment…")}</p>}{assigned.error && <p role="alert">{localizeAppMessage(assigned.error)}</p>}
    <nav className="m-management-tabs" aria-label={translate("Workspace area")}><button aria-pressed={tab === 'files'} onClick={() => { setTab('files'); setDetail(null); }}>{translate("Files")}</button>
      <button disabled={!repositoryId} title={!repositoryId ? translate("Select a project for Git") : undefined} aria-pressed={tab === 'git'} onClick={() => { setTab('git'); setDetail(null); }}>{translate("Git changes")}</button>
      <button aria-pressed={tab === 'terminal'} onClick={() => { setTab('terminal'); setDetail(null); }}>{translate("Terminal")}</button>
      <button aria-pressed={tab === 'profile'} onClick={() => { setTab('profile'); setDetail(null); }}>{translate("Agent Profile")}</button></nav>
    {host.status !== 'online' && <p role="status">{translate("Connection interrupted. Data displayed may be obsolete.")}</p>}
    {busy && tab !== 'terminal' && <p role="status">{translate("Loading workspace…")}</p>}{error && tab !== 'terminal' && <p role="alert" className="m-alert">{localizeAppMessage(error)}</p>}
    {error && retryDetail && tab !== 'terminal' && <button disabled={disabled} onClick={() => void load(retryDetail.input, retryDetail.title)}>{translate("Reload details")}</button>}
    {!repositoryId && <p>{translate("Files and the terminal use the dedicated agent folder. Select a project for managed tasks and Git.")}</p>}
    {tab !== 'terminal' && overview?.notice && <p>{localizeAppMessage(overview.notice)}</p>}
    {tab !== 'terminal' && overview && !overview.ready && (repositoryId ? <button onClick={onManage}>{translate("Manage workspaces")}</button> : <button onClick={() => setTab('terminal')}>{translate("Open terminal")}</button>)}
    <div className="m-terminal-slot" hidden={tab !== 'terminal'}>{!assigned.loading && !assigned.error && <RemoteTerminalPane key={`${agentId}:${repositoryId}:${assigned.selection.projectWorkspaceId ?? ''}:${host.identityVersion}`} host={host} {...assigned.selection} active={tab === 'terminal'}
      expectedBranch={assigned.view?.branch} defaultProfileId={assigned.selection.projectWorkspaceId ? agentId : undefined}
      projectEntry={projectEntry}
      compactControls={keyboardOpen && !keyboardControls}
      initialTerminalId={repositoryId === initialRepositoryId ? initialTerminalId : undefined}
      profileIntent={!repositoryId ? profileIntent : undefined} onProfileIntentConsumed={onProfileIntentConsumed} />}</div>
    {tab === 'profile' && <AgentProfile host={host} agentId={agentId} repositoryId={repositoryId || undefined} drafts={profileDrafts} />}
    {overview?.ready && (tab === 'files' || tab === 'git') && <div className={`m-workbench-split ${detail ? 'has-detail' : ''}`}>
      <section className="m-workbench-list" aria-label={tab === 'files' ? translate("Workspace files") : translate("Modified files")}>
        {tab === 'files' ? <><form onSubmit={(event) => { event.preventDefault(); void load({ operation: 'search', search: search.trim() }); }}>
          <label>{translate("Search filenames")}<input type="search" value={search} maxLength={80} onChange={(event) => setSearch(event.target.value)} /></label>
          <button disabled={disabled || !search.trim()}>{translate("Search for files")}</button></form>
          <p className="m-workspace-location">{directory || 'Workspace'}</p>
          <button disabled={disabled || !directory && !search} onClick={() => folder(directory.split('/').slice(0, -1).join('/'))}>{translate("Parent folder")}</button>
          {!listing?.entries?.length && !busy && <p>{translate("No visible files in this selection.")}</p>}
          <ul>{listing?.entries?.map((entry) => <li key={entry.path}><button disabled={disabled} title={entry.path}
            onClick={() => entry.kind === 'directory' ? folder(entry.path) : void load({ operation: 'file', path: entry.path }, entry.path)}>
            <span aria-hidden="true">{entry.kind === 'directory' ? '▸ ' : '· '}</span>{search ? entry.path : entry.name}</button></li>)}</ul>
          {listing?.limited && <p>{translate("Selection limited. Open a subfolder or search more specifically.")}</p>}</>
          : <>{!overview.changes.length && <p>{translate("No visible uncommitted changes.")}</p>}<ul>{overview.changes.map((change) => <li key={change.path}>
            <strong>{change.path}</strong><span className="m-field-note"> {change.state}</span><div className="m-management-actions">
              {change.unstaged && <button disabled={disabled} onClick={() => void load({ operation: 'diff', path: change.path, staged: false }, translate("{{value1}} · Working file", { value1: change.path }))}>{translate("Compare working file")}</button>}
              {change.staged && <button disabled={disabled} onClick={() => void load({ operation: 'diff', path: change.path, staged: true }, translate("{{value1}} · Staged", { value1: change.path }))}>{translate("Staged change")}</button>}</div></li>)}</ul>
            <h3>{translate("Recent commits")}</h3>{!overview.commits.length && <p>{translate("There are no commits.")}</p>}<ol className="m-commit-list">{overview.commits.map((commit) => <li key={commit.sha}>
              <button disabled={disabled} aria-pressed={detail?.commit?.sha === commit.sha}
                onClick={() => void load({ operation: 'commit', sha: commit.sha }, `Commit ${commit.sha.slice(0, 8)}`)}>
                <code>{commit.sha.slice(0, 8)}</code> <span>{commit.subject}</span><span className="m-field-note">{translate("Details and changes →")}</span>
              </button></li>)}</ol>
            <button onClick={onManage}>{translate("Open Git sync")}</button></>}
      </section>
      <section className="m-workbench-detail" aria-label={detail?.commit ? translate("Commit details") : translate("File content")} onKeyDown={(event) => {
        if (event.key === 'Escape' && detail?.commit) { event.preventDefault(); event.stopPropagation(); closeDetail(); }
      }}>{detail ? <><button onClick={closeDetail}>{translate("Back to the list")}</button>
        <h3 ref={heading} tabIndex={-1}>{title}</h3>{detail.file?.notice && <p>{localizeAppMessage(detail.file.notice)}</p>}
        {detail.limited && <p>{translate("Diff is shortened.")}</p>}
        {detail.commit ? <CommitDetails key={`${detail.workspaceVersion}:${detail.commit.sha}`} commit={detail.commit} query={query} online={host.status === 'online'} errorText={workspaceError} />
          : detail.file ? <FileEditor key={`${agentId}:${repositoryId}:${assigned.selection.projectWorkspaceId ?? ''}:${detail.file.path}`} host={host} file={detail.file} workspaceVersion={detail.workspaceVersion} selection={assigned.selection}
          agentId={agentId} repositoryId={repositoryId || null} busyWorkspace={overview.busy} drafts={fileDrafts} onSaved={() => { void refresh(); document.getElementById('workspace-refresh')?.focus(); }} />
          : <pre tabIndex={0} aria-label={translate("Git diff")}>{detail.diff?.split('\n').map((line, index) =>
          <span key={index} className={line.startsWith('+') ? 'm-diff-add' : line.startsWith('-') ? 'm-diff-delete' : undefined}>{line}{'\n'}</span>)}</pre>}</>
        : <p>{translate("Select a file, change, or commit.")}</p>}</section>
    </div>}
    </div></div>
    {assignmentOpen && <WorkspaceAssignmentDialog host={host} agentId={agentId} repositoryId={repositoryId || undefined} fallbackId="workspace-assignment"
      onClose={() => setAssignmentOpen(false)} onAssigned={(view) => { setRepositoryId(view.repositoryId); assigned.refresh(); }} />}
  </Dialog>;
}
