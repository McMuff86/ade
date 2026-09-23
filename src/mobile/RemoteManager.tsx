import { localizeAppMessage } from '../shared/i18n/appMessages';
import { intlLocale } from '../shared/i18n';
import { t as translate } from "../shared/i18n";
import { useLocale } from "../renderer/i18n/language";
import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import type { MobileAdminCommand, MobileAdministrationResult, MobileGitResult, MobileHostState } from '../shared/remote';
import type { MobileHost } from './useMobileHost';
import { MobileClientError } from './client';
import { Dialog } from './ui';
import { IntegrationDialog } from './IntegrationDialog';

function detail(reason: unknown): string {
  if (reason instanceof MobileClientError) {
    if (reason.code === 'scope_not_granted') return translate("This device does not have permission yet. Enable administrative rights in ADE on the PC under Settings → Connected devices.");
    if (reason.status === 404) return translate("This feature is not yet available on the host. update ADE on the PC.");
    if (reason.message !== reason.code) return reason.message;
  }
  return translate("Action could not be confirmed. check connection and current state.");
}

/** Keep uncertain command keys in the page, including when the manager closes. */
export function useRemoteAdministration(host: MobileHost) {
  const [state, setState] = useState<MobileHostState | null>(null);
  const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<{ command: MobileAdminCommand; key: string } | null>(null);
  const busyRef = useRef(false); const epoch = useRef(host.identityVersion);
  useEffect(() => { epoch.current = host.identityVersion; setState(null); setPending(null); setError(''); setNotice(''); }, [host.identityVersion]);
  useEffect(() => {
    if (!host.paired || host.status !== 'online') return;
    let disposed = false;
    void host.request<MobileHostState>('/api/v1/host').then((value) => { if (!disposed) setState(value); }).catch(() => undefined);
    return () => { disposed = true; };
  }, [host.paired, host.status, host.request, host.identityVersion]);
  const send = async (command: MobileAdminCommand, retry = false): Promise<MobileAdministrationResult | null> => {
    if (busyRef.current || host.status !== 'online' || host.busy || !!host.pending || (!!pending && !retry)) return null;
    const selected = retry && pending ? pending : { command, key: crypto.randomUUID() };
    const ownEpoch = epoch.current;
    busyRef.current = true; setBusy(true); setPending(selected); setError(''); setNotice('');
    try {
      const result = await host.request<MobileAdministrationResult>('/api/v1/admin/commands', 'POST', selected.command, selected.key);
      if (ownEpoch !== epoch.current) return null;
      setPending(null); setNotice(result.replayed ? translate("Already confirmed action restored.") : translate("ADE completed the action."));
      await host.refresh().catch(() => undefined); return result;
    } catch (reason) {
      if (ownEpoch !== epoch.current) return null;
      if (reason instanceof MobileClientError && [400, 403, 404, 409, 422].includes(reason.status)) setPending(null);
      setError(detail(reason)); return null;
    } finally { busyRef.current = false; setBusy(false); }
  };
  return { state, error, notice, busy, pending, send };
}
type Administration = ReturnType<typeof useRemoteAdministration>;

export function RemoteManager({ host, admin, onClose, onWorkspace }: { host: MobileHost; admin: Administration; onClose: () => void; onWorkspace?: (id: string) => void }): JSX.Element {
  useLocale();
  const [integrationOpen, setIntegrationOpen] = useState(false);
  const [tab, setTab] = useState<'projects' | 'agents' | 'git'>('projects');
  const [groupCategory, setGroupCategory] = useState('');
  const [groupName, setGroupName] = useState('');
  const [projectName, setProjectName] = useState(''); const [agentName, setAgentName] = useState('');
  const [source, setSource] = useState('runtime:codex'); const [categoryId, setCategoryId] = useState('');
  const [repositoryId, setRepositoryId] = useState(host.catalog?.repositories[0]?.id ?? '');
  const [agentId, setAgentId] = useState(host.catalog?.agents[0]?.id ?? '');
  const [sourceRef, setSourceRef] = useState(''); const [git, setGit] = useState<MobileGitResult | null>(null);
  const [queryBusy, setQueryBusy] = useState(false); const [queryError, setQueryError] = useState('');
  const [confirmGit, setConfirmGit] = useState(false); const queryVersion = useRef(0);
  useEffect(() => () => { queryVersion.current++; }, []);
  const canCatalog = admin.state?.capabilities?.includes('catalog:write') === true;
  const selectionLimited = admin.state?.resourceSelection === 'selected';
  const canCreate = canCatalog && !selectionLimited;
  const canGit = admin.state?.capabilities?.includes('repositories:write') === true && !selectionLimited;
  const disabled = admin.busy || !!admin.pending || host.busy || !!host.pending || host.status !== 'online';
  const query = useCallback(async (repo: string, ref: string, targetId?: string) => {
    if (!repo || selectionLimited) return;
    const version = ++queryVersion.current; setQueryBusy(true); setQueryError('');
    try {
      const result = await host.request<MobileGitResult>('/api/v1/admin/git', 'POST', {
        operation: targetId ? 'git-preview' : 'git-overview', repositoryId: repo,
        ...(ref ? { sourceRef: ref } : {}), ...(targetId ? { targetId } : {}),
      });
      if (version !== queryVersion.current) return;
      setGit(result); setSourceRef(result.overview.sourceRef); if (result.preview) setConfirmGit(true);
    } catch (reason) { if (version === queryVersion.current) { setGit(null); setQueryError(detail(reason)); } }
    finally { if (version === queryVersion.current) setQueryBusy(false); }
  }, [host.request, selectionLimited]);
  const selectRepository = (id: string) => { queryVersion.current++; setRepositoryId(id); setGit(null); setSourceRef(''); setQueryError(''); setQueryBusy(false); };
  const projectSelect = <label>{translate("Project")}<select aria-label={translate("Managed project")} value={repositoryId} onChange={(event) => selectRepository(event.target.value)}>
    <option value="">{translate("Choose project")}</option>{host.catalog?.repositories.map((repo) => <option key={repo.id} value={repo.id}>{repo.name}</option>)}</select></label>;
  const perform = async (command: MobileAdminCommand) => {
    const result = await admin.send(command);
    if (result?.created?.kind === 'repository') { setProjectName(''); selectRepository(result.created.id); }
    if (result?.created?.kind === 'agent') { setAgentName(''); setAgentId(result.created.id); }
    if (result?.git) { setGit({ overview: result.git }); setSourceRef(result.git.sourceRef); }
  };
  return <Dialog title={translate("Manage projects and agents")} onClose={onClose} fallbackId="mobile-title" className="m-management">
    <nav className="m-management-tabs" aria-label={translate("Management area")}>{[
      ['projects', translate("Projects & workspaces")], ['agents', translate("Agents")], ['git', translate("Git sync")],
    ].map(([id, label]) => <button key={id} aria-pressed={tab === id} onClick={() => setTab(id as typeof tab)}>{label}</button>)}</nav>
    {admin.error && <p role="alert" className="m-alert">{localizeAppMessage(admin.error)}</p>}{admin.notice && <p role="status">{localizeAppMessage(admin.notice)}</p>}
    {admin.pending && <div className="m-notice"><p>{translate("This operation is not confirmed yet. Check the same request before starting a new operation.")}</p>
      <button disabled={admin.busy || host.status !== 'online'} onClick={() => { if (admin.pending) void admin.send(admin.pending.command, true); }}>{translate("Re-examine action")}</button></div>}
    {!admin.state && <p>{translate("Management privileges are loaded from the host when you connect, and for older hosts, update ADE first on the PC.")}</p>}
    {selectionLimited && <p>{translate("This device uses selected projects and agents. Create and share new entries on the PC. Commit, merge and PR can be found on the open project.")}</p>}
    {tab !== 'git' && !canCatalog && <p>{translate("To create agents and projects, share the management rights of this device in ADE on the PC.")}</p>}
    {tab === 'projects' && <div className="m-management-grid"><section><h3>{translate("New project")}</h3><p>{translate("Creates a new Git project on your PC. ADE manages the project folder.")}</p>
      <form onSubmit={(event) => { event.preventDefault(); void perform({ operation: 'project-create', input: { name: projectName.trim() } }); }}>
        <label>{translate("Project name")}<input value={projectName} maxLength={80} required onChange={(event) => setProjectName(event.target.value)} /></label>
        <button className="m-primary" disabled={disabled || !canCreate || !projectName.trim()}>{translate("Create project")}</button></form></section>
      <section><h3>{translate("Prepare an agent workspace")}</h3><p>{translate("Each agent receives its own branch and work folder for each project.")}</p>
        <form onSubmit={(event) => { event.preventDefault(); void perform({ operation: 'workspace-prepare', input: { agentId, repositoryId } }); }}>
          {projectSelect}<label>{translate("Agent")}<select aria-label={translate("Workspace agent")} value={agentId} onChange={(event) => setAgentId(event.target.value)}><option value="">{translate("Choose agent")}</option>
            {host.catalog?.agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select></label>
          <button disabled={disabled || !canCatalog || !repositoryId || !agentId}>{translate("Prepare workspace")}</button></form></section></div>}
    {tab === 'agents' && <section><h3>{translate("New agent")}</h3><p>{translate("Choose a default profile or the settings of an existing agent, and the new agent gets its own identity and storage.")}</p>
      <form onSubmit={(event) => {
        event.preventDefault(); const selected = host.catalog?.agentSources?.find((item) => `${item.kind}:${item.id}` === source);
        if (selected) void perform({ operation: 'agent-create', input: { name: agentName.trim(), source: { kind: selected.kind, id: selected.id }, ...(categoryId ? { categoryId } : {}) } });
      }}><label>{translate("Agent name")}<input value={agentName} maxLength={80} required onChange={(event) => setAgentName(event.target.value)} /></label>
        <label>{translate("Agent template")}<select aria-label={translate("Agent template")} value={source} onChange={(event) => setSource(event.target.value)}>{host.catalog?.agentSources?.map((item) =>
          <option key={`${item.kind}:${item.id}`} value={`${item.kind}:${item.id}`}>{item.name} · {item.runtime}</option>)}</select></label>
        <label>{translate("Group")}<select aria-label={translate("Group")} value={categoryId} onChange={(event) => setCategoryId(event.target.value)}><option value="">{translate("Standard group")}</option>
          {host.catalog?.categories?.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <button className="m-primary" disabled={disabled || !canCreate || !agentName.trim()}>{translate("Create agent")}</button></form></section>}
    {tab === 'agents' && <section><h3>{translate("Parent groups")}</h3><p>{translate("Assign existing categories to a shared parent group.")}</p>
      <form onSubmit={(event) => { event.preventDefault(); void perform({ operation: 'category-group', input: { categoryId: groupCategory, navigationGroup: groupName.trim() || null } }); }}>
        <label>{translate("Category")}<select aria-label={translate("Category for parent group")} value={groupCategory} onChange={(event) => {
          setGroupCategory(event.target.value); setGroupName(host.catalog?.categories?.find((item) => item.id === event.target.value)?.navigationGroup ?? '');
        }}><option value="">{translate("Choose a category")}</option>{host.catalog?.categories?.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label>{translate("Parent group")}<input value={groupName} maxLength={80} list="mobile-navigation-groups" placeholder={translate("No parent group")} onChange={(event) => setGroupName(event.target.value)} /></label>
        <datalist id="mobile-navigation-groups">{[...new Set(host.catalog?.categories?.flatMap((item) => item.navigationGroup ? [item.navigationGroup] : []) ?? [])].map((name) => <option key={name} value={name} />)}</datalist>
        <p>{translate("Choose an existing name or enter a new parent group. Leave empty to remove the assignment.")}</p>
        <button disabled={disabled || !canCreate || !groupCategory}>{translate("Save parent group")}</button>
      </form></section>}
    {tab === 'git' && <section><h3>{translate("Git sync")}</h3><p>{translate("Compare the project checkout and the agent workspaces with a common basis.")}</p>
      <div className="m-management-grid">{projectSelect}{git && <label>{translate("Comparison base")}<select aria-label={translate("Comparison base")} value={sourceRef} disabled={queryBusy || disabled}
        onChange={(event) => { setSourceRef(event.target.value); void query(repositoryId, event.target.value); }}>{git.overview.refs.map((item) => <option key={item.ref} value={item.ref}>{item.label}</option>)}</select></label>}</div>
      <div className="m-management-actions"><button disabled={!repositoryId || queryBusy || disabled} onClick={() => void query(repositoryId, sourceRef)}>{translate("Check the git state")}</button>
        <button disabled={!repositoryId || disabled || selectionLimited} onClick={(event) => { event.currentTarget.focus(); setIntegrationOpen(true); }}>{translate("Apply changes…")}</button>
        <button disabled={!repositoryId || !canGit || queryBusy || disabled} onClick={() => void perform({ operation: 'git-fetch', input: { repositoryId } })}>{translate("Fetch changes")}</button></div>
      {!canGit && <p>{translate("Sharing Git management rights in ADE on PC to retrieve and update.")}</p>}
      {queryBusy && <p role="status">{translate("Checking Git status…")}</p>}{queryError && <p role="alert">{queryError}</p>}
      {git && <><p className="m-field-note">{translate("Origin last fetched:")}{" "}{git.overview.remoteCheckedAt ? new Date(git.overview.remoteCheckedAt).toLocaleString(intlLocale()) : translate("Not yet retrieved in this ADE session")}</p>
        <ul className="m-git-targets">{git.overview.targets.map((target) => <li key={target.id}><strong>{target.name}</strong><span>{target.branch || translate("No branch")}</span>
          <p>{target.ahead === null ? translate("Comparison unknown") : translate("{{value1}} ahead · {{value2}} behind · {{value3}} uncommitted changes", { value1: target.ahead, value2: target.behind, value3: target.changedFiles })}</p>
          {target.blockedReason && <p>{localizeAppMessage(target.blockedReason)}</p>}<button disabled={disabled || queryBusy || !canGit || !!target.blockedReason || !target.behind}
            aria-label={translate("Check update for {{value1}}", { value1: target.name })} onClick={() => void query(repositoryId, sourceRef, target.id)}>{translate("Check update")}</button></li>)}</ul></>}
    </section>}
    {admin.busy && <p role="status">{translate("ADE is performing the operation…")}</p>}
    {integrationOpen && repositoryId && <IntegrationDialog key={repositoryId} host={host} repositoryId={repositoryId} canChange={canGit}
      canTest={canGit && admin.state?.capabilities?.includes('terminal:control') === true} onClose={() => setIntegrationOpen(false)}
      onWorkspace={(id) => { if (onWorkspace) { setIntegrationOpen(false); onClose(); onWorkspace(id); } }} />}
    {confirmGit && git?.preview && <Dialog title={translate("Confirm Git Update")} onClose={() => setConfirmGit(false)} fallbackId="mobile-title">
      <p><strong>{git.preview.target.name}</strong> {" "}{translate("on")}{" "}{git.overview.sourceRef}{" "}{translate("update.")}</p>
      <p className="m-sha">{git.preview.target.headSha} → {git.overview.sourceSha}</p>
      <p>{git.preview.target.behind}{" "}{translate("Commit(s).ADE rechecks Branch, work folder and occupancy before the update.")}</p>
      <button onClick={() => setConfirmGit(false)}>{translate("Cancel")}</button><button className="m-primary" disabled={disabled} onClick={() => {
        const previewId = git.preview!.id; setConfirmGit(false); void perform({ operation: 'git-apply', input: { previewId } });
      }}>{translate("Confirm fast-forward")}</button></Dialog>}
  </Dialog>;
}
