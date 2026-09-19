import { localizeAppMessage } from '../../shared/i18n/appMessages';
import { intlLocale } from '../../shared/i18n';
import { t as translate } from "../../shared/i18n";
import { useLocale } from "../i18n/language";
import { useEffect, useLayoutEffect, useRef, useState, type JSX } from 'react';
import type { GitSyncOverview, GitSyncPreview } from '../../shared/gitSync';
import './repository-sync.css';
import { IntegrationReview, type PendingIntegration } from './IntegrationReview';
import type { IntegrationQuery, IntegrationCommand } from '../../shared/remote';
import { useMode } from '../stores/mode';
import { useSelection } from '../stores/selection';

const integrationQuery = (input: IntegrationQuery) => window.ade.invoke('integration:query', input);
const integrationCommand = (input: IntegrationCommand) => window.ade.invoke('integration:command', input);
const integrationError = (error: unknown) => String(error).replace(/^Error: Error invoking remote method '[^']+':\s*/, '').slice(0, 1000);

export function RepositorySyncPanel({ repositoryId, onOpenWorkspace }: { repositoryId: string; onOpenWorkspace?: (id: string) => void }): JSX.Element {
  useLocale();
  const [integrationOpen, setIntegrationOpen] = useState(false);
  const [integrationPending, setIntegrationPending] = useState<PendingIntegration | null>(null);
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
  if (integrationOpen) return <IntegrationReview repositoryId={repositoryId} online canChange canTest query={integrationQuery} command={integrationCommand}
    pending={integrationPending} savePending={(value) => { setIntegrationPending(value); return true; }} errorText={integrationError} certainError={() => true}
    onBack={() => { setIntegrationOpen(false); requestAnimationFrame(() => document.querySelector<HTMLElement>('[data-open-integration]')?.focus()); }}
    onWorkspace={(id) => { if (onOpenWorkspace) onOpenWorkspace(id); else { useSelection.getState().setProjectWorkspace(id); useMode.getState().setMode('projects'); } }} />;
  return <div className="repo-sync" data-testid="repository-sync" aria-busy={busy}>
    <p>{translate("Compare the desired git base with the main repository and agent worktrees. “Check Update” is updated by fast-forward. You can check your own commits and local changes separately for adoption.")}</p>
    <div className="repo-sync-actions">
      <button type="button" className="btn" data-open-integration disabled={busy || overview?.executionBackend !== 'native'} onClick={() => setIntegrationOpen(true)}>{translate("Apply changes…")}</button>
      <button type="button" className="btn" ref={refresh} aria-disabled={busy} onClick={() => { if (!busy) void perform(() => load()); }}>{translate("Update the display")}</button>
      <button type="button" className="btn" disabled={busy} onClick={() => void perform(async () => {
        setPreview(null); setConfirmed(false);
        await window.ade.invoke('repository:fetch', { repositoryId });
        await load(); setMessage(translate("Remote branches checked. Work files have not been changed."));
      })}>{translate("Remotely check · Fetch")}</button>
    </div>
    {busy && <p role="status">{translate("Checking Git state…")}</p>}
    {error && <p className="repo-sync-error" role="alert">{localizeAppMessage(error)}</p>}
    {message && <p role="status">{message}</p>}
    {overview && <>
      <p className="repo-sync-meta">{overview.repositoryName} · {overview.executionBackend} {" "}{translate("· Remote")}{overview.remoteCheckedAt === null ? translate(": Not yet checked in this app session") : translate(" checked: {{value1}}", { value1: new Date(overview.remoteCheckedAt).toLocaleString(intlLocale()) })}</p>
      <label className="repo-sync-source">{translate("Desired Git base")}<select aria-label={translate("Desired Git base")} disabled={busy} value={overview.sourceRef}
          onChange={(event) => void perform(() => load(event.target.value))}>
          {overview.refs.map((ref) => <option key={ref.ref} value={ref.ref}>{ref.label}</option>)}
        </select><code>{overview.sourceSha.slice(0, 12)}</code>
      </label>
      <ul className="repo-sync-targets">
        {overview.targets.map((target) => <li key={target.id} data-sync-target={target.id}>
          <strong>{target.name}</strong> <span>{target.branch || 'Detached HEAD'}</span>
          {target.headSha ? <>
            <p><code>{target.headSha.slice(0, 12)}</code> · {target.changedFiles} {" "}{translate("Uncommitted files")}</p>
            <p>{target.ahead === 0 && target.behind === 0 ? translate("On the chosen git base") : translate("{{value1}} own commits · {{value2}} commits behind the selected base", { value1: target.ahead, value2: target.behind })}</p>
          </> : <p>{translate("Git state unknown")}</p>}
          {target.blockedReason && <p className="repo-sync-blocked">{localizeAppMessage(target.blockedReason)}</p>}
          <button type="button" className="btn" disabled={busy || Boolean(target.blockedReason) || target.behind === 0}
            aria-label={translate("Refresh {{value1}}", { value1: target.name })} onClick={() => void perform(async () => {
              setConfirmed(false);
              setPreview(await window.ade.invoke('repository:syncPreview', { repositoryId, sourceRef: overview.sourceRef, targetId: target.id }));
              focus.current = 'confirm';
            })}>{translate("Check update")}</button>
        </li>)}
      </ul>
      <p className="repo-sync-meta">{translate("New agent worktrees are created from the main repository on first launch. For a graph run, the orchestrator and participants must share the same base.")}</p>
    </>}
    {preview && <div className="repo-sync-preview" role="region" aria-label={translate("Confirm Git Update")}>
      <strong>{preview.target.name} · {preview.target.branch}</strong>
      <p>{preview.target.behind} {" "}{translate("Commits from")}{" "}{preview.overview.sourceRef.replace(/^refs\/(heads|remotes)\//, '')}</p>
      <p><code>{preview.target.headSha?.slice(0, 12)} → {preview.overview.sourceSha.slice(0, 12)}</code></p>
      <label><input ref={confirmation} type="checkbox" checked={confirmed} disabled={busy}
        onChange={(event) => setConfirmed(event.target.checked)} />{translate("Update this worktree to the displayed base")}</label>
      <div className="repo-sync-actions">
        <button type="button" className="btn primary" disabled={busy || !confirmed} onClick={() => void perform(async () => {
          setOverview(await window.ade.invoke('repository:syncApply', { previewId: preview.id }));
          setPreview(null); setConfirmed(false); focus.current = 'refresh';
          setMessage(translate("{{value1}} was updated by fast-forward.", { value1: preview.target.name }));
        })}>{translate("Execute fast-forward")}</button>
        <button type="button" className="btn" disabled={busy} onClick={() => { setPreview(null); setConfirmed(false); focus.current = 'refresh'; }}>{translate("Close preview")}</button>
      </div>
    </div>}
  </div>;
}
