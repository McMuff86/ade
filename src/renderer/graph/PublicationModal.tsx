import { localizeAppMessage } from '../../shared/i18n/appMessages';
import { t as translate } from "../../shared/i18n";
import { useLocale } from "../i18n/language";
/** Verified draft-PR publication of a completed managed run (explicit, confirmed push). */

import { useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import type { Run, RunPublication, RunPublicationPreview } from '../../shared/types';
import { I, Ico } from './graphIcons';

export function PublicationModal(props: {
  run: Run;
  existing: RunPublication | null;
  preview: (runId: string) => Promise<RunPublicationPreview>;
  publish: (request: {
    runId: string;
    expectedHeadSha: string;
    expectedHeadBranch: string;
    commandId?: string;
  }) => Promise<RunPublication>;
  onCancel: () => void;
  onPublished: (publication: RunPublication) => void;
}): JSX.Element {
  useLocale();
  const [candidate, setCandidate] = useState<RunPublicationPreview | null>(null);
  const [published, setPublished] = useState<RunPublication | null>(
    props.existing?.status === 'draft' ? props.existing : null,
  );
  const [confirmed, setConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const modalRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const commandId = useRef(`publication-${globalThis.crypto.randomUUID()}`);

  useEffect(() => {
    let live = true;
    setCandidate(null);
    setError(null);
    void props.preview(props.run.id)
      .then((value) => { if (live) setCandidate(value); })
      .catch((previewError) => {
        if (live) setError(previewError instanceof Error ? previewError.message : String(previewError));
      });
    return () => {
      live = false;
    };
  }, [props.run.id]);
  useEffect(() => {
    returnFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    closeRef.current?.focus();
    return () => returnFocusRef.current?.focus();
  }, []);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !submitting) {
        event.preventDefault();
        props.onCancel();
        return;
      }
      if (event.key !== 'Tab' || !modalRef.current) return;
      const focusable = [...modalRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )].filter((element) => element.getAttribute('aria-hidden') !== 'true');
      if (focusable.length === 0) {
        event.preventDefault();
        modalRef.current.focus();
        return;
      }
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [props.onCancel, submitting]);

  const finalPublication = published ?? (
    candidate?.existingPublication?.status === 'draft' ? candidate.existingPublication : null
  );
  const safePrUrl = finalPublication?.prUrl
    ? safeGithubPullRequestUrl(finalPublication.prUrl)
    : null;
  const publish = async (): Promise<void> => {
    if (!candidate?.eligible || !candidate.headSha || !candidate.headBranch || !confirmed || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const publication = await props.publish({
        runId: props.run.id,
        expectedHeadSha: candidate.headSha,
        expectedHeadBranch: candidate.headBranch,
        commandId: commandId.current,
      });
      setPublished(publication);
      setConfirmed(false);
      props.onPublished(publication);
    } catch (publishError) {
      setError(publishError instanceof Error ? publishError.message : String(publishError));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="gcomposer-back" onPointerDown={() => { if (!submitting) props.onCancel(); }}>
      <section
        ref={modalRef}
        className="gpublish-modal"
        role="dialog"
        tabIndex={-1}
        aria-modal="true"
        aria-labelledby="gpublish-title"
        aria-busy={!candidate && !error}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="grun-modal-head">
          <div>
            <h2 id="gpublish-title">{translate("Publish Verified Draft PR")}</h2>
            <p>{props.run.name}{" "}{translate("· External GitHub writing process")}</p>
          </div>
          <button ref={closeRef} type="button" className="ginsp-close" title={translate("Close [5363686c]")} disabled={submitting} onClick={props.onCancel}>
            <Ico>{I.close}</Ico>
          </button>
        </div>

        <div className="gpublish-body" aria-live="polite">
          {!candidate && !error && (
            <div className="gpublish-loading">
              <span className="gpublish-spinner" aria-hidden="true" />
              {translate("Worktree, Remote, GitHub Access and Verification Certificate are checked…")}</div>
          )}

          {finalPublication && (
            <div className="gpublish-success" role="status">
              <b>{translate("Draft PR #")}{finalPublication.prNumber}{" "}{translate("is created")}</b>
              <span>
                {translate("Branch")}{" "}<code>{finalPublication.headBranch}</code> {" "}{translate("· CI")}{" "}{ciStatusText(candidate?.ciStatus ?? 'none')}
              </span>
              {safePrUrl && (
                <a href={safePrUrl} target="_blank" rel="noreferrer">{translate("Open on GitHub ↗")}</a>
              )}
              <p>{translate("ADE can neither automatically merge nor")}{" "}<code>main</code> {" "}{translate("Directly update.")}</p>
            </div>
          )}

          {candidate && !finalPublication && (
            <>
              <div className="gpublish-summary">
                <div><span>{translate("Repository")}</span><b>{candidate.providerRepository ?? candidate.repositoryName ?? '—'}</b></div>
                <div><span>{translate("Base")}</span><b>{candidate.baseBranch ?? '—'} <code>{candidate.baseSha?.slice(0, 10)}</code></b></div>
                <div><span>{translate("New branch")}</span><b><code>{candidate.headBranch ?? '—'}</code></b></div>
                <div><span>{translate("Verified")}</span><b><code>{candidate.headSha?.slice(0, 10) ?? '—'}</code></b></div>
                <div><span>{translate("Scope")}</span><b>{candidate.commitCount}{" "}{translate("Commits ·")}{" "}{candidate.changedFiles.length}{candidate.changedFilesTruncated ? '+' : ''}{" "}{translate("Files")}</b></div>
                <div><span>{translate("Provider")}</span><b>{candidate.provider === 'github' ? translate("GitHub CLI in the repo backend") : translate("Not available [6e696368]")}</b></div>
              </div>

              {!candidate.eligible && (
                <div className="gpublish-blocked" role="alert">
                  <b>{translate("Publication blocked")}</b>
                  <ul>{candidate.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
                </div>
              )}

              {candidate.eligible && (
                <>
                  <section className="gpublish-evidence">
                    <h3>{translate("Final verification")}</h3>
                    <ul>
                      {candidate.verificationCommands.map((command) => <li key={command}><code>{command}</code></li>)}
                    </ul>
                  </section>
                  <section className="gpublish-evidence">
                    <h3>{translate("Modified files")}</h3>
                    <ul className="gpublish-files">
                      {candidate.changedFiles.map((file) => <li key={file}><code>{file}</code></li>)}
                    </ul>
                  </section>
                  <label className="gpublish-confirm">
                    <input
                      type="checkbox"
                      checked={confirmed}
                      disabled={submitting}
                      onChange={(event) => setConfirmed(event.target.checked)}
                    />
                    <span>
                      {translate("I confirm the external push of this exact HEAD on the new")}{" "}<code>ade/**</code>{translate("-Branch and creating a draft PR.")}{" "}<code>main</code> {" "}{translate("remains unchanged.")}</span>
                  </label>
                </>
              )}
            </>
          )}

          {props.existing?.status === 'failed' && !finalPublication && (
            <div className="gpublish-retry">
              {translate("Previous attempt failed:")}{" "}{props.existing.error ?? translate("unknown error")}{translate("The retry checks remote branch and HEAD again.")}</div>
          )}
          {error && <div className="grun-error" role="alert">{localizeAppMessage(error)}</div>}
        </div>

        <div className="gcomposer-foot">
          <button type="button" className="gact" disabled={submitting} onClick={props.onCancel}>{translate("Close [5363686c]")}</button>
          {!finalPublication && (
            <button
              type="button"
              className="gact primary"
              disabled={!candidate?.eligible || !confirmed || submitting}
              onClick={() => void publish()}
            >
              <Ico>{I.publish}</Ico>{submitting ? translate("Publishing…") : translate("Push branch & create draft PR")}
            </button>
          )}
        </div>
      </section>
    </div>
  );
}

function ciStatusText(status: RunPublicationPreview['ciStatus']): string {
  switch (status) {
    case 'pending': return translate("running");
    case 'passed': return translate("Green");
    case 'failed': return translate("Failed [6665686c]");
    default: return translate("no checks yet");
  }
}

function safeGithubPullRequestUrl(value: string): string | null {
  try {
    const url = new URL(value);
    const parts = url.pathname.split('/').filter(Boolean);
    return url.protocol === 'https:'
      && url.hostname.toLowerCase() === 'github.com'
      && !url.username
      && !url.password
      && parts.length === 4
      && parts[2] === 'pull'
      && /^\d+$/.test(parts[3] ?? '')
      ? url.toString().replace(/\/$/, '')
      : null;
  } catch {
    return null;
  }
}
