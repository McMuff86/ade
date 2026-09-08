import { useEffect, useLayoutEffect, useRef, useState, type JSX } from 'react';
import type { GitSyncOverview, GitSyncPreview } from '../../shared/gitSync';
import './repository-sync.css';

export function RepositorySyncPanel({ repositoryId }: { repositoryId: string }): JSX.Element {
  const [overview, setOverview] = useState<GitSyncOverview | null>(null);
  const [preview, setPreview] = useState<GitSyncPreview | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const generation = useRef(0);
  const locked = useRef(false);
  const refresh = useRef<HTMLButtonElement>(null);
  const confirmation = useRef<HTMLInputElement>(null);
  const focus = useRef<'confirm' | 'refresh' | null>(null);
  useLayoutEffect(() => {
    if (busy || !focus.current) return;
    (focus.current === 'confirm' ? confirmation.current : refresh.current)?.focus();
    focus.current = null;
  }, [busy, preview]);

  const perform = async (action: () => Promise<void>): Promise<void> => {
    if (locked.current) return;
    locked.current = true;
    setBusy(true); setError(''); setMessage('');
    try { await action(); }
    catch (cause) {
      setPreview(null); setConfirmed(false);
      setError((cause instanceof Error ? cause.message : String(cause)).replace(/^Error invoking remote method '[^']+':\s*/, '').slice(0, 1000));
      focus.current = 'refresh';
    } finally { locked.current = false; setBusy(false); }
  };
  useEffect(() => {
    const token = ++generation.current;
    setOverview(null); setPreview(null); setConfirmed(false); setError(''); setMessage(''); setBusy(true);
    void window.ade.invoke('repository:syncOverview', { repositoryId }).then((result) => {
      if (generation.current === token) setOverview(result);
    }).catch((cause) => {
      if (generation.current === token) setError(String(cause).slice(0, 1000));
    }).finally(() => { if (generation.current === token) setBusy(false); });
    return () => { generation.current++; };
  }, [repositoryId]);

  const load = async (sourceRef = overview?.sourceRef): Promise<void> => {
    setPreview(null); setConfirmed(false);
    setOverview(await window.ade.invoke('repository:syncOverview', { repositoryId, ...(sourceRef ? { sourceRef } : {}) }));
  };
  return <div className="repo-sync" data-testid="repository-sync" aria-busy={busy}>
    <p>Vergleiche die gewünschte Git-Basis mit Hauptrepository und Agent-Worktrees. Übernommen werden ausschliesslich Commits; uncommittete Dateien bleiben im jeweiligen Arbeitsordner.</p>
    <div className="repo-sync-actions">
      <button type="button" className="btn" ref={refresh} aria-disabled={busy} onClick={() => { if (!busy) void perform(() => load()); }}>Anzeige aktualisieren</button>
      <button type="button" className="btn" disabled={busy} onClick={() => void perform(async () => {
        setPreview(null); setConfirmed(false);
        await window.ade.invoke('repository:fetch', { repositoryId });
        await load(); setMessage('Remote-Branches geprüft. Arbeitsdateien wurden dabei nicht geändert.');
      })}>Remote prüfen · Fetch</button>
    </div>
    {busy && <p role="status">Git-Stand wird geprüft…</p>}
    {error && <p className="repo-sync-error" role="alert">{error}</p>}
    {message && <p role="status">{message}</p>}
    {overview && <>
      <p className="repo-sync-meta">{overview.repositoryName} · {overview.executionBackend} · Remote
        {overview.remoteCheckedAt === null ? ': in dieser App-Sitzung noch nicht geprüft' : ` geprüft: ${new Date(overview.remoteCheckedAt).toLocaleString()}`}</p>
      <label className="repo-sync-source">Gewünschte Git-Basis
        <select aria-label="Gewünschte Git-Basis" disabled={busy} value={overview.sourceRef}
          onChange={(event) => void perform(() => load(event.target.value))}>
          {overview.refs.map((ref) => <option key={ref.ref} value={ref.ref}>{ref.label}</option>)}
        </select><code>{overview.sourceSha.slice(0, 12)}</code>
      </label>
      <ul className="repo-sync-targets">
        {overview.targets.map((target) => <li key={target.id} data-sync-target={target.id}>
          <strong>{target.name}</strong> <span>{target.branch || 'Detached HEAD'}</span>
          {target.headSha ? <>
            <p><code>{target.headSha.slice(0, 12)}</code> · {target.changedFiles} uncommittierte Dateien</p>
            <p>{target.ahead === 0 && target.behind === 0 ? 'Auf der gewählten Git-Basis' : `${target.ahead} eigene Commits · ${target.behind} Commits hinter der gewählten Basis`}</p>
          </> : <p>Git-Stand unbekannt</p>}
          {target.blockedReason && <p className="repo-sync-blocked">{target.blockedReason}</p>}
          <button type="button" className="btn" disabled={busy || Boolean(target.blockedReason) || target.behind === 0}
            aria-label={`${target.name} aktualisieren`} onClick={() => void perform(async () => {
              setConfirmed(false);
              setPreview(await window.ade.invoke('repository:syncPreview', { repositoryId, sourceRef: overview.sourceRef, targetId: target.id }));
              focus.current = 'confirm';
            })}>Update prüfen</button>
        </li>)}
      </ul>
      <p className="repo-sync-meta">Neue Agent-Worktrees werden beim ersten Start aus dem Hauptrepository angelegt. Für einen Graph-Run müssen Orchestrator und Teilnehmer auf derselben Basis stehen.</p>
    </>}
    {preview && <div className="repo-sync-preview" role="region" aria-label="Git-Update bestätigen">
      <strong>{preview.target.name} · {preview.target.branch}</strong>
      <p>{preview.target.behind} Commits aus {preview.overview.sourceRef.replace(/^refs\/(heads|remotes)\//, '')}</p>
      <p><code>{preview.target.headSha?.slice(0, 12)} → {preview.overview.sourceSha.slice(0, 12)}</code></p>
      <label><input ref={confirmation} type="checkbox" checked={confirmed} disabled={busy}
        onChange={(event) => setConfirmed(event.target.checked)} />Diesen Worktree auf die angezeigte Basis aktualisieren</label>
      <div className="repo-sync-actions">
        <button type="button" className="btn primary" disabled={busy || !confirmed} onClick={() => void perform(async () => {
          setOverview(await window.ade.invoke('repository:syncApply', { previewId: preview.id }));
          setPreview(null); setConfirmed(false); focus.current = 'refresh';
          setMessage(`${preview.target.name} wurde per Fast-forward aktualisiert.`);
        })}>Fast-forward ausführen</button>
        <button type="button" className="btn" disabled={busy} onClick={() => { setPreview(null); setConfirmed(false); focus.current = 'refresh'; }}>Vorschau schliessen</button>
      </div>
    </div>}
  </div>;
}
