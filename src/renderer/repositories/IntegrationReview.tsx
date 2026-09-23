import { localizeAppMessage } from '../../shared/i18n/appMessages';
import { t as translate } from "../../shared/i18n";
import { localizedLabels } from "../../shared/i18n/labels";
import { useLocale } from "../i18n/language";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type JSX } from 'react';
import type { IntegrationCommand, IntegrationDiff, IntegrationPreview, IntegrationQuery, IntegrationReport, IntegrationResult, IntegrationSource } from '../../shared/remote';
import './integration-review.css';

export interface PendingIntegration { key: string; command: IntegrationCommand }
interface Props {
  repositoryId: string;
  online: boolean;
  canChange: boolean;
  canTest: boolean;
  query: (input: IntegrationQuery) => Promise<IntegrationResult>;
  command: (input: IntegrationCommand, key: string) => Promise<IntegrationResult>;
  errorText: (error: unknown) => string;
  certainError: (error: unknown) => boolean;
  pending: PendingIntegration | null;
  savePending: (pending: PendingIntegration | null) => boolean;
  onWorkspace: (id: string) => void;
  onBack: () => void;
}
const phases: Record<IntegrationReport['phase'], string> = localizedLabels(() => ({ preparing: translate("Preparing"), review: translate("Under review"), testing: translate("Tests are ongoing"), ready: translate("Tests passed"), integrated: translate("Taken over"), interrupted: translate("Interrupted") }));
const checkStatus = localizedLabels(() => ({ pending: translate("Waiting"), running: translate("Running"), passed: translate("Passed"), failed: translate("Failed") }));
/** Same user-visible workflow for desktop IPC and signed mobile requests. */
export function IntegrationReview(props: Props): JSX.Element {
  useLocale();
  const { repositoryId, query, command, online, canChange, canTest, pending, savePending, errorText, certainError, onWorkspace, onBack } = props;
  const [sources, setSources] = useState<IntegrationSource[]>([]); const [reviews, setReviews] = useState<NonNullable<IntegrationResult['reviews']>>([]);
  const [sourceId, setSourceId] = useState(''); const [preview, setPreview] = useState<IntegrationPreview>(); const [report, setReport] = useState<IntegrationReport>();
  const [paths, setPaths] = useState<string[]>([]); const [diff, setDiff] = useState<IntegrationDiff>();
  const [busy, setBusy] = useState(false); const [loaded, setLoaded] = useState(false); const [error, setError] = useState('');
  const [confirmed, setConfirmed] = useState(false); const [message, setMessage] = useState('');
  const step = report?.phase === 'integrated' ? 4 : report?.tested ? 3 : report ? 2 : preview ? 1 : 0;
  const live = useRef(true); const lock = useRef(false); const heading = useRef<HTMLHeadingElement>(null);
  const current = useRef(props); current.current = props;
  useLayoutEffect(() => { heading.current?.focus(); }, [preview?.id, report?.id]);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  useEffect(() => { setConfirmed(false); }, [report?.revision]);
  const apply = useCallback((result: IntegrationResult) => {
    if (!live.current) return;
    if (result.sources) { setSources(result.sources); setLoaded(true); }
    if (result.reviews) setReviews(result.reviews);
    if (result.preview) { setPreview(result.preview); setPaths(result.preview.files.filter((file) => file.suggested).map((file) => file.path)); setReport(undefined); setDiff(undefined); }
    if (result.report) { setReport(result.report); setPreview(undefined); setDiff(undefined); setMessage((value) => value || translate("feat: Checked changes from {{value1}}", { value1: result.report!.sourceName })); }
    if (result.diff) setDiff(result.diff);
  }, []);
  const perform = async (action: () => Promise<IntegrationResult>) => {
    if (lock.current || !online) return;
    lock.current = true; setBusy(true); setError('');
    try { apply(await action()); } catch (reason) { if (live.current) setError(errorText(reason)); }
    finally { lock.current = false; if (live.current) setBusy(false); }
  };
  useEffect(() => {
    if (!online) return; let disposed = false;
    setBusy(true); setError('');
    void query({ operation: 'sources', repositoryId }).then((result) => { if (!disposed) apply(result); })
      .catch((reason) => { if (!disposed) setError(current.current.errorText(reason)); })
      .finally(() => { if (!disposed) setBusy(false); });
    return () => { disposed = true; };
  }, [repositoryId, query, online, apply]);
  useEffect(() => {
    if (!online || report?.phase !== 'testing') return;
    let disposed = false; let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const result = await query({ operation: 'report', integrationId: report.id });
        if (!disposed) apply(result);
      } catch (reason) { if (!disposed) setError(current.current.errorText(reason)); }
      finally { if (!disposed) timer = setTimeout(() => { void poll(); }, 2000); }
    };
    timer = setTimeout(() => { void poll(); }, 1000);
    return () => { disposed = true; clearTimeout(timer); };
  }, [online, report?.id, report?.phase, query, apply]);
  const send = async (input: IntegrationCommand, retry = false) => {
    if (pending && !retry) return;
    const selected = retry && pending ? pending : { key: crypto.randomUUID(), command: input };
    await perform(async () => {
      if (!savePending(selected)) throw new Error(translate("The request could not be backed up on this device. Release storage and try again."));
      try { const result = await command(selected.command, selected.key); savePending(null); return result; }
      catch (reason) { if (certainError(reason)) savePending(null); throw reason; }
    });
  };
  const disabled = busy || !online || !!pending;
  return <section className="integration-review" aria-label={translate("Apply changes")} aria-busy={busy}>
    <h3 ref={heading} tabIndex={-1}>{translate("Review and apply changes")}</h3>
    <p>{translate("Prepare selected changes to an older working copy on the current branch of the main repository. ADE secures the selection and creates a separate working copy.")}</p>
    <div className="integration-actions"><button type="button" className="btn" onClick={onBack}>{translate("Go to Git sync")}</button>
      <button type="button" className="btn" disabled={busy || !online} onClick={() => void perform(() => query({ operation: 'sources', repositoryId }))}>{translate("Update sources and reports")}</button></div>
    {!online && <p role="status">{translate("No connection to the ADE computer. Reconnect to continue.")}</p>}
    {busy && <p role="status">{translate("ADE checks the current status…")}</p>}
    {error && <p className="integration-error" role="alert">{localizeAppMessage(error)}</p>}
    {pending && <div className="integration-notice"><p>{translate("The last request is not yet confirmed. Check the same request again.")}</p>
      <button type="button" className="btn" disabled={busy || !online} onClick={() => void send(pending.command, true)}>{translate("Check request again")}</button></div>}
    {!canChange && <p>{translate("To prepare and adopt on the PC, release the Git management rights and access to all projects.")}</p>}
    <ol aria-label={translate("Steps of integration")} className="integration-steps">{[translate("Select the source"), translate("Compare files"), translate("Check working copy"), translate("Confirm integration"), translate("Completed")].map((label, index) =>
      <li key={label} aria-current={index === step ? 'step' : undefined}>{index < step ? '✓ ' : ''}{label}</li>)}</ol>
    <label>{translate("Source workspace")}<select aria-label={translate("Source workspace")} value={sourceId} disabled={disabled} onChange={(event) => { setSourceId(event.target.value); setPreview(undefined); setReport(undefined); setConfirmed(false); setDiff(undefined); }}>
      <option value="">{translate("Select working copy")}</option>{sources.map((source) => <option value={source.id} key={source.id}>{source.name} · {source.branch}</option>)}</select></label>
    <button type="button" className="btn" disabled={disabled || !sourceId} onClick={() => void perform(() => query({ operation: 'preview', repositoryId, sourceId }))}>{translate("Review changes")}</button>
    {loaded && !sources.length && <p>{translate("No additional reachable working copy of this project found. Create an agent workspace or project worktree.")}</p>}
    {!!reviews.length && <details open={!preview && !report}><summary>{translate("Saved integrations (")}{reviews.length})</summary><ul className="integration-reviews">{reviews.map((review) => <li key={review.id}>
      <button type="button" className="btn" disabled={disabled} onClick={() => void perform(() => query({ operation: 'report', integrationId: review.id }))}>{review.sourceName} · {phases[review.phase]} · {review.id.slice(0, 8)}</button></li>)}</ul></details>}
    {preview && <div className="integration-preview">
      <h4>{preview.sourceName} → {preview.projectName} · {preview.targetBranch}</h4>
      <p>{translate("Selected files are checked in a separate working copy and then in")}{" "}<strong>{preview.targetBranch}</strong> {" "}{translate("applied. Push afterwards from the main workspace.")}</p>
      <div className="integration-actions"><button type="button" className="btn" disabled={disabled} onClick={() => setPaths(preview.files.filter((file) => file.selectable && file.suggested).map((file) => file.path))}>{translate("Restore recommended selection")}</button>
        <button type="button" className="btn" disabled={disabled || !paths.length} onClick={() => setPaths([])}>{translate("Clear file selection")}</button><span>{paths.length}{" "}{translate("Files selected")}</span></div>
      <p>{preview.ownCommits}{" "}{translate("own commits ·")}{" "}{preview.behind}{" "}{translate("commits behind the target. The comparison uses the common Git base; a functional review is still required.")}</p>
      <p>{translate("Source")}{" "}<code>{preview.sourceHead.slice(0, 12)}</code> {" "}{translate("· Objective")}{" "}<code>{preview.targetHead.slice(0, 12)}</code></p>
      {!!preview.blockers.length && <ul className="integration-notice">{preview.blockers.map((blocker, index) => <li key={index}>{blocker}</li>)}</ul>}
      {!preview.files.length && <p>{translate("No own or local changes to the common base.")}</p>}
      {!!preview.files.length && <fieldset disabled={disabled}><legend>{translate("Select files for backup")}</legend><ul className="integration-files">{preview.files.map((file) => <li key={file.path}>
        <label><input type="checkbox" aria-label={translate("Apply: {{value1}}", { value1: file.path })} disabled={!file.selectable} checked={paths.includes(file.path)}
          onChange={(event) => setPaths((before) => event.target.checked ? [...before, file.path] : before.filter((path) => path !== file.path))} /><span>{file.path}</span></label>
        <span>{file.kind === 'new' ? translate("New") : file.kind === 'deleted' ? translate("Deleted") : translate("Modified")} · {file.local ? translate("Locally modified") : translate("Committed")}</span>
        {file.notice && <p>{localizeAppMessage(file.notice)}</p>}<button type="button" className="btn" onClick={() => void perform(() => query({ operation: 'diff', previewId: preview.id, path: file.path }))}>{translate("Comparison:")}{" "}{file.path}</button>
      </li>)}</ul></fieldset>}
      {diff && <section aria-label={translate("File comparison {{value1}}", { value1: diff.path })}><h4>{diff.path}</h4>{diff.limited && <p>{translate("Preview shortened. Check full file in working copy.")}</p>}
        <div className="integration-diff">{[[translate("Common base"), diff.base], [translate("Selected source"), diff.source], [translate("Current target"), diff.target]].map(([title, text]) => <div key={title}><strong>{title}</strong><pre tabIndex={0}>{text || translate("(file blank or non-existent)")}</pre></div>)}</div></section>}
      <button type="button" className="btn primary" disabled={disabled || !canChange || !!preview.blockers.length || !paths.length} onClick={() => void send({ operation: 'prepare', previewId: preview.id, paths })}>{translate("Secure selection and prepare working copy")}</button>
    </div>}
    {report && <section className="integration-report" aria-label={translate("Integration report")}><h4>{report.sourceName} → {report.projectName} · {report.targetBranch}</h4>
      <p role="status">{phases[report.phase]} · {report.branch}</p>
      <p>{translate("Target base")}{" "}<code>{report.targetHead.slice(0, 12)}</code> {" "}{translate("· Source")}{" "}<code>{report.sourceHead.slice(0, 12)}</code></p>
      <div className="integration-actions"><button type="button" className="btn" disabled={disabled} onClick={() => void perform(() => query({ operation: 'report', integrationId: report.id }))}>{translate("Update report")}</button>
        {report.workspaceId && <button type="button" className="btn" disabled={disabled} onClick={() => onWorkspace(report.workspaceId!)}>{translate("Open working copy")}</button>}</div>
      {!!report.blockers.length && <ul className="integration-notice">{report.blockers.map((blocker, index) => <li key={index}>{blocker}</li>)}</ul>}
      <ul className="integration-files">{report.files.map((file) => <li key={file.path}>{file.path}{file.conflict && <strong> {" "}{translate("· Conflict")}</strong>}</li>)}</ul>
      <p>{translate("You can edit files and resolve conflicts in the working copy's Git section. Find this report again under “Saved integrations”.")}</p>
      <h4>{translate("Project checks")}</h4><p>{report.checkNotice}</p>
      {!canTest && <p>{translate("To start the tests, additionally release the terminal control for this device.")}</p>}
      {report.checks.map((check, index) => <details key={index} open={check.status === 'failed'}><summary>{check.label} · {checkStatus[check.status]}</summary><pre tabIndex={0}>{check.output || translate("No output yet.")}</pre></details>)}
      {report.phase !== 'integrated' && <><button type="button" className="btn" disabled={disabled || !canTest || report.phase === 'testing' || !!report.blockers.length || !report.workspaceId}
        onClick={() => void send({ operation: 'test', integrationId: report.id })}>{translate("Start project checks")}</button>
        <label>{translate("Commit message")}<input aria-label={translate("Commit message for integration")} maxLength={2000} value={message} disabled={disabled} onChange={(event) => setMessage(event.target.value)} /></label>
        <label className="integration-confirm"><input type="checkbox" checked={confirmed} disabled={disabled || !report.tested || !!report.blockers.length}
          onChange={(event) => setConfirmed(event.target.checked)} />{translate("I have reviewed the changes and required manual checks. Apply this state to")}{" "}{report.targetBranch}{" "}{translate("apply.")}</label>
        <button type="button" className="btn primary" disabled={disabled || !canChange || !report.tested || !!report.blockers.length || !confirmed || !message.trim()}
          onClick={() => void send({ operation: 'integrate', integrationId: report.id, revision: report.revision, message: message.trim() })}>{translate("Apply reviewed state")}</button></>}
      {report.phase === 'integrated' && <p role="status">{translate("Accepted as")}{" "}<code>{report.integratedCommit?.slice(0, 12)}</code>{translate("The original workspace is preserved. Open the main workspace in the Projects section to publish.")}</p>}
    </section>}
  </section>;
}
