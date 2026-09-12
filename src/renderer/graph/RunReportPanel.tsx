import { RunQuestionsPanel, desktopRunQuestions } from './RunQuestionsPanel';
/**
 * Run report: the complete outcome of one run, projected by main through
 * `run:report` (Thema 3). Readable for finished, failed and cancelled runs
 * long after their sessions ended — per task: files, tests with output,
 * risks, commit SHA; per run: failure with the failed test commands,
 * integration range, verification attestation, approvals and publication.
 *
 * Keyboard: opens with focus on the close button, Escape closes, focus
 * returns to the element that opened it.
 */

import { useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import type { RunReport, RunReportTask } from '../../shared/types';
import { ResultDetails, outcomeText } from './ResultDetails';
import { RunFilesPanel, desktopRunFiles } from './RunFilesPanel';
const fileErrorText = (reason: unknown) => String(reason);

interface RunReportPanelProps {
  runId: string;
  /** Bumps when the journal changed so an open panel re-fetches. */
  seqCursor: number;
  /** Receives focus on close when the opening element has unmounted. */
  fallbackFocusRef?: React.RefObject<HTMLElement | null>;
  onClose: () => void;
}

type LoadState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; report: RunReport };

function formatTime(at: number): string {
  return new Date(at).toLocaleString('de-DE', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function formatDuration(from: number, to: number): string {
  const seconds = Math.max(0, Math.round((to - from) / 1000));
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ${seconds % 60} s`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

function runStatusText(status: RunReport['status']): string {
  switch (status) {
    case 'draft': return 'Entwurf';
    case 'running': return 'Läuft';
    case 'completed': return 'Abgeschlossen';
    case 'failed': return 'Fehlgeschlagen';
    case 'cancelled': return 'Abgebrochen';
    default: return status;
  }
}

function taskStatusText(status: RunReportTask['status']): string {
  switch (status) {
    case 'queued': return 'wartet';
    case 'running': return 'läuft';
    case 'completed': return 'abgeschlossen';
    case 'failed': return 'fehlgeschlagen';
    case 'cancelled': return 'abgebrochen';
    default: return status;
  }
}

function phaseText(phase: RunReportTask['phase']): string {
  switch (phase) {
    case 'plan': return 'Planung';
    case 'work': return 'Arbeit';
    case 'integrate': return 'Integration';
    case 'verify': return 'Verifikation';
    case 'manual': return 'manuell';
    default: return phase;
  }
}

function roleText(role: RunReportTask['role']): string {
  switch (role) {
    case 'orchestrator': return 'Orchestrator';
    case 'lead': return 'Lead';
    default: return 'Worker';
  }
}

export function RunReportPanel(props: RunReportPanelProps): JSX.Element {
  const { runId, seqCursor, fallbackFocusRef, onClose } = props;
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [showFiles, setShowFiles] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<Element | null>(null);

  useEffect(() => {
    openerRef.current = document.activeElement;
    closeRef.current?.focus();
    return () => {
      // The opener may already be gone by mount time (the failure alert's
      // button unmounts in the same commit), leaving `body` as the active
      // element; that is not a place focus can return to.
      const opener = openerRef.current;
      if (opener instanceof HTMLElement && opener.isConnected && opener !== document.body) {
        opener.focus();
        return;
      }
      const fallback = fallbackFocusRef?.current;
      if (fallback && fallback.isConnected) fallback.focus();
    };
    // Focus restoration is decided once, when the panel mounts.
  }, []);

  useEffect(() => {
    let live = true;
    void window.ade.invoke('run:report', { runId })
      .then((report) => { if (live) setState({ kind: 'ready', report }); })
      .catch((error: unknown) => {
        if (live) setState({ kind: 'error', message: error instanceof Error ? error.message : String(error) });
      });
    return () => { live = false; };
  }, [runId, seqCursor]);

  const onKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onClose();
    }
  };

  const report = state.kind === 'ready' ? state.report : null;
  const title = report ? report.name : 'Run-Bericht';

  return (
    <aside
      className="greport"
      role="dialog"
      aria-modal="false"
      aria-labelledby="greport-title"
      onKeyDown={onKeyDown}
    >
      <header className="greport-head">
        <div className="greport-title">
          <h3 id="greport-title">{title}</h3>
          {report && (
            <p>
              <span className="greport-chip" data-s={report.status}>{runStatusText(report.status)}</span>
              {' · '}{report.mode === 'managed' ? 'orchestriert' : 'manuell'}
              {' · '}erstellt {formatTime(report.createdAt)}
              {report.endedAt !== null && ` · beendet ${formatTime(report.endedAt)}`}
              {report.endedAt !== null && ` · Dauer ${formatDuration(report.createdAt, report.endedAt)}`}
            </p>
          )}
        </div>
        <button ref={closeRef} type="button" className="greport-close" title="Bericht schließen (Esc)" onClick={onClose}>
          ✕
        </button>
      </header>

      <div className="greport-body">
        {report?.allowQuestions && <RunQuestionsPanel key={runId} runId={runId} port={desktopRunQuestions} online canAnswer active={report.status === 'running'} />}
        {state.kind === 'loading' && <p className="greport-note" role="status">Bericht wird geladen…</p>}
        {state.kind === 'error' && (
          <p className="greport-note greport-error" role="alert">Bericht konnte nicht geladen werden: {state.message}</p>
        )}
        {report && (
          <>
            {report.goal.trim() && <p className="greport-goal">{report.goal}</p>}

            {report.failure && (
              <section className="greport-failure" aria-label="Fehlerursache">
                <h4>Fehlgeschlagen in: {report.failure.context}</h4>
                <pre>{report.failure.detail}</pre>
                {report.failure.failedTests.length > 0 && (
                  <>
                    <h5>Fehlgeschlagene Tests</h5>
                    <ul>
                      {report.failure.failedTests.map((command) => <li key={command}><code>{command}</code></li>)}
                    </ul>
                  </>
                )}
              </section>
            )}

            <button onClick={() => setShowFiles((value) => !value)} aria-expanded={showFiles}>Dateien dieses Runs</button>
            {showFiles && <RunFilesPanel runId={runId} port={desktopRunFiles} online errorText={fileErrorText} />}
            <dl className="greport-totals">
              <div><dt>Tasks</dt><dd>{report.totals.tasks}</dd></div>
              <div><dt>Abgeschlossen</dt><dd>{report.totals.completed}</dd></div>
              <div><dt>Fehlgeschlagen</dt><dd data-warn={report.totals.failed > 0 || undefined}>{report.totals.failed}</dd></div>
              <div><dt>Abgebrochen</dt><dd>{report.totals.cancelled}</dd></div>
              <div><dt>Dateien</dt><dd>{report.totals.filesChanged}</dd></div>
              <div><dt>Tests ok</dt><dd>{report.totals.testsPassed}</dd></div>
              <div><dt>Tests fehlgeschlagen</dt><dd data-warn={report.totals.testsFailed > 0 || undefined}>{report.totals.testsFailed}</dd></div>
              <div><dt>Tokens</dt><dd>{report.usage.inputTokens + report.usage.outputTokens}</dd></div>
            </dl>

            {(report.integration || report.verification || report.approvals.length > 0 || report.publication) && (
              <section className="greport-git" aria-label="Integration und Verifikation">
                {report.integration && (
                  <div className="greport-kv">
                    <span>Integration</span>
                    <span>
                      {report.integration.commitCount} Commit{report.integration.commitCount === 1 ? '' : 's'}
                      {report.integration.fromSha && report.integration.toSha && (
                        <>
                          {' · '}
                          <code title={report.integration.fromSha}>{report.integration.fromSha.slice(0, 10)}</code>
                          {' → '}
                          <code title={report.integration.toSha}>{report.integration.toSha.slice(0, 10)}</code>
                        </>
                      )}
                      {' · '}{formatTime(report.integration.at)}
                    </span>
                  </div>
                )}
                {report.verification && (
                  <div className="greport-kv">
                    <span>Verifiziert</span>
                    <span>
                      HEAD <code title={report.verification.headSha}>{report.verification.headSha.slice(0, 10)}</code>
                      {' · '}{formatTime(report.verification.verifiedAt)}
                    </span>
                  </div>
                )}
                {report.approvals.map((approval) => (
                  <div key={approval.id} className="greport-kv">
                    <span>Freigabe</span>
                    <span>
                      {approval.status === 'pending' ? 'offen' : approval.status === 'approved' ? 'erteilt' : 'abgelehnt'}
                      {' · '}angefragt {formatTime(approval.requestedAt)}
                      {approval.resolvedAt && ` · entschieden ${formatTime(approval.resolvedAt)}`}
                    </span>
                  </div>
                ))}
                {report.publication && (
                  <div className="greport-kv">
                    <span>Draft-PR</span>
                    <span>
                      {report.publication.status}
                      {' · '}⎇ {report.publication.headBranch}
                      {report.publication.prNumber !== undefined && ` · #${report.publication.prNumber}`}
                    </span>
                  </div>
                )}
              </section>
            )}

            <section className="greport-tasks" aria-label="Tasks">
              {report.tasks.length === 0 && <p className="greport-note">Dieser Run hat keine Tasks.</p>}
              {report.tasks.map((task) => (
                <article key={task.id} className="greport-task" data-s={task.status}>
                  <header>
                    <b>{task.title}</b>
                    <span className="greport-task-meta">
                      {task.participantName} · {roleText(task.role)}
                      {task.teamName && ` · ${task.teamName}`}
                      {' · '}{phaseText(task.phase)}
                      {' · '}<span className="greport-chip" data-s={task.status}>{taskStatusText(task.status)}</span>
                      {task.attempt > 1 && ` · Versuch ${task.attempt}`}
                      {task.exitCode !== undefined && ` · Exit ${task.exitCode}`}
                      {task.startedAt && task.endedAt && ` · ${formatDuration(task.startedAt, task.endedAt)}`}
                    </span>
                  </header>
                  {task.error && <pre className="greport-task-error">{task.error}</pre>}
                  {!!task.questions?.length && <details><summary>Rückfragen-Verlauf ({task.questions.length})</summary>
                    {task.questions.map((question) => <section key={question.id}><p>{question.status === 'answered' ? 'Beantwortet' : question.status === 'expired' ? 'Abgelaufen' : question.status === 'answering' ? 'Antwort wird bestätigt' : 'Offen'}</p>
                      {question.questions.map((item) => <p key={item.id} className="run-question-text">{item.question}</p>)}</section>)}
                  </details>}
                  {task.result
                    ? (
                        <>
                          <div className="greport-kv">
                            <span>Ergebnis</span>
                            <span>
                              {outcomeText(task.result.outcome)} · {task.result.adapterId}
                              {task.provenance?.modelId && ` · ${task.provenance.modelId}`}
                            </span>
                          </div>
                          <ResultDetails result={task.result} idPrefix={`greport-${task.id}`} />
                        </>
                      )
                    : <p className="greport-note">Kein validiertes Ergebnis gespeichert.</p>}
                  {task.output && <section aria-label="Antwort des Agenten"><h4>Antwort des Agenten</h4><pre className="greport-task-error">{task.output.text}</pre>
                    {task.output.limited && <p>Antwort auf 64 KiB begrenzt.</p>}{task.output.source === 'recovered-cli' && <p>Aus der früheren CLI-Sitzung wiederhergestellt.</p>}</section>}
                </article>
              ))}
            </section>
          </>
        )}
      </div>
    </aside>
  );
}
