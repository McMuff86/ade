import { localizeAppMessage } from '../../shared/i18n/appMessages';
import { t as translate } from "../../shared/i18n";
import { useLocale } from "../i18n/language";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ProjectBranchAction, ProjectBranchOverview, ProjectBranchPreview } from '../../shared/projectBranches';
import { validProjectBranchName } from '../../shared/projectBranches';
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
  useLocale();
  const [opened, setOpened] = useState(!!pending); const [overview, setOverview] = useState<ProjectBranchOverview>();
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const [ref, setRef] = useState(''); const [name, setName] = useState(''); const [separate, setSeparate] = useState(true);
  const [preview, setPreview] = useState<ProjectBranchPreview>(); const [checking, setChecking] = useState(0);
  const live = useRef(true); const lock = useRef(false); const review = useRef<HTMLHeadingElement>(null); const opener = useRef<HTMLElement | null>(null);
  const summary = useRef<HTMLElement>(null); const restoringFocus = useRef(false);
  const current = pending?.preview ?? preview;
  const branchNameError = !name.trim() ? '' : !validProjectBranchName(name.trim()) ? translate("Invalid branch name. Use a name such as feature/my-idea.")
    : overview?.branches.some((branch) => branch.kind === 'local' && branch.name === name.trim()) ? translate("This local branch already exists. Select and switch top.") : '';
  const basis = overview?.branches.find((branch) => branch.ref === ref);
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
    if (!savePending(command)) { setError(translate("Browser storage not available. Branch action was not sent.")); return; }
    lock.current = true; setBusy(true); setError('');
    try {
      const next = await apply(command.preview.id, command.key);
      if (!live.current) return;
      if (!savePending(null)) { setError(translate("Branch changed; confirmation could not be saved. Check again with the same action.")); return; }
      setPreview(undefined); setChecking((value) => value + 1); onWorkspace(next);
    } catch (reason) { if (live.current) setError(errorText(reason)); }
    finally { lock.current = false; if (live.current) setBusy(false); }
  };
  const discard = () => { if (!savePending(null)) return; restoringFocus.current = true; setPreview(undefined); setError(''); if (pending) setChecking((value) => value + 1); };
  return <details className="project-branches" open={opened} onToggle={(event) => setOpened(event.currentTarget.open)}>
    <summary ref={summary}>{translate("Branches ·")}{" "}{workspace.branch}</summary>
    {!online && <p role="status">{translate("PC not connected. Branch actions are locked.")}</p>}
    {online && !canChange && <p role="status">{translate("To switch on the PC, activate the device shares for project workspaces and project branches.")}</p>}
    {error && <p role="alert">{localizeAppMessage(error)}</p>}{busy && <p role="status">{translate("Checking branch status…")}</p>}
    <button disabled={busy || !online} onClick={() => setChecking((value) => value + 1)}>{translate("Refresh branches")}</button>
    {current ? <section className="project-branch-review" aria-label={translate("Branch preview")}>
      <h3 ref={review} tabIndex={-1}>{translate("Examine branch action")}</h3>
      <p>{current.projectName}: <strong>{current.fromBranch}</strong> → <strong>{current.toBranch}</strong></p>
      <p>{current.action.kind === 'open-worktree' ? translate("The existing working copy is opened.") : current.separate ? translate("An additional working copy with a new branch is created.") : translate("The branch in this workspace is changed.")}</p>
      {pending && <p role="status">{translate("Answer still unclear. Check again uses the same process.")}</p>}
      <div className="project-workspace-actions"><button disabled={busy || !online || !canChange} onClick={() => void execute()}>{pending ? translate("Re-examine Branch Action") : translate("Execute branch operation")}</button>
        <button disabled={busy} onClick={discard}>{pending ? translate("Check status and discard preview") : translate("Cancel")}</button></div>
    </section> : overview && <>
      <p>{translate("Current:")}{" "}<strong>{overview.workspace.branch}</strong> · {overview.dirty ? translate("Existing local changes") : translate("Working tree clean")}</p>
      {overview.blockedReason && <p role="status">{localizeAppMessage(overview.blockedReason)}</p>}
      <label>{translate("Branch or base")}<select aria-label={translate("Project branch")} disabled={busy} value={ref} onChange={(event) => setRef(event.target.value)}>
        {!overview.branches.length && <option value="">{translate("No commit yet")}</option>}
        {overview.branches.map((branch) => <option key={branch.ref} value={branch.ref}>{branch.name}{branch.kind === 'remote' ? ' · Remote' : ''}{branch.current ? translate(" · current") : ''}{branch.worktreeId && !branch.current ? translate(" · in worktree") : ''}</option>)}
      </select></label>
      <button disabled={busy || !online || !canChange || !ref || overview.branches.find((branch) => branch.ref === ref)?.current || !!overview.blockedReason}
        onClick={() => void prepare({ kind: 'switch', ref })}>{translate("Switch branch")}</button>
      <fieldset disabled={busy || !online || !canChange}><legend>{translate("New branch")}</legend>
        <p>{translate("Base:")}{" "}<strong>{basis?.name ?? translate("No commit")}</strong>{basis && <> · <code>{basis.head.slice(0, 12)}</code></>}</p>
        <label>{translate("Branch name")}<input aria-label={translate("New branch name")} aria-invalid={!!branchNameError} value={name} maxLength={200} onChange={(event) => setName(event.target.value)} placeholder={translate("feature/my-idea")} /></label>
        {branchNameError && <p role="status">{branchNameError}</p>}
        <label className="project-checkbox"><input type="checkbox" checked={separate} onChange={(event) => setSeparate(event.target.checked)} />{translate("Create an additional working copy")}</label>
        <p>{translate("The basis is the commit status selected above. Unsecured changes remain in the previous workspace.")}</p>
        {overview.dirty && <p>{translate("There are uncommitted changes here. Commit only in the git area, if the new branch should contain them.")}</p>}
        <button disabled={!name.trim() || !!branchNameError || !separate && !!overview.blockedReason} onClick={() => void prepare({ kind: 'create', name: name.trim(), baseRef: ref || null, separate })}>{translate("Create branch")}</button>
      </fieldset>
      <details><summary>{translate("Existing working copies (")}{overview.worktrees.length})</summary>
        <ul>{overview.worktrees.map((worktree) => <li key={worktree.id}><span>{worktree.name} · {worktree.branch}{worktree.current ? translate(" · current") : ''}</span>
          {worktree.notice && <p>{localizeAppMessage(worktree.notice)}</p>}<button disabled={busy || !online || !canChange || worktree.current || !worktree.available}
            onClick={() => void prepare({ kind: 'open-worktree', worktreeId: worktree.id })}>{translate("Open working copy:")}{" "}{worktree.branch}</button></li>)}</ul>
      </details><p>{translate("Remote branches show the last fetched state.")}</p>
    </>}
  </details>;
}
