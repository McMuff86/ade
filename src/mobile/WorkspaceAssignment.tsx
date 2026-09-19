import { useEffect, useMemo, useRef, useState } from 'react';
import type { MobileWorkspaceSelection, ProjectDirectoryView, WorkspaceAssignmentCommand, WorkspaceAssignmentQuery, WorkspaceAssignmentResult, WorkspaceAssignmentView } from '../shared/remote';
import type { MobileHost } from './useMobileHost';
import { MobileClientError } from './client';
import { Dialog } from './ui';
import { useDeviceDraft } from './deviceDrafts';

function assignmentError(error: unknown) {
  if (error instanceof MobileClientError) {
    if (error.status === 403) return 'Am PC den Zugriff auf Workspace-Dateien und die Projekt-/Agent-Verwaltung freigeben. Für neue Projekte muss die Projektauswahl „Alle“ erlauben.';
    if (error.message !== error.code) return error.message;
  }
  return 'Zuweisung konnte nicht geprüft werden. Verbindung prüfen und erneut versuchen.';
}

/** Keep the selected UI scope separate from immutable task/lease bindings. */
export function useWorkspaceSelection(host: MobileHost, agentId?: string, repositoryId?: string | null) {
  const [revision, refresh] = useState(0);
  const key = `${host.identityVersion}:${agentId}:${repositoryId}:${revision}`;
  const needed = !!agentId && !!repositoryId;
  const [state, setState] = useState<{ key: string; view?: WorkspaceAssignmentView; error?: string }>({ key: '' });
  useEffect(() => {
    if (!needed || host.status !== 'online') return;
    let alive = true;
    void host.request<WorkspaceAssignmentResult>('/api/v1/workspace/assignment/query', 'POST', { operation: 'overview', agentId, repositoryId })
      .then((result) => { if (alive) setState({ key, view: result.view }); })
      .catch((error) => { if (alive) setState({ key, ...(error instanceof MobileClientError && [403, 404].includes(error.status) ? {} : { error: assignmentError(error) }) }); });
    return () => { alive = false; };
  }, [key, needed, host.request, host.status]);
  const current = state.key === key ? state : undefined;
  const projectWorkspaceId = current?.view?.selection.projectWorkspaceId;
  const selection = useMemo<MobileWorkspaceSelection>(() => projectWorkspaceId ? { projectWorkspaceId } : { agentId: agentId!, repositoryId: repositoryId ?? null }, [projectWorkspaceId, agentId, repositoryId]);
  return { selection, view: current?.view, error: current?.error, loading: needed && !current, refresh: () => refresh((value) => value + 1) };
}

export function WorkspaceAssignmentDialog({ host, agentId, repositoryId, browseInitially = false, onAssigned, onClose, fallbackId }: {
  host: MobileHost; agentId: string; repositoryId?: string; browseInitially?: boolean;
  onAssigned: (view: WorkspaceAssignmentView) => void; onClose: () => void; fallbackId: string;
}) {
  const [browse, setBrowse] = useState(browseInitially || !repositoryId);
  const [directory, setDirectory] = useState<ProjectDirectoryView>(); const [search, setSearch] = useState('');
  const [result, setResult] = useState<WorkspaceAssignmentResult>();
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const [pending, setPending, durable] = useDeviceDraft<{ command: WorkspaceAssignmentCommand; key: string } | null>(host.deviceId, `workspace-assignment:${agentId}`, null);
  const [revision, reload] = useState(0); const live = useRef(true); const locked = useRef(false);
  const proofHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  useEffect(() => { if (result?.preview) proofHeading.current?.focus(); }, [result?.preview?.id]);
  useEffect(() => {
    if (host.status !== 'online') return;
    let stopped = false; setBusy(true); setError(''); setResult(undefined);
    const promise = browse ? host.request<{ directory: ProjectDirectoryView }>('/api/v1/projects/query', 'POST', { operation: 'directory' })
      .then((value) => { if (!stopped) setDirectory(value.directory); })
      : host.request<WorkspaceAssignmentResult>('/api/v1/workspace/assignment/query', 'POST', { operation: 'overview', agentId, repositoryId })
        .then((value) => { if (!stopped) setResult(value); });
    void promise.catch((error) => { if (!stopped) setError(assignmentError(error)); }).finally(() => { if (!stopped) setBusy(false); });
    return () => { stopped = true; };
  }, [browse, revision, host.status, host.request, agentId, repositoryId]);
  const inspect = async (query: WorkspaceAssignmentQuery) => {
    if (locked.current || pending) return; locked.current = true; setBusy(true); setError(''); setResult(undefined);
    try { const value = await host.request<WorkspaceAssignmentResult>('/api/v1/workspace/assignment/query', 'POST', query); if (live.current) setResult(value); }
    catch (error) { if (live.current) setError(assignmentError(error)); }
    finally { locked.current = false; if (live.current) setBusy(false); }
  };
  const assign = async () => {
    if (locked.current || !pending && !result?.preview || host.status !== 'online') return;
    locked.current = true; setBusy(true); setError('');
    const request = pending ?? { command: { agentId, previewId: result!.preview!.id }, key: crypto.randomUUID() };
    setPending(request);
    try {
      const confirmed = await host.request<WorkspaceAssignmentResult>('/api/v1/workspace/assignment/command', 'POST', request.command, request.key);
      setPending(null); await host.refresh().catch(() => undefined);
      if (live.current) { onAssigned(confirmed.view); onClose(); }
    } catch (error) {
      if (error instanceof MobileClientError && [400, 403, 404, 409, 422].includes(error.status)) setPending(null);
      if (live.current) setError(assignmentError(error));
    } finally { locked.current = false; if (live.current) setBusy(false); }
  };
  const disabled = busy || !!pending || host.status !== 'online';
  return <Dialog title="Workspace-Zuweisung prüfen" onClose={onClose} fallbackId={fallbackId} className="m-assignment-dialog">
    <p>Wähle den Workspace für Dateien und Terminal dieses Agenten. Verwaltete Aufgaben verwenden weiterhin ihre eigene ADE-Arbeitskopie.</p>
    <div className="m-management-actions"><button disabled={disabled} onClick={() => { setBrowse(true); reload((value) => value + 1); }}>Projekte durchsuchen</button>
      {repositoryId && <button disabled={disabled} onClick={() => { setBrowse(false); reload((value) => value + 1); }}>Workspaces des aktuellen Projekts</button>}
      <button disabled={busy || host.status !== 'online'} onClick={() => reload((value) => value + 1)}>Liste aktualisieren</button></div>
    {busy && <p role="status">Workspace wird geprüft…</p>}{error && <p role="alert">{error}</p>}
    {host.status !== 'online' && <p role="status">Verbindung unterbrochen. Erneut verbinden, um zu prüfen oder zuzuweisen.</p>}
    {pending && <p role="status">Zuweisung noch nicht bestätigt. „Zuweisungsstatus prüfen“ verwendet denselben Auftrag.</p>}
    {!durable && pending && <p role="alert">Browser konnte die Quittung nicht dauerhaft speichern. Diese Seite bis zur Bestätigung offen lassen.</p>}
    {browse ? <><label>Projekte suchen<input type="search" value={search} maxLength={100} onChange={(event) => setSearch(event.target.value)} /></label>
      {directory?.notice && <p>{directory.notice}</p>}
      <p>Projektordner aus dem am PC festgelegten Stammordner und bereits registrierte Projekte.</p>
      <ul className="m-assignment-candidates">{directory?.entries.filter((item) => item.name.toLocaleLowerCase().includes(search.toLocaleLowerCase())).map((item) => <li key={item.id}>
        <strong>{item.name}</strong><span>{item.repositoryId ? 'In ADE registriert' : 'Noch nicht registriert'}</span>
        {item.notice && <span>{item.notice}</span>}<button disabled={disabled || item.kind !== 'repository' || item.backend !== 'native'}
          onClick={() => void inspect({ operation: 'project-preview', agentId, entryId: item.id })}>Projekt prüfen · {item.name}</button></li>)}</ul>
      {directory && !directory.entries.some((item) => item.name.toLocaleLowerCase().includes(search.toLocaleLowerCase())) && <p>Keine passenden Projektordner gefunden. Projekt-Stammordner in Einstellungen am PC prüfen.</p>}
      {directory?.limited && <p>Liste begrenzt. Projekt am PC direkt registrieren, wenn es hier fehlt.</p>}</>
      : <ul className="m-assignment-candidates">{result?.view.candidates.map((item) => <li key={item.id}><strong>{item.name}{item.current ? ' · Aktuell zugewiesen' : ''}</strong>
        <span>Branch {item.branch}</span>{item.notice && <span>{item.notice}</span>}<button disabled={disabled} onClick={() => void inspect({ operation: 'preview', agentId, repositoryId: repositoryId!, candidateId: item.id })}>Workspace prüfen · {item.name}</button></li>)}</ul>}
    {result?.preview && <section aria-label="Ergebnis der Workspace-Prüfung"><h3 ref={proofHeading} tabIndex={-1}>Prüfergebnis · {result.preview.candidate.name}</h3>
      <ul>{result.preview.checks.map((check) => <li key={check}>{check}</li>)}</ul>
      {result.preview.blockers.map((blocker) => <p role="alert" key={blocker}>{blocker}</p>)}
      {!result.preview.blockers.length && <p>Zuordnung passt. Mit „Workspace zuweisen“ bestätigen.</p>}</section>}
    <div className="m-management-actions"><button className="m-primary" disabled={busy || host.status !== 'online' || !pending && (!result?.preview || !!result.preview.blockers.length)} onClick={() => void assign()}>
      {pending ? 'Zuweisungsstatus prüfen' : 'Workspace zuweisen'}</button><button onClick={onClose}>Abbrechen</button></div>
  </Dialog>;
}
