import { localizeAppMessage } from '../shared/i18n/appMessages';
import { t as translate } from "../shared/i18n";
import { useLocale } from "../renderer/i18n/language";
import { useEffect, useMemo, useRef, useState } from 'react';
import type { MobileWorkspaceSelection, ProjectDirectoryView, WorkspaceAssignmentCommand, WorkspaceAssignmentQuery, WorkspaceAssignmentResult, WorkspaceAssignmentView } from '../shared/remote';
import type { MobileHost } from './useMobileHost';
import { MobileClientError } from './client';
import { Dialog } from './ui';
import { useDeviceDraft } from './deviceDrafts';

function assignmentError(error: unknown) {
  if (error instanceof MobileClientError) {
    if (error.status === 403) return translate("Sharing access to workspace files and project/agent management on the PC. For new projects, the project selection must allow \"All\".");
    if (error.message !== error.code) return error.message;
  }
  return translate("Assignment could not be checked. check connection and try again.");
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
  useLocale();
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
  return <Dialog title={translate("Check workspace assignment")} onClose={onClose} fallbackId={fallbackId} className="m-assignment-dialog">
    <p>{translate("Select the workspace for this agent's files and terminal. Managed tasks continue to use their own ADE working copy.")}</p>
    <div className="m-management-actions"><button disabled={disabled} onClick={() => { setBrowse(true); reload((value) => value + 1); }}>{translate("Search for projects")}</button>
      {repositoryId && <button disabled={disabled} onClick={() => { setBrowse(false); reload((value) => value + 1); }}>{translate("Workspaces of the current project")}</button>}
      <button disabled={busy || host.status !== 'online'} onClick={() => reload((value) => value + 1)}>{translate("Update list")}</button></div>
    {busy && <p role="status">{translate("Checking workspace…")}</p>}{error && <p role="alert">{localizeAppMessage(error)}</p>}
    {host.status !== 'online' && <p role="status">{translate("Connection interrupted. Reconnect to check or assign.")}</p>}
    {pending && <p role="status">{translate("Assignment not yet confirmed. “Check assignment status” uses the same job.")}</p>}
    {!durable && pending && <p role="alert">{translate("Browser could not permanently save the receipt. Leave this page open until confirmation.")}</p>}
    {browse ? <><label>{translate("Search for projects [50726f6a]")}<input type="search" value={search} maxLength={100} onChange={(event) => setSearch(event.target.value)} /></label>
      {directory?.notice && <p>{localizeAppMessage(directory.notice)}</p>}
      <p>{translate("Project folder from the root folder set on the PC and already registered projects.")}</p>
      <ul className="m-assignment-candidates">{directory?.entries.filter((item) => item.name.toLocaleLowerCase().includes(search.toLocaleLowerCase())).map((item) => <li key={item.id}>
        <strong>{item.name}</strong><span>{item.repositoryId ? translate("Registered in ADE") : translate("Not yet registered")}</span>
        {item.notice && <span>{localizeAppMessage(item.notice)}</span>}<button disabled={disabled || item.kind !== 'repository' || item.backend !== 'native'}
          onClick={() => void inspect({ operation: 'project-preview', agentId, entryId: item.id })}>{translate("Check project ·")}{" "}{item.name}</button></li>)}</ul>
      {directory && !directory.entries.some((item) => item.name.toLocaleLowerCase().includes(search.toLocaleLowerCase())) && <p>{translate("No suitable project folders found. Check project root folders in settings on the PC.")}</p>}
      {directory?.limited && <p>{translate("Register the project directly on the PC if it is missing here.")}</p>}</>
      : <ul className="m-assignment-candidates">{result?.view.candidates.map((item) => <li key={item.id}><strong>{item.name}{item.current ? translate(" · Currently assigned") : ''}</strong>
        <span>{translate("Branch")}{" "}{item.branch}</span>{item.notice && <span>{localizeAppMessage(item.notice)}</span>}<button disabled={disabled} onClick={() => void inspect({ operation: 'preview', agentId, repositoryId: repositoryId!, candidateId: item.id })}>{translate("Check the workspace ·")}{" "}{item.name}</button></li>)}</ul>}
    {result?.preview && <section aria-label={translate("Workspace check result")}><h3 ref={proofHeading} tabIndex={-1}>{translate("Check result ·")}{" "}{result.preview.candidate.name}</h3>
      <ul>{result.preview.checks.map((check) => <li key={check}>{check}</li>)}</ul>
      {result.preview.blockers.map((blocker) => <p role="alert" key={blocker}>{localizeAppMessage(blocker)}</p>)}
      {!result.preview.blockers.length && <p>{translate("Assignment fits. Confirm with \"Assign workspace\".")}</p>}</section>}
    <div className="m-management-actions"><button className="m-primary" disabled={busy || host.status !== 'online' || !pending && (!result?.preview || !!result.preview.blockers.length)} onClick={() => void assign()}>
      {pending ? translate("Check assignment status") : translate("Assign workspace")}</button><button onClick={onClose}>{translate("Cancel")}</button></div>
  </Dialog>;
}
