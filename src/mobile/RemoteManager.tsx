import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import type { MobileAdminCommand, MobileAdministrationResult, MobileGitResult, MobileHostState } from '../shared/remote';
import type { MobileHost } from './useMobileHost';
import { MobileClientError } from './client';
import { Dialog } from './ui';

function detail(reason: unknown): string {
  if (reason instanceof MobileClientError) {
    if (reason.code === 'scope_not_granted') return 'Dieses Gerät hat dafür noch keine Freigabe. Verwaltungsrechte in ADE am PC unter Settings → Verbundene Geräte freigeben.';
    if (reason.status === 404) return 'Diese Funktion ist auf dem Host noch nicht verfügbar. ADE am PC aktualisieren.';
    if (reason.message !== reason.code) return reason.message;
  }
  return 'Aktion konnte nicht bestätigt werden. Verbindung und aktuellen Zustand prüfen.';
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
      setPending(null); setNotice(result.replayed ? 'Bereits bestätigte Aktion wiederhergestellt.' : 'ADE hat die Aktion abgeschlossen.');
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

export function RemoteManager({ host, admin, onClose }: { host: MobileHost; admin: Administration; onClose: () => void }): JSX.Element {
  const [tab, setTab] = useState<'projects' | 'agents' | 'git'>('projects');
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
  const projectSelect = <label>Projekt<select aria-label="Verwaltetes Projekt" value={repositoryId} onChange={(event) => selectRepository(event.target.value)}>
    <option value="">Projekt wählen</option>{host.catalog?.repositories.map((repo) => <option key={repo.id} value={repo.id}>{repo.name}</option>)}</select></label>;
  const perform = async (command: MobileAdminCommand) => {
    const result = await admin.send(command);
    if (result?.created?.kind === 'repository') { setProjectName(''); selectRepository(result.created.id); }
    if (result?.created?.kind === 'agent') { setAgentName(''); setAgentId(result.created.id); }
    if (result?.git) { setGit({ overview: result.git }); setSourceRef(result.git.sourceRef); }
  };
  return <Dialog title="Projekte und Agents verwalten" onClose={onClose} fallbackId="mobile-title" className="m-management">
    <nav className="m-management-tabs" aria-label="Verwaltungsbereich">{[
      ['projects', 'Projekte & Workspaces'], ['agents', 'Agents'], ['git', 'Git-Abgleich'],
    ].map(([id, label]) => <button key={id} aria-pressed={tab === id} onClick={() => setTab(id as typeof tab)}>{label}</button>)}</nav>
    {admin.error && <p role="alert" className="m-alert">{admin.error}</p>}{admin.notice && <p role="status">{admin.notice}</p>}
    {admin.pending && <div className="m-notice"><p>Diese Aktion ist noch nicht bestätigt. Vor einer neuen Aktion dieselbe Anfrage prüfen.</p>
      <button disabled={admin.busy || host.status !== 'online'} onClick={() => { if (admin.pending) void admin.send(admin.pending.command, true); }}>Aktion erneut prüfen</button></div>}
    {!admin.state && <p>Verwaltungsrechte werden beim Verbinden vom Host geladen. Für ältere Hosts ADE zuerst am PC aktualisieren.</p>}
    {selectionLimited && <p>Dieses Gerät nutzt ausgewählte Projekte und Agenten. Neue Einträge am PC erstellen und freigeben. Commit, Merge und PR findest du beim geöffneten Projekt.</p>}
    {tab !== 'git' && !canCatalog && <p>Zum Erstellen von Agents und Projekten die Verwaltungsrechte dieses Geräts in ADE am PC freigeben.</p>}
    {tab === 'projects' && <div className="m-management-grid"><section><h3>Neues Projekt</h3><p>Erstellt ein neues Git-Projekt auf deinem PC. ADE verwaltet den Projektordner.</p>
      <form onSubmit={(event) => { event.preventDefault(); void perform({ operation: 'project-create', input: { name: projectName.trim() } }); }}>
        <label>Projektname<input value={projectName} maxLength={80} required onChange={(event) => setProjectName(event.target.value)} /></label>
        <button className="m-primary" disabled={disabled || !canCreate || !projectName.trim()}>Projekt erstellen</button></form></section>
      <section><h3>Agent-Workspace vorbereiten</h3><p>Jeder Agent erhält je Projekt einen eigenen Branch und Arbeitsordner.</p>
        <form onSubmit={(event) => { event.preventDefault(); void perform({ operation: 'workspace-prepare', input: { agentId, repositoryId } }); }}>
          {projectSelect}<label>Agent<select aria-label="Workspace-Agent" value={agentId} onChange={(event) => setAgentId(event.target.value)}><option value="">Agent wählen</option>
            {host.catalog?.agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select></label>
          <button disabled={disabled || !canCatalog || !repositoryId || !agentId}>Workspace vorbereiten</button></form></section></div>}
    {tab === 'agents' && <section><h3>Neuer Agent</h3><p>Wähle ein Standardprofil oder die Einstellungen eines vorhandenen Agents. Der neue Agent erhält eine eigene Identität und eigenen Speicher.</p>
      <form onSubmit={(event) => {
        event.preventDefault(); const selected = host.catalog?.agentSources?.find((item) => `${item.kind}:${item.id}` === source);
        if (selected) void perform({ operation: 'agent-create', input: { name: agentName.trim(), source: { kind: selected.kind, id: selected.id }, ...(categoryId ? { categoryId } : {}) } });
      }}><label>Agentname<input value={agentName} maxLength={80} required onChange={(event) => setAgentName(event.target.value)} /></label>
        <label>Agent-Vorlage<select aria-label="Agent-Vorlage" value={source} onChange={(event) => setSource(event.target.value)}>{host.catalog?.agentSources?.map((item) =>
          <option key={`${item.kind}:${item.id}`} value={`${item.kind}:${item.id}`}>{item.name} · {item.runtime}</option>)}</select></label>
        <label>Gruppe<select aria-label="Gruppe" value={categoryId} onChange={(event) => setCategoryId(event.target.value)}><option value="">Standardgruppe</option>
          {host.catalog?.categories?.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <button className="m-primary" disabled={disabled || !canCreate || !agentName.trim()}>Agent erstellen</button></form></section>}
    {tab === 'git' && <section><h3>Git-Abgleich</h3><p>Vergleiche den Projekt-Checkout und die Agent-Workspaces mit einer gemeinsamen Basis.</p>
      <div className="m-management-grid">{projectSelect}{git && <label>Vergleichsbasis<select aria-label="Vergleichsbasis" value={sourceRef} disabled={queryBusy || disabled}
        onChange={(event) => { setSourceRef(event.target.value); void query(repositoryId, event.target.value); }}>{git.overview.refs.map((item) => <option key={item.ref} value={item.ref}>{item.label}</option>)}</select></label>}</div>
      <div className="m-management-actions"><button disabled={!repositoryId || queryBusy || disabled} onClick={() => void query(repositoryId, sourceRef)}>Git-Zustand prüfen</button>
        <button disabled={!repositoryId || !canGit || queryBusy || disabled} onClick={() => void perform({ operation: 'git-fetch', input: { repositoryId } })}>Änderungen abrufen</button></div>
      {!canGit && <p>Zum Abrufen und Aktualisieren Git-Verwaltungsrechte in ADE am PC freigeben.</p>}
      {queryBusy && <p role="status">Git-Zustand wird geprüft…</p>}{queryError && <p role="alert">{queryError}</p>}
      {git && <><p className="m-field-note">Origin zuletzt abgerufen: {git.overview.remoteCheckedAt ? new Date(git.overview.remoteCheckedAt).toLocaleString() : 'In dieser ADE-Sitzung noch nicht abgerufen'}</p>
        <ul className="m-git-targets">{git.overview.targets.map((target) => <li key={target.id}><strong>{target.name}</strong><span>{target.branch || 'Kein Branch'}</span>
          <p>{target.ahead === null ? 'Vergleich unbekannt' : `${target.ahead} voraus · ${target.behind} zurück · ${target.changedFiles} uncommittete Änderungen`}</p>
          {target.blockedReason && <p>{target.blockedReason}</p>}<button disabled={disabled || queryBusy || !canGit || !!target.blockedReason || !target.behind}
            aria-label={`Update für ${target.name} prüfen`} onClick={() => void query(repositoryId, sourceRef, target.id)}>Update prüfen</button></li>)}</ul></>}
    </section>}
    {admin.busy && <p role="status">ADE führt die Aktion aus…</p>}
    {confirmGit && git?.preview && <Dialog title="Git-Update bestätigen" onClose={() => setConfirmGit(false)} fallbackId="mobile-title">
      <p><strong>{git.preview.target.name}</strong> auf {git.overview.sourceRef} aktualisieren.</p>
      <p className="m-sha">{git.preview.target.headSha} → {git.overview.sourceSha}</p>
      <p>{git.preview.target.behind} Commit(s). ADE prüft Branch, Arbeitsordner und Belegung vor dem Update erneut.</p>
      <button onClick={() => setConfirmGit(false)}>Abbrechen</button><button className="m-primary" disabled={disabled} onClick={() => {
        const previewId = git.preview!.id; setConfirmGit(false); void perform({ operation: 'git-apply', input: { previewId } });
      }}>Fast-forward bestätigen</button></Dialog>}
  </Dialog>;
}
