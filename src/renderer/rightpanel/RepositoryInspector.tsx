import { useEffect, useRef, useState, type JSX, type MouseEvent } from 'react';
import type {
  RepositoryCommitSummary,
  RepositoryOverview,
  RepositoryPullRequest,
  RepositoryPullRequestResult,
} from '../../shared/types';
import { NATIVE_EXECUTION_BACKEND } from '../../shared/executionBackends';

interface RepositoryInspectorProps {
  repositoryId: string | null;
  visible: boolean;
  nonce: number;
  openCommitSha: string | null;
  onOpenCommit: (
    commit: RepositoryCommitSummary,
    trigger: HTMLButtonElement,
  ) => void;
}

export function RepositoryInspector({
  repositoryId,
  visible,
  nonce,
  openCommitSha,
  onOpenCommit,
}: RepositoryInspectorProps): JSX.Element {
  const [overview, setOverview] = useState<RepositoryOverview | null>(null);
  const [pullRequests, setPullRequests] = useState<RepositoryPullRequestResult | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [pullRequestsLoading, setPullRequestsLoading] = useState(false);
  const [overviewError, setOverviewError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const overviewRequestSequence = useRef(0);
  const pullRequestSequence = useRef(0);

  useEffect(() => {
    if (!repositoryId || !visible) {
      if (!repositoryId) {
        setOverview(null);
        setPullRequests(null);
        setOverviewError(null);
      }
      return;
    }
    const sequence = ++overviewRequestSequence.current;
    setOverviewLoading(true);
    setOverviewError(null);

    void window.ade.invoke('repository:overview', { repositoryId })
      .then((result) => {
        if (sequence === overviewRequestSequence.current) setOverview(result);
      })
      .catch((reason) => {
        if (sequence !== overviewRequestSequence.current) return;
        setOverview(null);
        setOverviewError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (sequence === overviewRequestSequence.current) setOverviewLoading(false);
      });
  }, [repositoryId, visible, nonce, refreshKey]);

  // PR discovery may involve the network. Refresh it only on an explicit
  // inspector visit/refresh, never on the five-second local workspace poll.
  useEffect(() => {
    if (!repositoryId || !visible) return;
    const sequence = ++pullRequestSequence.current;
    setPullRequestsLoading(true);

    void window.ade.invoke('repository:pullRequests', { repositoryId })
      .then((result) => {
        if (sequence === pullRequestSequence.current) setPullRequests(result);
      })
      .catch(() => {
        if (sequence !== pullRequestSequence.current) return;
        setPullRequests({
          status: 'unavailable',
          pullRequests: [],
          message: 'GitHub PRs are unavailable. Retry or check Diagnostics.',
          refreshedAt: Date.now(),
        });
      })
      .finally(() => {
        if (sequence === pullRequestSequence.current) setPullRequestsLoading(false);
      });
  }, [repositoryId, visible, refreshKey]);

  if (!repositoryId) {
    return (
      <div className="ri-empty" data-testid="repository-overview-empty">
        <strong>Select a repository</strong>
        <span>Choose a repository above to inspect its health, open PRs and recent commits.</span>
      </div>
    );
  }

  const refresh = (): void => setRefreshKey((value) => value + 1);

  return (
    <div className="ri" data-testid="repository-overview" aria-busy={overviewLoading}>
      <div className="ri-toolbar">
        <div>
          <span className="ri-eyebrow">Selected repository</span>
          <strong>{overview?.repositoryName ?? (overviewLoading ? 'Loading…' : 'Repository')}</strong>
        </div>
        <button
          type="button"
          className="ri-refresh"
          aria-label="Refresh repository overview"
          title="Refresh local repository data and open Pull Requests"
          disabled={overviewLoading || pullRequestsLoading}
          onClick={refresh}
        >
          ↻
        </button>
      </div>

      {overviewError ? (
        <div className="ri-state ri-state-error" role="alert">
          <span>Repository overview could not be loaded.</span>
          <button type="button" onClick={refresh}>Retry</button>
        </div>
      ) : overview ? (
        <RepositoryHealth overview={overview} />
      ) : (
        <div className="ri-health-skeleton" aria-label="Loading local repository information">
          <span /><span /><span /><span />
        </div>
      )}

      <PullRequestSection result={pullRequests} loading={pullRequestsLoading} />

      <section className="ri-section" aria-labelledby="ri-commits-title">
        <header className="ri-section-head">
          <div>
            <h3 id="ri-commits-title">Recent commits</h3>
            <span>Local history · no fetch</span>
          </div>
          {overview ? <span className="ri-count">{overview.commits.length}</span> : null}
        </header>
        {overviewLoading && !overview ? (
          <div className="ri-state">Loading commit history…</div>
        ) : overview?.commits.length ? (
          <ol className="ri-commit-list">
            {overview.commits.map((commit) => (
              <li key={commit.sha}>
                <button
                  type="button"
                  className={`ri-commit${openCommitSha === commit.sha ? ' open' : ''}`}
                  data-commit-sha={commit.sha}
                  aria-pressed={openCommitSha === commit.sha}
                  aria-label={`Inspect commit ${commit.shortSha}: ${commit.subject}`}
                  onClick={(event: MouseEvent<HTMLButtonElement>) => {
                    onOpenCommit(commit, event.currentTarget);
                  }}
                >
                  <span className="ri-commit-line">
                    <code>{commit.shortSha}</code>
                    <strong>{commit.subject}</strong>
                  </span>
                  <span className="ri-commit-meta">
                    <span>{commit.author}</span>
                    <time dateTime={commit.authoredAt} title={formatAbsoluteDate(commit.authoredAt)}>
                      {formatRelativeDate(commit.authoredAt)}
                    </time>
                    {commit.parentCount > 1 ? <span className="ri-tag">merge</span> : null}
                  </span>
                </button>
              </li>
            ))}
          </ol>
        ) : overview ? (
          <div className="ri-state">No commits yet.</div>
        ) : null}
      </section>
    </div>
  );
}

function RepositoryHealth({ overview }: { overview: RepositoryOverview }): JSX.Element {
  const backend = overview.executionBackend === NATIVE_EXECUTION_BACKEND
    ? 'Native'
    : `WSL · ${overview.executionBackend.slice('wsl:'.length)}`;
  const sync = overview.upstream
    ? overview.ahead || overview.behind
      ? `↑${overview.ahead} ↓${overview.behind}`
      : 'Up to date'
    : 'No upstream';
  const remote = overview.remote.kind === 'github'
    ? overview.remote.providerRepository
    : overview.remote.kind === 'other' ? 'Non-GitHub origin' : 'No origin';
  return (
    <section className="ri-health" aria-label="Local repository health">
      <dl className="ri-health-grid">
        <div>
          <dt>Branch</dt>
          <dd title={overview.branch || overview.headSha || ''}>
            {overview.branch || '(detached)'}
          </dd>
        </div>
        <div>
          <dt>Working tree</dt>
          <dd className={overview.changedFiles ? 'ri-dirty' : 'ri-clean'}>
            {overview.changedFiles ? `${overview.changedFiles} changed` : 'Clean'}
          </dd>
        </div>
        <div>
          <dt>Sync</dt>
          <dd title={overview.upstream ?? undefined}>{sync}</dd>
        </div>
        <div>
          <dt>Backend</dt>
          <dd>{backend}</dd>
        </div>
      </dl>
      <div className="ri-health-foot">
        <span title={overview.remote.kind === 'github' ? `GitHub · ${remote}` : remote}>{remote}</span>
        {overview.changedFiles ? (
          <span><b className="plus">+{overview.additions}</b> <b className="minus">−{overview.deletions}</b></span>
        ) : overview.headSha ? <code>{overview.headSha.slice(0, 10)}</code> : <span>Unborn repository</span>}
      </div>
    </section>
  );
}

function PullRequestSection({
  result,
  loading,
}: {
  result: RepositoryPullRequestResult | null;
  loading: boolean;
}): JSX.Element {
  return (
    <section className="ri-section" aria-labelledby="ri-prs-title">
      <header className="ri-section-head">
        <div>
          <h3 id="ri-prs-title">Open Pull Requests</h3>
          <span>GitHub · read only</span>
        </div>
        {result?.status === 'ready' ? <span className="ri-count">{result.pullRequests.length}</span> : null}
      </header>
      {loading && !result ? (
        <div className="ri-state" aria-live="polite">Loading open Pull Requests…</div>
      ) : result?.status === 'ready' && result.pullRequests.length ? (
        <ol className="ri-pr-list">
          {result.pullRequests.map((pullRequest) => (
            <li key={pullRequest.number}>
              <PullRequestRow
                pullRequest={pullRequest}
                providerRepository={result.providerRepository ?? ''}
              />
            </li>
          ))}
        </ol>
      ) : result?.status === 'ready' ? (
        <div className="ri-state ri-state-success">No open Pull Requests.</div>
      ) : result ? (
        <div className="ri-state">
          <span>{result.message}</span>
        </div>
      ) : null}
    </section>
  );
}

function PullRequestRow({
  pullRequest,
  providerRepository,
}: {
  pullRequest: RepositoryPullRequest;
  providerRepository: string;
}): JSX.Element {
  const href = safePullRequestUrl(pullRequest, providerRepository);
  const content = (
    <>
      <span className="ri-pr-line">
        <code>#{pullRequest.number}</code>
        <strong>{pullRequest.title}</strong>
        <span aria-hidden="true">↗</span>
      </span>
      <span className="ri-pr-meta">
        <span>{pullRequest.author}</span>
        <span>{pullRequest.baseBranch} ← {pullRequest.headBranch}</span>
        <time dateTime={pullRequest.updatedAt} title={formatAbsoluteDate(pullRequest.updatedAt)}>
          {formatRelativeDate(pullRequest.updatedAt)}
        </time>
      </span>
      <span className="ri-pr-stats">
        <span>{pullRequest.changedFiles} files</span>
        <b className="plus">+{pullRequest.additions}</b>
        <b className="minus">−{pullRequest.deletions}</b>
        <span className={`ri-tag ri-tag-${pullRequest.isDraft ? 'draft' : pullRequest.reviewDecision}`}>
          {pullRequest.isDraft ? 'draft' : reviewLabel(pullRequest.reviewDecision)}
        </span>
      </span>
    </>
  );
  return href ? (
    <a
      className="ri-pr"
      href={href}
      target="_blank"
      rel="noreferrer"
      aria-label={`Open Pull Request #${pullRequest.number} on GitHub: ${pullRequest.title}`}
    >
      {content}
    </a>
  ) : <div className="ri-pr ri-pr-invalid">{content}</div>;
}

function safePullRequestUrl(
  pullRequest: RepositoryPullRequest,
  providerRepository: string,
): string | null {
  try {
    const url = new URL(pullRequest.url);
    const segments = url.pathname.split('/').filter(Boolean);
    return url.protocol === 'https:'
      && url.hostname.toLowerCase() === 'github.com'
      && !url.username && !url.password && !url.search && !url.hash
      && segments.length === 4
      && `${segments[0]}/${segments[1]}`.toLowerCase() === providerRepository.toLowerCase()
      && segments[2] === 'pull'
      && segments[3] === String(pullRequest.number)
      ? url.toString().replace(/\/$/, '')
      : null;
  } catch {
    return null;
  }
}

function reviewLabel(value: RepositoryPullRequest['reviewDecision']): string {
  if (value === 'approved') return 'approved';
  if (value === 'changes-requested') return 'changes';
  if (value === 'review-required') return 'review';
  return 'open';
}

function formatAbsoluteDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })
    .format(new Date(value));
}

function formatRelativeDate(value: string): string {
  const delta = new Date(value).getTime() - Date.now();
  const magnitude = Math.abs(delta);
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  if (magnitude < 60 * 60 * 1_000) return formatter.format(Math.round(delta / 60_000), 'minute');
  if (magnitude < 24 * 60 * 60 * 1_000) return formatter.format(Math.round(delta / 3_600_000), 'hour');
  if (magnitude < 30 * 24 * 60 * 60 * 1_000) {
    return formatter.format(Math.round(delta / 86_400_000), 'day');
  }
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(value));
}
