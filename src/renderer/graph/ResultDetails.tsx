/**
 * Everything a validated task result contains, readable after the run ended
 * (Thema 3): the full summary, every changed file, every test command with
 * its status and expandable output, risks and the commit SHA. Works for the
 * journal's `RunTaskResult` and the report's `RunReportResult` alike.
 */

import type { JSX } from 'react';
import type { RunReportTest } from '../../shared/types';

export interface ResultLike {
  outcome: 'succeeded' | 'failed' | 'blocked';
  summary: string;
  filesChanged: string[];
  tests: RunReportTest[];
  risks: string[];
  commitSha: string | null;
}

export function outcomeText(outcome: ResultLike['outcome']): string {
  switch (outcome) {
    case 'succeeded': return 'erfolgreich';
    case 'failed': return 'fehlgeschlagen';
    case 'blocked': return 'blockiert';
    default: return outcome;
  }
}

export function testStatusText(status: RunReportTest['status']): string {
  switch (status) {
    case 'passed': return 'ok';
    case 'failed': return 'fehlgeschlagen';
    case 'skipped': return 'übersprungen';
    default: return status;
  }
}

export function ResultDetails(props: { result: ResultLike; idPrefix: string }): JSX.Element {
  const { result, idPrefix } = props;
  const failedTests = result.tests.filter((test) => test.status === 'failed');
  const passedTests = result.tests.filter((test) => test.status === 'passed');
  return (
    <div className="gresult" data-outcome={result.outcome}>
      {result.summary.trim() && (
        <p className="gresult-summary">{result.summary}</p>
      )}
      {result.commitSha && (
        <div className="gresult-row">
          <span>Commit</span>
          <code title={result.commitSha}>{result.commitSha.slice(0, 12)}</code>
        </div>
      )}
      {result.filesChanged.length > 0 && (
        <details className="gresult-block" open={result.filesChanged.length <= 8}>
          <summary>{result.filesChanged.length} geänderte Datei{result.filesChanged.length === 1 ? '' : 'en'}</summary>
          <ul className="gresult-files">
            {result.filesChanged.map((path) => <li key={path}><code>{path}</code></li>)}
          </ul>
        </details>
      )}
      {result.tests.length > 0 && (
        <details className="gresult-block" open={failedTests.length > 0}>
          <summary>
            Tests: {passedTests.length} ok
            {failedTests.length > 0 && <b className="gresult-failed"> · {failedTests.length} fehlgeschlagen</b>}
            {result.tests.length - passedTests.length - failedTests.length > 0
              && ` · ${result.tests.length - passedTests.length - failedTests.length} übersprungen`}
          </summary>
          <ul className="gresult-tests">
            {result.tests.map((test, index) => (
              <li key={`${index}:${test.command}`} data-s={test.status}>
                <div className="gresult-test-head">
                  <span className="gresult-test-status">{testStatusText(test.status)}</span>
                  <code>{test.command}</code>
                </div>
                {test.output.trim() && (
                  <details open={test.status === 'failed'}>
                    <summary id={`${idPrefix}-test-${index}`}>Ausgabe ({test.output.length} Zeichen)</summary>
                    <pre aria-labelledby={`${idPrefix}-test-${index}`}>{test.output}</pre>
                  </details>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
      {result.risks.length > 0 && (
        <details className="gresult-block" open>
          <summary>{result.risks.length === 1 ? '1 Risiko' : `${result.risks.length} Risiken`}</summary>
          <ul className="gresult-risks">
            {result.risks.map((risk, index) => <li key={`${index}:${risk}`}>{risk}</li>)}
          </ul>
        </details>
      )}
    </div>
  );
}
