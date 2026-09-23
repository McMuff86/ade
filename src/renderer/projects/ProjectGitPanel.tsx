import { localizeAppMessage } from '../../shared/i18n/appMessages';
import { intlLocale } from '../../shared/i18n';
import { t as translate } from "../../shared/i18n";
import { localizedLabels } from "../../shared/i18n/labels";
import { useLocale } from "../i18n/language";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { MobileFileSaveInput, MobileFileSaveResult, MobileWorkspaceResult, ProjectGitAction, ProjectGitDiff, ProjectGitOverview, ProjectGitPreview, ProjectWorkspaceQuery, ProjectWorkspaceQueryResult, ProjectWorkspaceView } from '../../shared/remote';

export interface PendingProjectGit { key: string; preview: ProjectGitPreview }
export interface PendingProjectFile { key: string; input: MobileFileSaveInput }
export interface ProjectGitPanelProps {
  workspace: ProjectWorkspaceView; online: boolean; canChange: boolean; canEdit: boolean;
  query: (query: ProjectWorkspaceQuery) => Promise<ProjectWorkspaceQueryResult>;
  apply: (id: string, key: string) => Promise<ProjectGitOverview>;
  readFile: (path: string) => Promise<MobileWorkspaceResult>;
  saveFile: (input: MobileFileSaveInput, key: string) => Promise<MobileFileSaveResult>;
  errorText: (error: unknown) => string; onWorkspace: (workspace: ProjectWorkspaceView) => void;
  pending: PendingProjectGit | null; savePending: (value: PendingProjectGit | null) => boolean;
  filePending: PendingProjectFile | null; saveFilePending: (value: PendingProjectFile | null) => boolean;
}
const labels: Record<ProjectGitAction['kind'], string> = localizedLabels(() => ({ commit: translate("Create commit"), fetch: translate("Fetch remote state"), pull: translate("Apply fast-forward"), merge: translate("Prepare merge"), resolve: translate("Mark conflicts as resolved"), continue: translate("Create merge commit"), abort: translate("Cancel merge") }));

export function ProjectGitPanel(props: ProjectGitPanelProps) {
  useLocale();
  const { workspace, online, canChange, canEdit, query, apply, readFile, saveFile, errorText, pending, savePending, filePending, saveFilePending } = props;
  const [state, setState] = useState<ProjectGitOverview>(); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const [selected, setSelected] = useState<string[]>([]); const [message, setMessage] = useState(''); const [ref, setRef] = useState(''); const [remote, setRemote] = useState('origin'); const [pullRef, setPullRef] = useState('');
  const [preview, setPreview] = useState<ProjectGitPreview>(); const [diff, setDiff] = useState<ProjectGitDiff>();
  const [filePath, setFilePath] = useState(filePending?.input.path ?? ''); const [file, setFile] = useState<MobileWorkspaceResult>(); const [text, setText] = useState(filePending?.input.text ?? '');
  const live = useRef(true); const lock = useRef(false); const focus = useRef<HTMLHeadingElement>(null); const heading = useRef<HTMLHeadingElement>(null);
  const opener = useRef<HTMLElement | null>(null); const restore = useRef(false); const onWorkspace = useRef(props.onWorkspace); onWorkspace.current = props.onWorkspace;
  const attemptedFile = useRef('');
  const editor = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (file?.file) editor.current?.focus(); }, [file?.file?.path]);
  const current = pending?.preview ?? preview;
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  useLayoutEffect(() => { if (current) focus.current?.focus(); else if (restore.current) { restore.current = false; (opener.current?.isConnected ? opener.current : heading.current)?.focus(); } }, [current]);
  const load = useCallback(async (clearError = true) => {
    if (!online || lock.current) return; lock.current = true; setBusy(true); if (clearError) setError('');
    try {
      const next = (await query({ operation: 'git', workspaceId: workspace.id })).git;
      if (!live.current || !next) return; setState(next);
      setSelected((value) => value.filter((path) => next.files.some((file) => file.path === path && file.selectable)));
      setRef((value) => next.refs.some((item) => item.ref === value) ? value : next.refs.find((item) => item.ref !== `refs/heads/${next.workspace.branch}`)?.ref ?? '');
      setRemote((value) => next.remotes.includes(value) ? value : next.remotes[0] ?? '');
      if (next.workspace.branch !== workspace.branch) onWorkspace.current(next.workspace);
    } catch (reason) { if (live.current) setError(errorText(reason)); }
    finally { lock.current = false; if (live.current) setBusy(false); }
  }, [online, query, workspace.id, workspace.branch, errorText]);
  useEffect(() => { void load(); }, [load]);
  const pullRefs = state?.refs.filter((item) => item.ref.startsWith(`refs/remotes/${remote}/`)) ?? [];
  const selectedPull = pullRefs.some((item) => item.ref === pullRef) ? pullRef : pullRefs.find((item) => item.ref === `refs/remotes/${remote}/${workspace.branch}`)?.ref ?? pullRefs[0]?.ref ?? '';
  const prepare = async (action: ProjectGitAction) => {
    if (lock.current || !online || !canChange || pending) return; lock.current = true; setBusy(true); setError(''); setNotice(''); opener.current = document.activeElement as HTMLElement;
    try { const result = await query({ operation: 'git-preview', workspaceId: workspace.id, action }); if (live.current) setPreview(result.gitPreview); }
    catch (reason) { if (live.current) setError(errorText(reason)); }
    finally { lock.current = false; if (live.current) setBusy(false); }
  };
  const execute = async () => {
    if (!current || lock.current || !online || !canChange) return;
    const command = pending ?? { key: crypto.randomUUID(), preview: current };
    if (!savePending(command)) { setError(translate("Browser storage not available. Git action was not sent.")); return; }
    lock.current = true; setBusy(true); setError('');
    try {
      const next = await apply(command.preview.id, command.key); if (!live.current) return;
      if (!savePending(null)) { setError(translate("Action executed; confirmation not saved. Check again.")); return; }
      setPreview(undefined); setState(next); setSelected([]); setDiff(undefined); setNotice(next.merge ? translate("Merge is open. Resolve conflicts and expressly create or cancel merge commit.") : translate("Git action confirmed. Current status has been read."));
      if (command.preview.action.kind === 'commit') setMessage(''); onWorkspace.current(next.workspace); restore.current = true;
    } catch (reason) { if (live.current) setError(errorText(reason)); }
    finally { lock.current = false; if (live.current) setBusy(false); }
  };
  const openFile = async (path: string, editing: boolean) => {
    if (lock.current || !online || filePending && filePending.input.path !== path) return; lock.current = true; setBusy(true); setError('');
    try {
      if (editing) { const value = await readFile(path); if (live.current) { setFilePath(path); setFile(value); setText(filePending?.input.text ?? value.file?.text ?? ''); setDiff(undefined); } }
      else { const value = await query({ operation: 'git-diff', workspaceId: workspace.id, path }); if (live.current) { setDiff(value.gitDiff); setFilePath(''); setFile(undefined); } }
    } catch (reason) { if (live.current) setError(errorText(reason)); }
    finally { lock.current = false; if (live.current) setBusy(false); }
  };
  useEffect(() => { if (filePending && state && !file && online && !busy && !lock.current && attemptedFile.current !== filePending.key) {
    attemptedFile.current = filePending.key; void openFile(filePending.input.path, true);
  } }, [filePending, online, busy, file, state]);
  const save = async () => {
    if (lock.current || !online || !canEdit || !file?.file || !file.file.editable || !state || state.blockedReason) return;
    const command = filePending ?? { key: crypto.randomUUID(), input: { projectWorkspaceId: workspace.id, path: filePath, text, revision: file.file.revision, workspaceVersion: file.workspaceVersion } };
    if (!saveFilePending(command)) { setError(translate("Browser storage not available. File was not sent.")); return; }
    lock.current = true; setBusy(true); setError('');
    try {
      const result = await saveFile(command.input, command.key); if (!live.current) return;
      if (!saveFilePending(null)) { setError(translate("Save confirmation is missing. Check again.")); return; }
      if (!result.saved) { setError(translate("File has since been changed. Copy draft and reload file; nothing has been overwritten.")); return; }
      setFile(undefined); setFilePath(''); setNotice(translate("File saved. Conflict resolution if necessary still expressly mark."));
    } catch (reason) { if (live.current) setError(errorText(reason)); }
    finally { lock.current = false; if (live.current) { setBusy(false); void load(false); } }
  };
  const blocked = busy || !online || !canChange || !!state?.blockedReason || !!pending || !!filePending || !!filePath;
  return <section className="project-git" aria-label={translate("Project Git")}>
    <div className="project-workspace-actions"><h2 ref={heading} tabIndex={-1}>{translate("Git ·")}{" "}{state?.workspace.branch ?? workspace.branch}</h2><button disabled={busy || !online} onClick={() => void load()}>{translate("Refresh Git")}</button></div>
    {!online && <p role="status">{translate("Offline · last known git state. Actions are blocked.")}</p>}
    {!canChange && <p role="status">{translate("On the PC, enable “Manage project branches and local Git operations” and project workspace access.")}</p>}
    {busy && <p role="status">{translate("Checking Git status…")}</p>}{error && <p role="alert">{localizeAppMessage(error)}</p>}{notice && <p role="status">{localizeAppMessage(notice)}</p>}
    {state?.blockedReason && <p role="status">{localizeAppMessage(state.blockedReason)}</p>}
    {filePending && !file && <button disabled={busy || !online} onClick={() => void openFile(filePending.input.path, true)}>{translate("Check pending file save")}</button>}
    {current ? <section className="project-branch-review" aria-label={translate("Git Preview")}>
      <h3 ref={focus} tabIndex={-1}>{labels[current.action.kind]}{" "}{translate("check")}</h3><p>{current.projectName}{" "}{translate("· Branch")}{" "}{current.branch}</p>
      <p>{translate("HEAD")}{" "}{current.head?.slice(0, 12) ?? translate("no commit")}{current.targetHead ? ` → ${current.targetHead.slice(0, 12)}` : ''}</p>
      {'remote' in current.action && <p>{translate("Remote:")}{" "}{current.action.remote}</p>}{'ref' in current.action && <p>{translate("Source:")}{" "}{current.action.ref}</p>}
      {current.action.kind === 'commit' && <><pre>{current.action.message}</pre><p>{translate("Only the selected files will be staged and committed in their current working state. Other staged files are preserved.")}</p></>}
      {current.action.kind === 'abort' && <p>{translate("Cancel discards the current merge resolution and restores the status before the merge.")}</p>}
      {current.action.kind === 'merge' && <p>{translate("The merge remains open for review and then expressly create the merge commit.")}</p>}
      <ul>{current.affected.map((path) => <li key={path}>{path}</li>)}</ul>
      {pending && <p role="status">{translate("Response not yet confirmed. Checking again uses the same operation.")}</p>}
      <div className="project-workspace-actions"><button disabled={busy || !online || !canChange} onClick={() => void execute()}>{pending ? translate("Check Git action again") : translate("Execute Git operation")}</button>
        <button disabled={busy} onClick={() => { if (!savePending(null)) return; restore.current = true; setPreview(undefined); setError(''); void load(); }}>{pending ? translate("Read status and discard preview") : translate("Cancel")}</button></div>
    </section> : state && <>
      <p>{state.files.length ? translate("{{value1}} modified files", { value1: state.files.length }) : translate("Working tree clean")}{" "}{translate("· HEAD")}{" "}{state.head?.slice(0, 12) ?? translate("no commit")}</p>
      <details className="project-git-history"><summary>{translate("Last 5 Commits")}</summary>
        {state.recentCommits.length ? <ol aria-label={translate("Recent commits")}>{state.recentCommits.map((commit) => <li key={commit.sha}>
          <strong>{commit.subject || translate("No commit message")}</strong>
          <span><code title={commit.sha}>{commit.sha.slice(0, 12)}</code> · {commit.author || translate("Unknown author")} · <time dateTime={commit.authoredAt}>{new Date(commit.authoredAt).toLocaleString(intlLocale())}</time></span>
        </li>)}</ol> : <p>{translate("No commits in this branch yet.")}</p>}
      </details>
      <section aria-label={translate("Next Git step")}>
        <h3>{state.merge ? translate("Complete merge") : state.files.length ? translate("Secure local changes") : translate("Sync project state")}</h3>
        <p>{state.merge ? translate("Address conflicts and mark them as resolved, then check the merge commit.")
          : state.files.length ? translate("Select files and commit. After that, you can take over the GitHub state or push your branch.")
            : translate("Run Fetch first, then take the remote branch by fast-forward, and use Merge for separate developments.")}</p>
        <p>{translate("Work objective:")}{" "}<strong>{state.workspace.branch}</strong> · {state.workspace.name}</p>
      </section>
      {state.merge && <p role="status">{translate("Merge pending ·")}{" "}{state.files.filter((file) => file.conflict).length}{" "}{translate("Conflict files")}</p>}
      {!!state.files.length && <div className="project-workspace-actions">
        <button disabled={blocked} onClick={() => setSelected(state.files.filter((file) => file.selectable && (!state.merge || file.conflict)).map((file) => file.path))}>{translate("Mark selectable files")}</button>
        <button disabled={blocked || !selected.length} onClick={() => setSelected([])}>{translate("Clear selection")}</button><span>{selected.length}{" "}{translate("Files selected")}</span>
      </div>}
      <ul className="project-git-files">{state.files.map((file) => <li key={file.path}>
        <label><input type="checkbox" disabled={busy || !file.selectable || !!pending} checked={selected.includes(file.path)} onChange={(event) => setSelected((value) => event.target.checked ? [...value, file.path] : value.filter((path) => path !== file.path))} />{file.path}</label>
        <span>{file.conflict ? translate("Conflict") : `${file.index}${file.working}`}</span>
        <button aria-label={translate("Show diff: {{value1}}", { value1: file.path })} disabled={busy || !online || !file.selectable || !!filePending || !!filePath} onClick={() => void openFile(file.path, false)}>{translate("Diff")}</button>
        <button aria-label={translate("Edit file: {{value1}}", { value1: file.path })} disabled={busy || !online || !file.selectable || !!filePending || !!filePath} onClick={() => void openFile(file.path, true)}>{translate("Open the file")}</button>
        {file.notice && <p>{localizeAppMessage(file.notice)}</p>}
      </li>)}</ul>
      {!state.merge ? <form onSubmit={(event) => { event.preventDefault(); void prepare({ kind: 'commit', paths: selected, message }); }}>
        <label>{translate("Commit message")}<textarea aria-label={translate("Commit message")} value={message} onChange={(event) => setMessage(event.target.value)} maxLength={2000} rows={2} disabled={busy} /></label>
        <button disabled={blocked || !selected.length || !message.trim()}>{translate("Review commit")}</button>
      </form> : <div className="project-workspace-actions">
        <button disabled={blocked || !selected.length || selected.some((path) => !state.files.find((file) => file.path === path)?.conflict)} onClick={() => void prepare({ kind: 'resolve', paths: selected })}>{translate("Review marking as resolved")}</button>
        <button disabled={blocked || state.files.some((file) => file.conflict)} onClick={() => void prepare({ kind: 'continue' })}>{translate("Review merge completion")}</button>
        <button disabled={blocked} onClick={() => void prepare({ kind: 'abort' })}>{translate("Review merge cancellation")}</button>
      </div>}
      {diff && <section aria-label={translate("Git diff")}><h3>{diff.path}</h3><pre tabIndex={0}>{diff.text || translate("There is no text diff.")}</pre>{diff.limited && <p>{translate("Output truncated.")}</p>}</section>}
      {file?.file && <section className="project-git-editor" aria-label={translate("Git file")}><h3>{filePath}</h3><label>{translate("File content")}<textarea ref={editor} aria-label={translate("Git file content")} value={text} maxLength={24 * 1024} rows={12}
        readOnly={!file.file.editable || !canEdit || !!filePending} disabled={busy} onChange={(event) => setText(event.target.value)} /></label>
        {file.file.notice && <p>{localizeAppMessage(file.file.notice)}</p>}{!canEdit && <p>{translate("To save, enable “Edit small workspace text files” on the PC.")}</p>}
        <button disabled={busy || !online || !canEdit || !file.file.editable || !!state.blockedReason} onClick={() => void save()}>{filePending ? translate("Check file storage again") : translate("Save file")}</button>
        <button disabled={busy} onClick={() => { if (!saveFilePending(null)) return; setFile(undefined); setFilePath(''); }}>{translate("Close editor · discard draft")}</button>
        <p>{translate("Unstored text remains only on this page; a sent, unconfirmed storage remains until checked.")}</p>
      </section>}
      {!state.merge && <details><summary>{translate("Merge branches and remote state")}</summary>
        {!!state.files.length && <p role="status">{translate("Merge and Fast-forward wait until the local changes are committed. Fetch is already possible.")}</p>}
        <label>{translate("Source branch")}<select aria-label={translate("Git source branch")} value={ref} onChange={(event) => setRef(event.target.value)}>{state.refs.filter((item) => item.ref !== `refs/heads/${workspace.branch}`).map((item) => <option key={item.ref} value={item.ref}>{item.ref.replace(/^refs\/(heads|remotes)\//, '')}</option>)}</select></label>
        <button disabled={blocked || !ref || !!state.files.length} onClick={() => void prepare({ kind: 'merge', ref })}>{translate("Review merge")}</button>
        {ref && <p>{translate("Merge from")}{" "}<strong>{ref.replace(/^refs\/(heads|remotes)\//, '')}</strong> {" "}{translate("in")}{" "}<strong>{state.workspace.branch}</strong>{translate("The source branch is retained.")}</p>}
        {state.remotes.length ? <><label>{translate("Remote")}<select aria-label={translate("Git-Remote")} value={remote} onChange={(event) => setRemote(event.target.value)}>{state.remotes.map((name) => <option key={name}>{name}</option>)}</select></label>
          <button disabled={blocked || !remote} onClick={() => void prepare({ kind: 'fetch', remote })}>{translate("Review fetch")}</button>
          <label>{translate("Pull branch")}<select aria-label={translate("Pull branch")} value={selectedPull} onChange={(event) => setPullRef(event.target.value)}>{pullRefs.map((item) => <option key={item.ref} value={item.ref}>{item.ref.slice(13)}</option>)}</select></label>
          <button disabled={blocked || !selectedPull || !!state.files.length} onClick={() => void prepare({ kind: 'pull', remote, ref: selectedPull })}>{translate("Check fast forward")}</button>
          <p>{translate("Remote branches show the latest fetched state. Fetch updates them; Fast-forward takes over the then tested commit.")}</p>
          <p>{translate("Last Fetch in ADE:")}{" "}{state.fetchedAt ? new Date(state.fetchedAt).toLocaleString(intlLocale()) : translate("Not fetched yet")}{translate(". Refreshing the Git display alone does not fetch anything from GitHub.")}</p>
        </> : <p>{translate("No remote configured yet. Add a remote on the PC.")}</p>}
      </details>}
    </>}
  </section>;
}
