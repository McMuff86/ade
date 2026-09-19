import { localizeAppMessage } from '../../shared/i18n/appMessages';
import { intlLocale } from '../../shared/i18n';
import { t as translate } from "../../shared/i18n";
import { useLocale } from "../i18n/language";
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
  useLocale();
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
    if (!savePending(request)) { setError(translate("Browser storage not available. Publication was not sent.")); return; }
    lock.current = true; setBusy(true); setError('');
    try {
      const result = await apply(request.preview.id, request.key); if (!live.current) return;
      if (!result.publication) throw new Error(translate("Publication confirmation missing. Check remote status."));
      setDone(result.publication);
      if (!savePending(null)) { setError(translate("Confirmation not saved. Check the same process again.")); return; }
      setPreview(undefined); setStatus(undefined); restore.current = true;
    } catch (reason) { if (live.current) setError(errorText(reason)); }
    finally { lock.current = false; if (live.current) setBusy(false); }
  };
  const blocked = !online || busy || !canPublish || !!pending || !remote;
  return <details className="project-publish" open={expanded} onToggle={(event) => setExpanded(event.currentTarget.open)}>
    <summary ref={summary}>{translate("Push and pull request")}</summary>
    <section aria-label={translate("Publish project")}>
      <p>{translate("Committing saves changes locally. Push uploads the selected branch; a pull request proposes merging it.")}</p>
      {!canPublish && <p role="status">{translate("On the PC, enable “Push project branches and create GitHub PRs”.")}</p>}
      {!online && <p role="status">{translate("Offline · Publication blocked.")}</p>}{busy && <p role="status">{translate("Checking publication…")}</p>}
      {error && <p role="alert">{localizeAppMessage(error)}</p>}
      <label>{translate("Publishing Remote")}<select aria-label={translate("Publishing Remote")} disabled={busy || !!current} value={remote} onChange={(event) => { setRemote(event.target.value); setStatus(undefined); }}>
        {local?.remotes.map((name) => <option key={name}>{name}</option>)}</select></label>
      {local && !local.remotes.length && <p>{translate("No remote configured. Add a remote to the PC first.")}</p>}
      <button disabled={busy || !online || !remote} onClick={() => void inspect()}>{translate("Check remote state")}</button>
      {status && <section aria-label={translate("Publication status")}><p>{status.target} · {status.branch}</p>
        <p>{translate("Local:")}{" "}{status.head.slice(0, 12)} {" "}{translate("· Remotely:")}{" "}{status.remoteHead?.slice(0, 12) ?? translate("Branch not yet available")}</p>
        <p>{status.remoteHead === status.head ? translate("This commit is on the remote.") : translate("Local and remote states differ.")}</p>
        {status.providerNotice && <p>{localizeAppMessage(status.providerNotice)}</p>}
        {status.pullRequests.map((pr) => <p key={pr.number}><a href={pr.url} target="_blank" rel="noopener noreferrer">{translate("PR #")}{pr.number}</a> → {pr.base}{pr.draft ? translate(" · Draft") : ''}</p>)}
      </section>}
      {done && <p role="status">{done.kind === 'push' ? translate("Push confirmed") : translate("Pull request confirmed")} {" "}{translate("For")}{" "}{done.branch} · {done.head.slice(0, 12)} · {new Date(done.confirmedAt).toLocaleString(intlLocale())}.
        {done.url && <> <a href={done.url} target="_blank" rel="noopener noreferrer">{translate("Open PR")}</a></>}</p>}
      {current ? <section className="project-branch-review" aria-label={translate("Publication Preview")}>
        <h3 ref={focus} tabIndex={-1}>{current.action.kind === 'push' ? translate("Push") : translate("Pull Request")} {" "}{translate("check")}</h3>
        <p>{current.status.target} · {current.status.branch}{current.action.kind === 'pr' ? ` → ${current.action.base}` : ''}</p>
        <p>{translate("Commit")}{" "}{current.status.head.slice(0, 12)} · {current.commitCount} {" "}{translate("Commits ·")}{" "}{current.changedFiles.length} {" "}{translate("Files")}</p>
        <p>{translate("Remote base:")}{" "}{current.baseHead?.slice(0, 12) ?? translate("New remote branch")}</p>
        {current.action.kind === 'pr' ? <><h4>{current.action.title}</h4><pre>{current.action.body}</pre><p>{current.action.draft ? translate("PR as draft") : translate("PR ready for review")}{translate("The branch is not additionally pushed.")}</p></>
          : <p>{translate("This branch will be released. Other branches and tags will remain unchanged; no force push.")}</p>}
        <ul>{current.changedFiles.map((path) => <li key={path}>{path}</li>)}</ul>
        {pending && <p role="status">{translate("Response not confirmed. Checking again uses the same operation; checking remote state reads the target.")}</p>}
        <button disabled={!online || busy || !canPublish} onClick={() => void execute()}>{pending ? translate("Check publication again") : current.action.kind === 'push' ? translate("Execute push") : translate("Create PR")}</button>
        <button disabled={busy} onClick={() => { if (savePending(null)) { setPreview(undefined); setError(''); restore.current = true; } }}>{pending ? translate("Discard preview after review") : translate("Cancel")}</button>
      </section> : <>
        <button disabled={blocked} onClick={() => void prepare({ kind: 'push', remote })}>{translate("Review push")}</button>
        <details><summary>{translate("Prepare GitHub pull request")}</summary>
          <label>{translate("Target PR branch")}<input aria-label={translate("Target PR branch")} value={base} maxLength={200} onChange={(event) => setBase(event.target.value)} /></label>
          <label>{translate("PR title")}<input aria-label={translate("PR title")} value={title} maxLength={160} onChange={(event) => setTitle(event.target.value)} /></label>
          <label>{translate("PR Description")}<textarea aria-label={translate("PR Description")} value={body} rows={4} maxLength={8000} onChange={(event) => setBody(event.target.value)} /></label>
          <label><input type="checkbox" checked={draft} onChange={(event) => setDraft(event.target.checked)} />{translate("Create as a draft")}</label>
          <button disabled={blocked || !title.trim() || !base.trim()} onClick={() => void prepare({ kind: 'pr', remote, base, title: title.trim(), body, draft })}>{translate("Review PR")}</button>
          <p>{translate("GitHub remote and logged in gh on PC required. Push the branch first; preview with target branch and check description.")}</p>
        </details>
      </>}
    </section>
  </details>;
}
