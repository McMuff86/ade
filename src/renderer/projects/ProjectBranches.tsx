import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ProjectBranchAction, ProjectBranchOverview, ProjectBranchPreview } from '../../shared/projectBranches';
import type { ProjectWorkspaceQuery, ProjectWorkspaceQueryResult, ProjectWorkspaceView } from '../../shared/remote';

export interface PendingBranch { preview: ProjectBranchPreview; key: string }
export interface ProjectBranchesProps {
  workspace: ProjectWorkspaceView; online: boolean; canChange: boolean;
  query: (input: ProjectWorkspaceQuery) => Promise<ProjectWorkspaceQueryResult>;
  apply: (previewId: string, key: string) => Promise<ProjectWorkspaceView>;
  onWorkspace: (workspace: ProjectWorkspaceView) => void;
  pending: PendingBranch | null; savePending: (value: PendingBranch | null) => boolean;
  errorText: (error: unknown) => string;
}

/** Shared branch UI. The host owns Git commands, previews and checkout identities. */
export function ProjectBranches({ workspace, online, canChange, query, apply, onWorkspace, pending, savePending, errorText }: ProjectBranchesProps) {
  const [opened, setOpened] = useState(!!pending); const [overview, setOverview] = useState<ProjectBranchOverview>();
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const [ref, setRef] = useState(''); const [name, setName] = useState(''); const [separate, setSeparate] = useState(true);
  const [preview, setPreview] = useState<ProjectBranchPreview>(); const [checking, setChecking] = useState(0);
  const live = useRef(true); const lock = useRef(false); const review = useRef<HTMLHeadingElement>(null); const opener = useRef<HTMLElement | null>(null);
  const summary = useRef<HTMLElement>(null); const restoringFocus = useRef(false);
  const current = pending?.preview ?? preview;
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  useLayoutEffect(() => { if (current) review.current?.focus(); else if (restoringFocus.current) {
    restoringFocus.current = false; (opener.current?.isConnected ? opener.current : summary.current)?.focus();
  } }, [current]);
  useEffect(() => {
    if (!opened || !online) return; let stopped = false;
    setBusy(true); setError(''); setOverview(undefined);
    void query({ operation: 'branches', workspaceId: workspace.id }).then((result) => {
      if (stopped || !result.branches) return;
      setOverview(result.branches); setRef(result.branches.branches.find((branch) => branch.current)?.ref ?? result.branches.branches[0]?.ref ?? '');
    }).catch((reason) => { if (!stopped) setError(errorText(reason)); }).finally(() => { if (!stopped) setBusy(false); });
    return () => { stopped = true; };
  }, [opened, online, query, workspace.id, workspace.branch, checking, errorText]);
  const prepare = useCallback(async (action: ProjectBranchAction) => {
    if (lock.current || !online || !canChange || pending) return;
    opener.current = document.activeElement as HTMLElement; lock.current = true; setBusy(true); setError('');
    try { const result = await query({ operation: 'branch-preview', workspaceId: workspace.id, action }); if (live.current) setPreview(result.preview); }
    catch (reason) { if (live.current) setError(errorText(reason)); }
    finally { lock.current = false; if (live.current) setBusy(false); }
  }, [online, canChange, pending, query, workspace.id, errorText]);
  const execute = async () => {
    if (!current || lock.current || !online || !canChange) return;
    const command = pending ?? { preview: current, key: crypto.randomUUID() };
    if (!savePending(command)) { setError('Browser-Speicher nicht verfügbar. Branch-Aktion wurde nicht gesendet.'); return; }
    lock.current = true; setBusy(true); setError('');
    try {
      const next = await apply(command.preview.id, command.key);
      if (!live.current) return;
      if (!savePending(null)) { setError('Branch geändert; Bestätigung konnte nicht gespeichert werden. Mit derselben Aktion erneut prüfen.'); return; }
      setPreview(undefined); setChecking((value) => value + 1); onWorkspace(next);
    } catch (reason) { if (live.current) setError(errorText(reason)); }
    finally { lock.current = false; if (live.current) setBusy(false); }
  };
  const discard = () => { if (!savePending(null)) return; restoringFocus.current = true; setPreview(undefined); setError(''); if (pending) setChecking((value) => value + 1); };
  return <details className="project-branches" open={opened} onToggle={(event) => setOpened(event.currentTarget.open)}>
    <summary ref={summary}>Branches · {workspace.branch}</summary>
    {!online && <p role="status">PC nicht verbunden. Branch-Aktionen sind gesperrt.</p>}
    {online && !canChange && <p role="status">Zum Wechseln am PC die Gerätefreigaben für Projekt-Workspaces und Projekt-Branches aktivieren.</p>}
    {error && <p role="alert">{error}</p>}{busy && <p role="status">Branch-Zustand wird geprüft…</p>}
    <button disabled={busy || !online} onClick={() => setChecking((value) => value + 1)}>Branches aktualisieren</button>
    {current ? <section className="project-branch-review" aria-label="Branch-Vorschau">
      <h3 ref={review} tabIndex={-1}>Branch-Aktion prüfen</h3>
      <p>{current.projectName}: <strong>{current.fromBranch}</strong> → <strong>{current.toBranch}</strong></p>
      <p>{current.action.kind === 'open-worktree' ? 'Die vorhandene Arbeitskopie wird geöffnet.' : current.separate ? 'Eine zusätzliche Arbeitskopie mit neuem Branch wird angelegt.' : 'Der Branch in diesem Workspace wird gewechselt.'}</p>
      {pending && <p role="status">Antwort noch unklar. Erneut prüfen verwendet denselben Vorgang.</p>}
      <div className="project-workspace-actions"><button disabled={busy || !online || !canChange} onClick={() => void execute()}>{pending ? 'Branch-Aktion erneut prüfen' : 'Branch-Aktion ausführen'}</button>
        <button disabled={busy} onClick={discard}>{pending ? 'Stand prüfen und Vorschau verwerfen' : 'Abbrechen'}</button></div>
    </section> : overview && <>
      <p>Aktuell: <strong>{overview.workspace.branch}</strong> · {overview.dirty ? 'Lokale Änderungen vorhanden' : 'Arbeitsverzeichnis sauber'}</p>
      {overview.blockedReason && <p role="status">{overview.blockedReason}</p>}
      <label>Branch oder Basis<select aria-label="Projekt-Branch" disabled={busy} value={ref} onChange={(event) => setRef(event.target.value)}>
        {!overview.branches.length && <option value="">Noch kein Commit</option>}
        {overview.branches.map((branch) => <option key={branch.ref} value={branch.ref}>{branch.name}{branch.kind === 'remote' ? ' · Remote' : ''}{branch.current ? ' · aktuell' : ''}{branch.worktreeId && !branch.current ? ' · in Arbeitskopie' : ''}</option>)}
      </select></label>
      <button disabled={busy || !online || !canChange || !ref || overview.branches.find((branch) => branch.ref === ref)?.current || !!overview.blockedReason}
        onClick={() => void prepare({ kind: 'switch', ref })}>Branch wechseln</button>
      <fieldset disabled={busy || !online || !canChange}><legend>Neuer Branch</legend>
        <label>Branch-Name<input aria-label="Neuer Branch-Name" value={name} maxLength={200} onChange={(event) => setName(event.target.value)} placeholder="feature/meine-idee" /></label>
        <label className="project-checkbox"><input type="checkbox" checked={separate} onChange={(event) => setSeparate(event.target.checked)} />Zusätzliche Arbeitskopie anlegen</label>
        <p>Die Basis ist der oben gewählte Commit-Stand. Ungesicherte Änderungen bleiben im bisherigen Workspace.</p>
        <button disabled={!name.trim() || !separate && !!overview.blockedReason} onClick={() => void prepare({ kind: 'create', name: name.trim(), baseRef: ref || null, separate })}>Branch anlegen</button>
      </fieldset>
      <details><summary>Vorhandene Arbeitskopien ({overview.worktrees.length})</summary>
        <ul>{overview.worktrees.map((worktree) => <li key={worktree.id}><span>{worktree.name} · {worktree.branch}{worktree.current ? ' · aktuell' : ''}</span>
          {worktree.notice && <p>{worktree.notice}</p>}<button disabled={busy || !online || !canChange || worktree.current || !worktree.available}
            onClick={() => void prepare({ kind: 'open-worktree', worktreeId: worktree.id })}>Arbeitskopie öffnen: {worktree.branch}</button></li>)}</ul>
      </details><p>Remote-Branches zeigen den zuletzt gefetchten Stand.</p>
    </>}
  </details>;
}
