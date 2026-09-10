import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ProjectGitOverview, ProjectPublication, ProjectPublishAction, ProjectPublishPreview, ProjectPublishStatus, ProjectWorkspaceCommandResult, ProjectWorkspaceQuery, ProjectWorkspaceQueryResult, ProjectWorkspaceView } from '../../shared/remote';

export interface PendingProjectPublish { key: string; preview: ProjectPublishPreview }
export interface ProjectPublishPanelProps {
  workspace: ProjectWorkspaceView; online: boolean; canPublish: boolean;
  query: (input: ProjectWorkspaceQuery) => Promise<ProjectWorkspaceQueryResult>;
  apply: (id: string, key: string) => Promise<ProjectWorkspaceCommandResult>;
  errorText: (error: unknown) => string; pending: PendingProjectPublish | null;
  savePending: (pending: PendingProjectPublish | null) => boolean;
}
export function ProjectPublishPanel({ workspace, online, canPublish, query, apply, errorText, pending, savePending }: ProjectPublishPanelProps) {
  const [expanded, setExpanded] = useState(!!pending); const [local, setLocal] = useState<ProjectGitOverview>();
  const [remote, setRemote] = useState('origin'); const [status, setStatus] = useState<ProjectPublishStatus>();
  const [base, setBase] = useState('main'); const [title, setTitle] = useState(''); const [body, setBody] = useState(''); const [draft, setDraft] = useState(true);
  const [preview, setPreview] = useState<ProjectPublishPreview>(); const [done, setDone] = useState<ProjectPublication>();
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const live = useRef(true); const lock = useRef(false); const focus = useRef<HTMLHeadingElement>(null); const summary = useRef<HTMLElement>(null);
  const opener = useRef<HTMLElement | null>(null); const restore = useRef(false); const current = pending?.preview ?? preview;
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  useLayoutEffect(() => { if (current) { setExpanded(true); focus.current?.focus(); } else if (restore.current) {
    restore.current = false; (opener.current?.isConnected ? opener.current : summary.current)?.focus();
  } }, [current]);
  const loadLocal = useCallback(async () => {
    if (!online || lock.current) return; lock.current = true; setBusy(true);
    try { const result = (await query({ operation: 'git', workspaceId: workspace.id })).git;
      if (live.current && result) { setLocal(result); setRemote((value) => result.remotes.includes(value) ? value : result.remotes[0] ?? ''); } }
    catch (reason) { if (live.current) setError(errorText(reason)); }
    finally { lock.current = false; if (live.current) setBusy(false); }
  }, [online, query, workspace.id, errorText]);
  useEffect(() => { if (expanded) void loadLocal(); }, [expanded, loadLocal]);
  const inspect = async () => {
    if (!online || lock.current || !remote) return; lock.current = true; setBusy(true); setError('');
    try { const result = await query({ operation: 'publish-status', workspaceId: workspace.id, remote }); if (live.current) setStatus(result.publish); }
    catch (reason) { if (live.current) setError(errorText(reason)); }
    finally { lock.current = false; if (live.current) setBusy(false); }
  };
  const prepare = async (action: ProjectPublishAction) => {
    if (!online || !canPublish || lock.current || pending) return; lock.current = true; setBusy(true); setError(''); setDone(undefined); opener.current = document.activeElement as HTMLElement;
    try { const result = await query({ operation: 'publish-preview', workspaceId: workspace.id, action }); if (live.current) { setPreview(result.publishPreview); setStatus(result.publishPreview?.status); } }
    catch (reason) { if (live.current) setError(errorText(reason)); }
    finally { lock.current = false; if (live.current) setBusy(false); }
  };
  const execute = async () => {
    if (!current || !online || !canPublish || lock.current) return;
    const request = pending ?? { key: crypto.randomUUID(), preview: current };
    if (!savePending(request)) { setError('Browser-Speicher nicht verfügbar. Veröffentlichung wurde nicht gesendet.'); return; }
    lock.current = true; setBusy(true); setError('');
    try {
      const result = await apply(request.preview.id, request.key); if (!live.current) return;
      if (!result.publication) throw new Error('Veröffentlichungsbestätigung fehlt. Remote-Stand prüfen.');
      setDone(result.publication);
      if (!savePending(null)) { setError('Bestätigung nicht gespeichert. Denselben Vorgang erneut prüfen.'); return; }
      setPreview(undefined); setStatus(undefined); restore.current = true;
    } catch (reason) { if (live.current) setError(errorText(reason)); }
    finally { lock.current = false; if (live.current) setBusy(false); }
  };
  const blocked = !online || busy || !canPublish || !!pending || !remote;
  return <details className="project-publish" open={expanded} onToggle={(event) => setExpanded(event.currentTarget.open)}>
    <summary ref={summary}>Push und Pull Request</summary>
    <section aria-label="Projekt veröffentlichen">
      <p>Committen sichert lokal. Push überträgt den gewählten Branch; ein Pull Request schlägt seine Übernahme vor.</p>
      {!canPublish && <p role="status">Am PC „Projekt-Branches pushen und GitHub-PRs erstellen“ freigeben.</p>}
      {!online && <p role="status">Offline · Veröffentlichung gesperrt.</p>}{busy && <p role="status">Veröffentlichung wird geprüft…</p>}
      {error && <p role="alert">{error}</p>}
      <label>Veröffentlichungs-Remote<select aria-label="Veröffentlichungs-Remote" disabled={busy || !!current} value={remote} onChange={(event) => { setRemote(event.target.value); setStatus(undefined); }}>
        {local?.remotes.map((name) => <option key={name}>{name}</option>)}</select></label>
      {local && !local.remotes.length && <p>Kein Remote konfiguriert. Am PC zuerst einen Remote hinzufügen.</p>}
      <button disabled={busy || !online || !remote} onClick={() => void inspect()}>Remote-Stand prüfen</button>
      {status && <section aria-label="Veröffentlichungsstand"><p>{status.target} · {status.branch}</p>
        <p>Lokal: {status.head.slice(0, 12)} · Remote: {status.remoteHead?.slice(0, 12) ?? 'Branch noch nicht vorhanden'}</p>
        <p>{status.remoteHead === status.head ? 'Dieser Commit ist auf dem Remote.' : 'Lokaler und Remote-Stand unterscheiden sich.'}</p>
        {status.providerNotice && <p>{status.providerNotice}</p>}
        {status.pullRequests.map((pr) => <p key={pr.number}><a href={pr.url} target="_blank" rel="noopener noreferrer">PR #{pr.number}</a> → {pr.base}{pr.draft ? ' · Entwurf' : ''}</p>)}
      </section>}
      {done && <p role="status">{done.kind === 'push' ? 'Push bestätigt' : 'Pull Request bestätigt'} für {done.branch} · {done.head.slice(0, 12)} · {new Date(done.confirmedAt).toLocaleString()}.
        {done.url && <> <a href={done.url} target="_blank" rel="noopener noreferrer">PR öffnen</a></>}</p>}
      {current ? <section className="project-branch-review" aria-label="Veröffentlichungsvorschau">
        <h3 ref={focus} tabIndex={-1}>{current.action.kind === 'push' ? 'Push' : 'Pull Request'} prüfen</h3>
        <p>{current.status.target} · {current.status.branch}{current.action.kind === 'pr' ? ` → ${current.action.base}` : ''}</p>
        <p>Commit {current.status.head.slice(0, 12)} · {current.commitCount} Commits · {current.changedFiles.length} Dateien</p>
        <p>Remote-Basis: {current.baseHead?.slice(0, 12) ?? 'Neuer Remote-Branch'}</p>
        {current.action.kind === 'pr' ? <><h4>{current.action.title}</h4><pre>{current.action.body}</pre><p>{current.action.draft ? 'PR als Entwurf' : 'PR bereit zur Prüfung'}. Der Branch wird dabei nicht zusätzlich gepusht.</p></>
          : <p>Dieser Branch wird veröffentlicht. Andere Branches und Tags bleiben unverändert; kein Force-Push.</p>}
        <ul>{current.changedFiles.map((path) => <li key={path}>{path}</li>)}</ul>
        {pending && <p role="status">Antwort nicht bestätigt. Erneut prüfen verwendet denselben Vorgang; Remote-Stand prüfen liest das Ziel.</p>}
        <button disabled={!online || busy || !canPublish} onClick={() => void execute()}>{pending ? 'Veröffentlichung erneut prüfen' : current.action.kind === 'push' ? 'Push ausführen' : 'PR erstellen'}</button>
        <button disabled={busy} onClick={() => { if (savePending(null)) { setPreview(undefined); setError(''); restore.current = true; } }}>{pending ? 'Vorschau nach Prüfung verwerfen' : 'Abbrechen'}</button>
      </section> : <>
        <button disabled={blocked} onClick={() => void prepare({ kind: 'push', remote })}>Push prüfen</button>
        <details><summary>GitHub Pull Request vorbereiten</summary>
          <label>PR-Zielbranch<input aria-label="PR-Zielbranch" value={base} maxLength={200} onChange={(event) => setBase(event.target.value)} /></label>
          <label>PR-Titel<input aria-label="PR-Titel" value={title} maxLength={160} onChange={(event) => setTitle(event.target.value)} /></label>
          <label>PR-Beschreibung<textarea aria-label="PR-Beschreibung" value={body} rows={4} maxLength={8000} onChange={(event) => setBody(event.target.value)} /></label>
          <label><input type="checkbox" checked={draft} onChange={(event) => setDraft(event.target.checked)} />Als Entwurf erstellen</label>
          <button disabled={blocked || !title.trim() || !base.trim()} onClick={() => void prepare({ kind: 'pr', remote, base, title: title.trim(), body, draft })}>PR prüfen</button>
          <p>GitHub-Remote und angemeldetes gh am PC erforderlich. Den Branch zuerst pushen; Vorschau mit Zielbranch und Beschreibung prüfen.</p>
        </details>
      </>}
    </section>
  </details>;
}
