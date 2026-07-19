import type {
  AdeConfig,
  GitStatus,
  PullRequestReviewDecision,
  Repository,
  RepositoryCommitDiff,
  RepositoryCommitSummary,
  RepositoryOverview,
  RepositoryPullRequest,
  RepositoryPullRequestAdeLink,
  RepositoryPullRequestCheck,
  RepositoryPullRequestChecksResult,
  RepositoryPullRequestCheckState,
  RepositoryPullRequestCi,
  RepositoryPullRequestResult,
} from '../../shared/types';
import {
  normalizeExecutionBackendId,
  type ExecutionBackendId,
} from '../../shared/executionBackends';
import {
  BackendGitService,
  type CommitView,
} from '../execution/BackendGitService';
import {
  decodeOutput,
  ExecutionBackendService,
  type BackendCommandOptions,
  type BackendCommandResult,
} from '../execution/ExecutionBackendService';
import {
  githubRepository,
  parseGithubRepository,
  safeGithubPullRequestUrl,
} from '../git/github';
import type { RepositoryIdentity } from '../git/GitService';

const GIT_OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const SHORT_OBJECT_ID = /^[0-9a-f]{4,64}$/;
const MAX_COMMITS = 12;
const MAX_PULL_REQUESTS = 20;
const MAX_COMMIT_FILES = 500;
const MAX_PULL_REQUEST_CHECKS = 100;
const MAX_PULL_REQUEST_NUMBER = 1_000_000_000;
const PROVIDER_MAX_BUFFER = 1024 * 1024;
const DIFF_TRUNCATION_MARKER = '… (diff truncated at 1048576 bytes)';

export interface RepositoryInspectorStorePort {
  get(): AdeConfig;
}

export interface RepositoryInspectorCommandPort {
  run(
    backend: ExecutionBackendId | undefined,
    executable: string,
    args: string[],
    options?: BackendCommandOptions,
  ): Promise<BackendCommandResult>;
  samePath(backend: ExecutionBackendId | undefined, left: string, right: string): boolean;
}

export interface RepositoryInspectorGitPort {
  identity(backend: ExecutionBackendId | undefined, path: string): Promise<RepositoryIdentity>;
  status(backend: ExecutionBackendId | undefined, path: string): Promise<GitStatus>;
  showCommit(
    backend: ExecutionBackendId | undefined,
    path: string,
    sha: string,
  ): Promise<CommitView>;
}

/** Read-only repository orientation boundary used by the right sidebar. */
export class RepositoryInspectorService {
  private readonly commands: RepositoryInspectorCommandPort;
  private readonly git: RepositoryInspectorGitPort;

  constructor(
    private readonly store: RepositoryInspectorStorePort,
    options: {
      commands?: RepositoryInspectorCommandPort;
      git?: RepositoryInspectorGitPort;
    } = {},
  ) {
    const execution = options.commands ?? new ExecutionBackendService();
    this.commands = execution;
    this.git = options.git ?? new BackendGitService(
      execution instanceof ExecutionBackendService ? execution : undefined,
    );
  }

  async overview(repositoryId: string): Promise<RepositoryOverview> {
    const repository = await this.requireRepository(repositoryId);
    const [status, headResult, historyResult, upstreamResult, remoteResult] = await Promise.all([
      this.git.status(repository.executionBackend, repository.rootPath),
      this.gitCommand(repository, ['rev-parse', '--verify', 'HEAD']),
      this.gitCommand(repository, [
        'log', `-${MAX_COMMITS}`,
        '--format=%x1e%H%x1f%h%x1f%an%x1f%aI%x1f%P%x1f%s',
      ], { maxBuffer: 256 * 1024 }),
      this.gitCommand(repository, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']),
      this.gitCommand(repository, ['config', '--get-all', 'remote.origin.url']),
    ]);
    if (!status.isRepo) throw new Error('ade: repository inspector target is no longer a Git repository');

    const headOutput = commandOutput(headResult);
    const headSha = headResult.code === 0 ? headOutput.trim() : null;
    if (headSha !== null && !GIT_OBJECT_ID.test(headSha)) {
      throw new Error('ade: Git returned an invalid repository HEAD');
    }
    const commits = historyResult.code === 0
      ? parseRecentCommits(commandOutput(historyResult))
      : [];
    const upstream = upstreamResult.code === 0
      ? boundedText(commandOutput(upstreamResult), 300) || null
      : null;
    const additions = status.files.reduce((sum, file) => sum + file.additions, 0);
    const deletions = status.files.reduce((sum, file) => sum + file.deletions, 0);

    return {
      repositoryId: repository.id,
      repositoryName: repository.name,
      executionBackend: normalizeExecutionBackendId(repository.executionBackend),
      branch: status.branch,
      headSha,
      upstream,
      ahead: status.ahead,
      behind: status.behind,
      changedFiles: status.files.length,
      additions,
      deletions,
      remote: remoteSummary(remoteResult),
      commits,
      refreshedAt: Date.now(),
    };
  }

  async pullRequests(repositoryId: string): Promise<RepositoryPullRequestResult> {
    const repository = await this.requireRepository(repositoryId);
    const remoteResult = await this.gitCommand(repository, [
      'config', '--get-all', 'remote.origin.url',
    ]);
    const providerRepository = githubRemote(remoteResult);
    if (!providerRepository) {
      return {
        status: 'unsupported',
        pullRequests: [],
        message: 'Open PRs require one unambiguous GitHub origin.',
        refreshedAt: Date.now(),
      };
    }

    const result = await this.commands.run(
      repository.executionBackend,
      'gh',
      [
        'pr', 'list',
        '--repo', githubRepository(providerRepository),
        '--state', 'open',
        '--limit', String(MAX_PULL_REQUESTS),
        '--json', [
          'number', 'title', 'url', 'author', 'isDraft', 'updatedAt',
          'headRefName', 'baseRefName', 'reviewDecision',
          'changedFiles', 'additions', 'deletions', 'statusCheckRollup',
        ].join(','),
      ],
      {
        cwd: repository.rootPath,
        timeoutMs: 15_000,
        maxBuffer: PROVIDER_MAX_BUFFER,
      },
    );
    if (result.timedOut || result.code !== 0) {
      return {
        status: 'unavailable',
        providerRepository,
        pullRequests: [],
        message: result.timedOut
          ? 'GitHub PR lookup timed out. Retry when the connection is available.'
          : 'GitHub PRs are unavailable. Check gh authentication in Diagnostics.',
        refreshedAt: Date.now(),
      };
    }
    try {
      const pullRequests = parseRepositoryPullRequests(
        decodeOutput(result.stdout),
        providerRepository,
      ).map((pullRequest) => ({
        ...pullRequest,
        adePublication: this.adePublicationLink(repository, providerRepository, pullRequest),
      }));
      return {
        status: 'ready',
        providerRepository,
        pullRequests,
        refreshedAt: Date.now(),
      };
    } catch {
      return {
        status: 'unavailable',
        providerRepository,
        pullRequests: [],
        message: 'GitHub returned an invalid Pull Request response.',
        refreshedAt: Date.now(),
      };
    }
  }

  /**
   * On-demand individual CI checks for one open PR. Logs and check details
   * stay on GitHub; ADE never renders provider URLs from this read.
   */
  async pullRequestChecks(
    repositoryId: string,
    pullRequestNumber: number,
  ): Promise<RepositoryPullRequestChecksResult> {
    if (!Number.isSafeInteger(pullRequestNumber)
        || pullRequestNumber < 1 || pullRequestNumber > MAX_PULL_REQUEST_NUMBER) {
      throw new Error('ade: repository inspector requires a positive Pull Request number');
    }
    const repository = await this.requireRepository(repositoryId);
    const remoteResult = await this.gitCommand(repository, [
      'config', '--get-all', 'remote.origin.url',
    ]);
    const providerRepository = githubRemote(remoteResult);
    if (!providerRepository) {
      return {
        status: 'unsupported',
        pullRequestNumber,
        checks: [],
        checksTruncated: false,
        message: 'CI checks require one unambiguous GitHub origin.',
        refreshedAt: Date.now(),
      };
    }
    const result = await this.commands.run(
      repository.executionBackend,
      'gh',
      [
        'pr', 'view', String(pullRequestNumber),
        '--repo', githubRepository(providerRepository),
        '--json', 'number,url,statusCheckRollup',
      ],
      {
        cwd: repository.rootPath,
        timeoutMs: 15_000,
        maxBuffer: PROVIDER_MAX_BUFFER,
      },
    );
    if (result.timedOut || result.code !== 0) {
      return {
        status: 'unavailable',
        pullRequestNumber,
        checks: [],
        checksTruncated: false,
        message: result.timedOut
          ? 'GitHub check lookup timed out. Retry when the connection is available.'
          : 'GitHub checks are unavailable. Check gh authentication in Diagnostics.',
        refreshedAt: Date.now(),
      };
    }
    try {
      const parsed = parsePullRequestChecks(
        decodeOutput(result.stdout),
        providerRepository,
        pullRequestNumber,
      );
      return {
        status: 'ready',
        pullRequestNumber,
        checks: parsed.checks,
        checksTruncated: parsed.checksTruncated,
        refreshedAt: Date.now(),
      };
    } catch {
      return {
        status: 'unavailable',
        pullRequestNumber,
        checks: [],
        checksTruncated: false,
        message: 'GitHub returned an invalid check response.',
        refreshedAt: Date.now(),
      };
    }
  }

  async commitDiff(repositoryId: string, commitSha: string): Promise<RepositoryCommitDiff> {
    if (!GIT_OBJECT_ID.test(commitSha)) {
      throw new Error('ade: repository inspector requires a full lowercase commit object id');
    }
    const repository = await this.requireRepository(repositoryId);
    const verification = await this.gitCommand(repository, [
      'rev-parse', '--verify', `${commitSha}^{commit}`,
    ]);
    const resolved = commandOutput(verification).trim();
    if (verification.code !== 0 || resolved !== commitSha) {
      throw new Error('ade: repository inspector commit does not exist in this repository');
    }
    const view = await this.git.showCommit(
      repository.executionBackend,
      repository.rootPath,
      commitSha,
    );
    const files = view.files.slice(0, MAX_COMMIT_FILES).map((file) => ({
      path: boundedText(file.path, 1_000),
      additions: boundedInteger(file.additions),
      deletions: boundedInteger(file.deletions),
    }));
    return {
      commitSha,
      title: boundedText(view.title, 300) || '(no subject)',
      files,
      filesTruncated: view.files.length > files.length,
      diff: view.diff,
      truncated: view.diff.includes(DIFF_TRUNCATION_MARKER),
    };
  }

  /**
   * Exact traceability from an open PR to the ADE publication that created
   * it: same repository and provider identity, matched by recorded PR number
   * first and by the ADE-owned head branch for not-yet-numbered attempts.
   */
  private adePublicationLink(
    repository: Repository,
    providerRepository: string,
    pullRequest: Pick<RepositoryPullRequest, 'number' | 'headBranch'>,
  ): RepositoryPullRequestAdeLink | null {
    const candidates = this.store.get().runPublications.filter((publication) =>
      publication.repositoryId === repository.id
      && publication.provider === 'github'
      && publication.providerRepository.toLowerCase() === providerRepository.toLowerCase());
    const match = candidates.find((publication) => publication.prNumber === pullRequest.number)
      ?? candidates.find((publication) => publication.headBranch === pullRequest.headBranch);
    return match
      ? { runId: match.runId, publicationId: match.id, status: match.status }
      : null;
  }

  private async requireRepository(repositoryId: string): Promise<Repository> {
    const repository = this.store.get().repositories.find((candidate) => candidate.id === repositoryId);
    if (!repository) throw new Error(`ade: repository not found "${repositoryId}"`);
    if (!repository.verified) throw new Error('ade: repository inspector requires a verified catalog entry');
    const identity = await this.git.identity(repository.executionBackend, repository.rootPath);
    if (!this.commands.samePath(repository.executionBackend, identity.rootPath, repository.rootPath)
        || !this.commands.samePath(
          repository.executionBackend,
          identity.commonGitDir,
          repository.commonGitDir,
        )) {
      throw new Error('ade: repository inspector target no longer matches its catalog identity');
    }
    return repository;
  }

  private async gitCommand(
    repository: Repository,
    args: string[],
    options: Pick<BackendCommandOptions, 'maxBuffer' | 'timeoutMs'> = {},
  ): Promise<BackendCommandResult> {
    const result = await this.commands.run(
      repository.executionBackend,
      'git',
      ['-C', repository.rootPath, ...args],
      {
        timeoutMs: options.timeoutMs ?? 10_000,
        maxBuffer: options.maxBuffer ?? 128 * 1024,
      },
    );
    if (result.timedOut) throw new Error('ade: repository inspector Git command timed out');
    return result;
  }
}

export function parseRecentCommits(value: string): RepositoryCommitSummary[] {
  const commits: RepositoryCommitSummary[] = [];
  for (const rawRecord of value.split('\x1e')) {
    const record = rawRecord.replace(/^[\r\n]+|[\r\n]+$/g, '');
    if (!record) continue;
    const [sha, shortSha, author, authoredAt, parents, ...subjectParts] = record.split('\x1f');
    const subject = subjectParts.join('\x1f');
    if (!sha || !shortSha || author === undefined || !authoredAt || parents === undefined
        || subject === undefined || !GIT_OBJECT_ID.test(sha)
        || !SHORT_OBJECT_ID.test(shortSha) || !sha.startsWith(shortSha)) {
      throw new Error('ade: Git returned an invalid commit history record');
    }
    const date = new Date(authoredAt);
    if (Number.isNaN(date.getTime())) throw new Error('ade: Git returned an invalid commit timestamp');
    const parentIds = parents.trim() ? parents.trim().split(/\s+/) : [];
    if (parentIds.some((parent) => !GIT_OBJECT_ID.test(parent))) {
      throw new Error('ade: Git returned an invalid commit parent');
    }
    commits.push({
      sha,
      shortSha,
      author: boundedText(author, 200) || 'Unknown author',
      authoredAt: date.toISOString(),
      subject: boundedText(subject, 300) || '(no subject)',
      parentCount: parentIds.length,
    });
  }
  if (commits.length > MAX_COMMITS) {
    throw new Error('ade: Git returned more history than requested');
  }
  return commits;
}

export function parseRepositoryPullRequests(
  value: string,
  providerRepository: string,
): RepositoryPullRequest[] {
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed) || parsed.length > MAX_PULL_REQUESTS) {
    throw new Error('ade: invalid GitHub Pull Request list');
  }
  return parsed.map((item): RepositoryPullRequest => {
    if (!isRecord(item)) throw new Error('ade: invalid GitHub Pull Request record');
    const number = positiveInteger(item.number);
    const url = typeof item.url === 'string'
      ? safeGithubPullRequestUrl(item.url, providerRepository, number)
      : null;
    const author = isRecord(item.author) && typeof item.author.login === 'string'
      ? providerText(item.author.login, 200, true)
      : 'ghost';
    if (!url || typeof item.isDraft !== 'boolean') {
      throw new Error('ade: invalid GitHub Pull Request identity');
    }
    const updatedAt = providerDate(item.updatedAt);
    return {
      number,
      title: providerText(item.title, 300),
      url,
      author: author || 'ghost',
      isDraft: item.isDraft,
      updatedAt,
      headBranch: providerText(item.headRefName, 255),
      baseBranch: providerText(item.baseRefName, 255),
      reviewDecision: reviewDecision(item.reviewDecision),
      changedFiles: nonNegativeInteger(item.changedFiles),
      additions: nonNegativeInteger(item.additions),
      deletions: nonNegativeInteger(item.deletions),
      ci: summarizeCheckRollup(item.statusCheckRollup),
      adePublication: null,
    };
  }).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

/**
 * Bounded rollup summary for the PR list. Mirrors the publication gate's
 * conservative reading: unknown or malformed entries count as pending, and
 * any failure-shaped conclusion marks the whole rollup as failed.
 */
export function summarizeCheckRollup(value: unknown): RepositoryPullRequestCi {
  if (!Array.isArray(value) || value.length === 0) {
    return { state: 'none', total: 0, failed: 0, pending: 0 };
  }
  let failed = 0;
  let pending = 0;
  for (const raw of value) {
    const state = classifyCheckEntry(raw);
    if (state === 'failed') failed += 1;
    else if (state === 'pending') pending += 1;
  }
  return {
    state: failed > 0 ? 'failed' : pending > 0 ? 'pending' : 'passed',
    total: value.length,
    failed,
    pending,
  };
}

function classifyCheckEntry(raw: unknown): RepositoryPullRequestCheckState {
  if (!isRecord(raw)) return 'pending';
  const status = String(raw.status ?? raw.state ?? '').toUpperCase();
  const conclusion = String(raw.conclusion ?? '').toUpperCase();
  if (['FAILURE', 'FAILED', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'STARTUP_FAILURE'].includes(conclusion)
      || ['ERROR', 'FAILURE'].includes(status)) return 'failed';
  if (conclusion === 'SKIPPED' || status === 'SKIPPED') return 'skipped';
  if (conclusion === 'NEUTRAL' || status === 'NEUTRAL') return 'neutral';
  if (status === 'SUCCESS' || conclusion === 'SUCCESS') return 'passed';
  return 'pending';
}

export function parsePullRequestChecks(
  value: string,
  providerRepository: string,
  pullRequestNumber: number,
): { checks: RepositoryPullRequestCheck[]; checksTruncated: boolean } {
  const parsed: unknown = JSON.parse(value);
  if (!isRecord(parsed) || parsed.number !== pullRequestNumber) {
    throw new Error('ade: GitHub returned a different Pull Request');
  }
  if (typeof parsed.url !== 'string'
      || !safeGithubPullRequestUrl(parsed.url, providerRepository, pullRequestNumber)) {
    throw new Error('ade: GitHub returned a Pull Request outside this repository');
  }
  const rollup = parsed.statusCheckRollup;
  if (rollup === null || rollup === undefined) return { checks: [], checksTruncated: false };
  if (!Array.isArray(rollup)) throw new Error('ade: invalid GitHub check rollup');
  const bounded = rollup.slice(0, MAX_PULL_REQUEST_CHECKS);
  const checks = bounded.map((raw): RepositoryPullRequestCheck => {
    if (!isRecord(raw)) throw new Error('ade: invalid GitHub check record');
    const name = typeof raw.name === 'string' && raw.name.trim()
      ? raw.name
      : typeof raw.context === 'string' && raw.context.trim() ? raw.context : '';
    return {
      name: boundedText(name, 200) || '(unnamed check)',
      state: classifyCheckEntry(raw),
    };
  });
  return { checks, checksTruncated: rollup.length > checks.length };
}

function commandOutput(result: BackendCommandResult): string {
  return decodeOutput(result.stdout);
}

function remoteSummary(result: BackendCommandResult): RepositoryOverview['remote'] {
  const providerRepository = githubRemote(result);
  if (providerRepository) return { kind: 'github', providerRepository };
  const urls = commandOutput(result).split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
  return { kind: urls.length === 0 ? 'none' : 'other' };
}

function githubRemote(result: BackendCommandResult): string | null {
  if (result.code !== 0) return null;
  const urls = commandOutput(result).split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
  return urls.length === 1 ? parseGithubRepository(urls[0]!) : null;
}

function boundedText(value: string, max: number): string {
  return value
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function providerText(value: unknown, max: number, allowEmpty = false): string {
  if (typeof value !== 'string' || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error('ade: invalid GitHub text field');
  }
  const text = value.trim();
  if (!allowEmpty && !text) throw new Error('ade: empty GitHub text field');
  return text;
}

function providerDate(value: unknown): string {
  if (typeof value !== 'string' || value.length > 100) {
    throw new Error('ade: invalid GitHub date field');
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error('ade: invalid GitHub date field');
  return date.toISOString();
}

function positiveInteger(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new Error('ade: invalid GitHub positive integer');
  }
  return value as number;
}

function nonNegativeInteger(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error('ade: invalid GitHub non-negative integer');
  }
  return value as number;
}

function boundedInteger(value: number): number {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function reviewDecision(value: unknown): PullRequestReviewDecision {
  if (value === null || value === undefined || value === '') return 'none';
  if (value === 'APPROVED') return 'approved';
  if (value === 'CHANGES_REQUESTED') return 'changes-requested';
  if (value === 'REVIEW_REQUIRED') return 'review-required';
  throw new Error('ade: invalid GitHub review decision');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
