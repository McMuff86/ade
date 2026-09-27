import { t as translate } from "../../shared/i18n";
import { useLocale } from "../i18n/language";
/** Banners under the run bar: the failed-run alert and the pending integration approval. */

import { useCallback, useEffect, useState } from 'react';
import type { JSX } from 'react';
import type { RunApproval } from '../../shared/types';
import type { ApprovalDiffResult } from '../../shared/ipc';
import { useRuns } from '../stores/runs';
import type { RunFailureNotice } from './graphModel';
import { errorText } from './graphText';

/** Colored diffs render one span per line; huge patches stay responsive. */
const DIFF_RENDER_LINE_CAP = 4000;

function diffLineClass(line: string): string {
  if (line.startsWith('+++') || line.startsWith('---')
    || line.startsWith('diff ') || line.startsWith('index ')) return 'meta';
  if (line.startsWith('@@')) return 'hunk';
  if (line.startsWith('+')) return 'add';
  if (line.startsWith('-')) return 'del';
  return '';
}

export function RunFailureAlert(props: { failure: RunFailureNotice; onOpenReport: () => void }): JSX.Element {
  useLocale();
  const { failure } = props;
  return (
    <div className="grun-failure" role="alert">
      <div className="grun-failure-head">
        <b>{translate("Run failed")}</b>
        <span title={failure.context}>{failure.context}</span>
        <button type="button" className="grun-failure-report" onClick={props.onOpenReport}>
          {translate("Open report")}</button>
      </div>
      <div className="grun-failure-body">
        <p>{failure.detail}</p>
        {failure.failedTests.length > 0 && (
          <ul className="grun-failure-tests" aria-label={translate("Failed tests")}>
            {failure.failedTests.map((command) => <li key={command}><code>{command}</code></li>)}
          </ul>
        )}
      </div>
    </div>
  );
}

export function ApprovalBanner(props: { approval: RunApproval; flash: (message: string) => void }): JSX.Element {
  useLocale();
  const { approval, flash } = props;
  const resolveApproval = useRuns((state) => state.resolveApproval);
  const [approvalOpen, setApprovalOpen] = useState(false);
  const [approvalDiff, setApprovalDiff] = useState<ApprovalDiffResult | null>(null);
  // Presentation-only preference: colored vs monochrome approval diffs.
  const [diffColors, setDiffColors] = useState(
    () => window.localStorage.getItem('ade.graph.diffColors') !== 'off',
  );
  const toggleDiffColors = useCallback(() => setDiffColors((on) => {
    const next = !on;
    window.localStorage.setItem('ade.graph.diffColors', next ? 'on' : 'off');
    return next;
  }), []);
  useEffect(() => { setApprovalOpen(false); }, [approval.id]);
  // The expanded banner shows the validated commits behind the approval.
  useEffect(() => {
    setApprovalDiff(null);
    if (!approvalOpen) return;
    let live = true;
    void window.ade.invoke('run:approvalDiff', { runId: approval.runId })
      .then((diff) => { if (live) setApprovalDiff(diff); })
      .catch(() => { if (live) setApprovalDiff({ runId: approval.runId, entries: [] }); });
    return () => { live = false; };
  }, [approvalOpen, approval]);

  return (
    <div className={`gapproval${approvalOpen ? ' open' : ''}`} role="status">
      <div className="gapproval-row">
        <div
          role="button"
          tabIndex={0}
          aria-expanded={approvalOpen}
          title={approvalOpen ? translate("Collapse") : translate("Click for text and diff of the changes")}
          onClick={() => setApprovalOpen((open) => !open)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              setApprovalOpen((open) => !open);
            }
          }}
        >
          <b>{translate("Integration is awaiting approval")}{" "}{approvalOpen ? '▾' : '▸'}</b>
          <span>{approval.reason}</span>
        </div>
        <button
          className="gact"
          onClick={() => void resolveApproval(approval.id, 'reject')
            .then(() => flash('Integration abgelehnt'))
            .catch((error) => flash(errorText(error)))}
        >
          {translate("Reject")}</button>
        <button
          className="gact primary"
          onClick={() => void resolveApproval(approval.id, 'approve')
            .then(() => flash(translate("Integration approved")))
            .catch((error) => flash(errorText(error)))}
        >
          {translate("Approve & integrate")}</button>
      </div>
      {approvalOpen && (
        <div className="gapproval-diff">
          {!approvalDiff && <span className="gapproval-note">{translate("Loading changes…")}</span>}
          {approvalDiff && approvalDiff.entries.length === 0 && (
            <span className="gapproval-note">{translate("No validated commits found.")}</span>
          )}
          {approvalDiff && approvalDiff.entries.length > 0 && (
            <div className="gapproval-diff-tools">
              <button type="button" className="gact" onClick={toggleDiffColors}>
                {translate("Diff colours:")}{" "}{diffColors ? translate('On') : translate('Off')}
              </button>
            </div>
          )}
          {approvalDiff?.entries.map((entry) => {
            const lines = diffColors ? entry.diff.split('\n') : null;
            return (
              <div key={entry.commitSha} className="gapproval-commit">
                <div className="gapproval-commit-head">
                  <b>{entry.participantName}</b>
                  <span>⎇ {entry.branch}</span>
                  <code>{entry.commitSha.slice(0, 10)}</code>
                  <span>{entry.title}</span>
                </div>
                <ul className="gapproval-files">
                  {entry.files.map((file) => (
                    <li key={file.path}>
                      <code>{file.path}</code>
                      <span className="add">+{file.additions}</span>
                      <span className="del">−{file.deletions}</span>
                    </li>
                  ))}
                </ul>
                <pre className={`gapproval-patch${diffColors ? ' colored' : ''}`}>
                  {lines
                    ? lines.slice(0, DIFF_RENDER_LINE_CAP).map((line, index) => (
                        <span key={index} className={diffLineClass(line)}>{line}{'\n'}</span>
                      ))
                    : entry.diff}
                  {lines && lines.length > DIFF_RENDER_LINE_CAP
                    && translate("... {{value1}} more lines (switch monochrome for everything)", { value1: lines.length - DIFF_RENDER_LINE_CAP })}
                </pre>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
