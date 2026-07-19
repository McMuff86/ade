import type {
  PublicationCiStatus,
  Run,
  RunPublication,
  RunPublicationPreview,
  RunTaskResult,
} from '../../shared/types';
import type { ExecutionBackendId } from '../../shared/executionBackends';
import {
  type BackendCommandOptions,
  type BackendCommandResult,
  decodeOutput,
  ExecutionBackendService,
} from '../execution/ExecutionBackendService';
import type { OrchestrationConfigPort } from '../orchestration/OrchestrationService';
import { OrchestrationService } from '../orchestration/OrchestrationService';
import type { WorkspaceInspection } from '../orchestration/WorkspaceService';
import {
  firstSafeGithubPullUrl,
  githubRepository,
  parseGithubRepository,
  safeGithubPullRequestUrl,
} from '../git/github';

export { parseGithubRepository } from '../git/github';

const GIT_OBJECT_ID = /^[0-9a-f]{40,64}$/;
const PUBLICATION_BRANCH = /^ade\/[a-z0-9][a-z0-9._/-]{0,98}[a-z0-9]$/;
const MAX_CHANGED_FILES = 200;
const MAX_REASON_CHARS = 500;
const REMOTE_NAME = 'origin' as const;

export interface PublicationCommandPort {
  run(
    backend: ExecutionBackendId | undefined,
    executable: string,
    args: string[],
    options?: BackendCommandOptions,
  ): Promise<BackendCommandResult>;
  text(
    backend: ExecutionBackendId | undefined,
    executable: string,
    args: string[],
    options?: BackendCommandOptions,
  ): Promise<string>;
  samePath(backend: ExecutionBackendId | undefined, left: string, right: string): boolean;
}

export interface PublicationWorkspacePort {
  inspect(workspaceDir: string): Promise<WorkspaceInspection>;
}

interface PullRequestView {
  number: number;
  url: string;
  isDraft: boolean;
  state: string;
  baseRefName: string;
  headRefName: string;
  headRefOid: string;
  ciStatus: PublicationCiStatus;
}

interface CandidateInspection {
  preview: RunPublicationPreview;
  run?: Run;
  workspaceDir?: string;
  executionBackend?: ExecutionBackendId;
  providerRepository?: string;
  baseBranch?: string;
  baseSha?: string;
  headBranch?: string;
  headSha?: string;
  remoteBranchSha: string | null;
  pullRequest: PullRequestView | null;
  title?: string;
  body?: string;
}

export interface PublishRunRequest {
  runId: string;
  expectedHeadSha: string;
  expectedHeadBranch: string;
  commandId?: string;
}

/**
 * Post-verification external mutation boundary. No runtime/worker reference is
 * accepted here: source scope and attestation are resolved from durable run
 * records, then re-inspected immediately before every publication.
 */
export class PublicationService {
  private readonly chains = new Map<string, Promise<void>>();

  constructor(
    private readonly store: OrchestrationConfigPort,
    private readonly orchestration: OrchestrationService,
    private readonly workspaces: PublicationWorkspacePort,
    private readonly commands: PublicationCommandPort = new ExecutionBackendService(),
  ) {}

  async preview(runId: string): Promise<RunPublicationPreview> {
    return (await this.inspect(runId)).preview;
  }

  async publish(request: PublishRunRequest): Promise<RunPublication> {
    return this.serialized(request.runId, async () => {
      const recalled = this.orchestration.recallCommand<RunPublication>('run:publish', request.commandId);
      if (recalled) return recalled.result;

      const existing = this.store.get().runPublications.find(
        (publication) => publication.runId === request.runId && publication.status === 'draft',
      );
      if (existing) {
        this.orchestration.recordCommand('run:publish', request.commandId, existing);
        return { ...existing };
      }

      const candidate = await this.inspect(request.runId);
      if (!candidate.preview.eligible) {
        throw new Error(`ade: publication blocked: ${candidate.preview.reasons.join('; ')}`);
      }
      if (!candidate.run || !candidate.workspaceDir || !candidate.executionBackend
          || !candidate.providerRepository || !candidate.baseBranch || !candidate.baseSha
          || !candidate.headBranch || !candidate.headSha || !candidate.title || !candidate.body) {
        throw new Error('ade: publication preflight did not produce a complete candidate');
      }
      if (candidate.headSha !== request.expectedHeadSha
          || candidate.headBranch !== request.expectedHeadBranch) {
        throw new Error('ade: publication preview is stale; inspect and confirm the candidate again');
      }

      const publication = this.orchestration.beginPublication({
        runId: candidate.run.id,
        repositoryId: candidate.run.repositoryId!,
        provider: 'github',
        providerRepository: candidate.providerRepository,
        remoteName: REMOTE_NAME,
        baseBranch: candidate.baseBranch,
        headBranch: candidate.headBranch,
        baseSha: candidate.baseSha,
        headSha: candidate.headSha,
      });

      try {
        if (candidate.remoteBranchSha === null) {
          await this.checked(
            candidate.executionBackend,
            'git',
            [
              '-C', candidate.workspaceDir,
              'push', '--porcelain', '--no-verify',
              `--force-with-lease=refs/heads/${candidate.headBranch}:`,
              REMOTE_NAME,
              `${candidate.headSha}:refs/heads/${candidate.headBranch}`,
            ],
            { timeoutMs: 120_000, maxBuffer: 1024 * 1024 },
            'Git could not create the ADE publication branch',
          );
        }
        const remoteHead = await this.remoteBranchSha(
          candidate.executionBackend,
          candidate.workspaceDir,
          candidate.headBranch,
        );
        if (remoteHead !== candidate.headSha) {
          throw new Error('ade: remote publication branch does not match the attested HEAD');
        }
        await this.assertRemoteBase(candidate);

        let pullRequest = await this.findPullRequest(
          candidate.executionBackend,
          candidate.workspaceDir,
          candidate.providerRepository,
          candidate.headBranch,
        );
        if (!pullRequest) {
          const created = await this.checked(
            candidate.executionBackend,
            'gh',
            [
              'pr', 'create',
              '--repo', githubRepository(candidate.providerRepository),
              '--base', candidate.baseBranch,
              '--head', candidate.headBranch,
              '--draft',
              '--title', candidate.title,
              '--body-file', '-',
            ],
            {
              cwd: candidate.workspaceDir,
              input: candidate.body,
              timeoutMs: 120_000,
              maxBuffer: 1024 * 1024,
            },
            'GitHub could not create the Draft PR',
          );
          const createdUrl = firstSafeGithubPullUrl(decodeOutput(created.stdout));
          if (!createdUrl) throw new Error('ade: GitHub did not return a safe Pull Request URL');
          pullRequest = await this.viewPullRequest(
            candidate.executionBackend,
            candidate.workspaceDir,
            candidate.providerRepository,
            createdUrl,
          );
        }
        assertExactDraftPullRequest(pullRequest, candidate);
        await this.assertRemoteBase(candidate);
        const completed = this.orchestration.completePublication(
          publication.id,
          pullRequest.number,
          pullRequest.url,
        );
        this.orchestration.recordCommand('run:publish', request.commandId, completed);
        return completed;
      } catch (error) {
        const detail = redactSensitiveText(errorMessage(error)).slice(0, 2_000);
        this.orchestration.failPublication(publication.id, detail);
        throw new Error(detail.startsWith('ade:') ? detail : `ade: publication failed: ${detail}`);
      }
    });
  }

  private async inspect(runId: string): Promise<CandidateInspection> {
    const config = this.store.get();
    const snapshot = this.orchestration.snapshot();
    const run = snapshot.runs.find((candidate) => candidate.id === runId);
    const existingPublication = snapshot.publications.find((candidate) => candidate.runId === runId) ?? null;
    const preview: RunPublicationPreview = {
      runId,
      eligible: false,
      reasons: [],
      provider: null,
      remoteName: REMOTE_NAME,
      commitCount: 0,
      changedFiles: [],
      changedFilesTruncated: false,
      verificationCommands: [],
      ciStatus: 'none',
      existingPublication: existingPublication ? { ...existingPublication } : null,
    };
    const candidate: CandidateInspection = {
      preview,
      remoteBranchSha: null,
      pullRequest: null,
    };
    const block = (reason: string): void => {
      const safe = redactSensitiveText(reason).slice(0, MAX_REASON_CHARS);
      if (!preview.reasons.includes(safe)) preview.reasons.push(safe);
    };

    if (!run) {
      block('Run not found');
      return candidate;
    }
    candidate.run = run;
    preview.title = publicationTitle(run);
    if (run.mode !== 'managed' || run.status !== 'completed' || run.phase !== 'completed') {
      block('Only a completed managed run can be published');
    }
    if (!run.repositoryId) block('Run is not bound to a repository');
    if (!run.verifiedHeadSha || !GIT_OBJECT_ID.test(run.verifiedHeadSha)
        || !run.verificationTaskId || !run.verifiedAt) {
      block('Run has no immutable verification attestation; verify it again with this ADE version');
    }
    if (existingPublication?.status === 'draft') {
      block('Run already has a published Draft PR');
    } else if (existingPublication?.status === 'publishing') {
      block('Run publication is already in progress');
    }

    const repository = run.repositoryId
      ? config.repositories.find((item) => item.id === run.repositoryId)
      : undefined;
    if (!repository || !repository.verified) {
      block('Run repository is missing or unverified');
      return candidate;
    }
    preview.repositoryName = repository.name;
    candidate.executionBackend = repository.executionBackend;

    const orchestrator = snapshot.participants.find(
      (participant) => participant.runId === runId && participant.role === 'orchestrator',
    );
    if (!orchestrator) {
      block('Run has no orchestrator participant');
      return candidate;
    }
    const lease = snapshot.workspaceLeases
      .filter((item) => item.runId === runId && item.participantId === orchestrator.id && item.isRepo)
      .sort((left, right) => right.acquiredAt - left.acquiredAt)[0];
    if (!lease || lease.status !== 'released' || lease.repositoryId !== repository.id) {
      block('Released orchestrator repository lease is missing');
      return candidate;
    }
    if (snapshot.workspaceLeases.some((item) =>
      item.status === 'active'
      && this.commands.samePath(repository.executionBackend, item.workspaceDir, lease.workspaceDir))) {
      block('Verified worktree is currently leased by another run');
    }
    if (!GIT_OBJECT_ID.test(lease.baseSha)) {
      block('Run lease has an invalid base object id');
      return candidate;
    }
    if (!lease.branch.startsWith('ade/')) block('Verified source is not an ADE-owned branch');
    if (!this.commands.samePath(repository.executionBackend, lease.commonGitDir, repository.commonGitDir)) {
      block('Run lease no longer identifies the imported repository');
    }
    candidate.workspaceDir = lease.workspaceDir;
    candidate.baseSha = lease.baseSha;
    preview.baseSha = lease.baseSha;

    const verificationTask = run.verificationTaskId
      ? snapshot.tasks.find((task) => task.id === run.verificationTaskId && task.runId === runId)
      : undefined;
    const verificationResult = verificationTask
      ? snapshot.results.find((result) => result.taskId === verificationTask.id && result.runId === runId)
      : undefined;
    if (!verificationTask || verificationTask.phase !== 'verify' || verificationTask.status !== 'completed'
        || verificationTask.expectedHeadSha !== run.verifiedHeadSha
        || !verificationResult || verificationResult.outcome !== 'succeeded'
        || verificationResult.tests.length === 0
        || verificationResult.tests.some((test) => test.status === 'failed')) {
      block('Persisted final verification evidence is missing or unsuccessful');
    }
    preview.verificationCommands = verificationResult?.tests
      .map((test) => `${test.status}: ${redactForPublication(test.command).slice(0, 300)}`)
      .slice(0, 20) ?? [];
    if (!snapshot.approvals.some(
      (approval) => approval.runId === runId && approval.type === 'integration' && approval.status === 'approved',
    )) {
      block('Run has no approved integration gate');
    }

    try {
      const inspection = await this.workspaces.inspect(lease.workspaceDir);
      if (!inspection.isRepo) block('Verified worktree is no longer a Git repository');
      if (!inspection.clean) block('Verified worktree has uncommitted changes');
      if (!inspection.branch.startsWith('ade/')) block('Verified worktree left its ADE-owned branch');
      if (inspection.headSha !== run.verifiedHeadSha) block('Verified worktree HEAD changed after verification');
      if (!this.commands.samePath(repository.executionBackend, inspection.commonGitDir, lease.commonGitDir)) {
        block('Verified worktree Git identity changed after verification');
      }
    } catch (error) {
      block(`Verified worktree cannot be inspected: ${errorMessage(error)}`);
    }

    if (!run.verifiedHeadSha || !GIT_OBJECT_ID.test(run.verifiedHeadSha)) return candidate;
    candidate.headSha = run.verifiedHeadSha;
    preview.headSha = run.verifiedHeadSha;
    candidate.headBranch = publicationBranch(run);
    preview.headBranch = candidate.headBranch;

    try {
      const remoteUrls = (await this.gitText(
        candidate,
        ['config', '--get-all', `remote.${REMOTE_NAME}.url`],
      )).split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
      if (remoteUrls.length !== 1) {
        block('origin must have exactly one unambiguous repository URL');
        return candidate;
      }
      const providerRepository = parseGithubRepository(remoteUrls[0]!);
      if (!providerRepository) {
        block('origin is not a supported github.com repository URL');
        return candidate;
      }
      candidate.providerRepository = providerRepository;
      preview.provider = 'github';
      preview.providerRepository = providerRepository;

      const pushUrlResult = await this.commands.run(
        candidate.executionBackend,
        'git',
        ['-C', candidate.workspaceDir!, 'config', '--get-all', `remote.${REMOTE_NAME}.pushurl`],
        { timeoutMs: 30_000, maxBuffer: 256 * 1024 },
      );
      const explicitPushUrls = decodeOutput(pushUrlResult.stdout)
        .split(/\r?\n/)
        .map((value) => value.trim())
        .filter(Boolean);
      if (pushUrlResult.timedOut || (pushUrlResult.code !== 0 && pushUrlResult.code !== 1)) {
        block('origin push URL configuration could not be inspected');
        return candidate;
      }
      if (explicitPushUrls.length > 1) {
        block('origin has multiple push URLs; ADE requires one unambiguous target');
        return candidate;
      }
      if (explicitPushUrls.length === 1
          && !sameProviderRepository(providerRepository, parseGithubRepository(explicitPushUrls[0]!))) {
        block('origin push URL targets a different or unsupported repository');
        return candidate;
      }

      const remoteDefault = parseRemoteDefaultHead(
        await this.gitText(candidate, ['ls-remote', '--symref', REMOTE_NAME, 'HEAD'], 30_000),
      );
      if (!remoteDefault) {
        block('origin did not report a default branch HEAD');
        return candidate;
      }
      candidate.baseBranch = remoteDefault.branch;
      preview.baseBranch = remoteDefault.branch;
      if (remoteDefault.sha !== lease.baseSha) {
        block('Remote default branch moved after the run; integrate and verify again');
      }

      const ancestor = await this.commands.run(
        candidate.executionBackend,
        'git',
        ['-C', candidate.workspaceDir!, 'merge-base', '--is-ancestor', lease.baseSha, run.verifiedHeadSha],
        { timeoutMs: 30_000, maxBuffer: 64 * 1024 },
      );
      if (ancestor.code !== 0) block('Verified HEAD is not a descendant of the leased base');

      const countText = (await this.gitText(
        candidate,
        ['rev-list', '--count', `${lease.baseSha}..${run.verifiedHeadSha}`],
      )).trim();
      preview.commitCount = Number.parseInt(countText, 10) || 0;
      if (preview.commitCount < 1) block('Verified run has no commits to publish');
      const names = (await this.gitText(
        candidate,
        ['diff', '--name-only', '-z', lease.baseSha, run.verifiedHeadSha, '--'],
      )).split('\0').filter(Boolean);
      preview.changedFiles = names.slice(0, MAX_CHANGED_FILES);
      preview.changedFilesTruncated = names.length > MAX_CHANGED_FILES;
      if (names.length === 0) block('Verified run has no changed files to publish');

      candidate.remoteBranchSha = await this.remoteBranchSha(
        candidate.executionBackend,
        candidate.workspaceDir!,
        candidate.headBranch,
      );
      if (candidate.remoteBranchSha && candidate.remoteBranchSha !== candidate.headSha) {
        block('Remote ADE publication branch already points to a different commit');
      }

      const auth = await this.commands.run(
        candidate.executionBackend,
        'gh',
        ['auth', 'status', '--hostname', 'github.com'],
        { cwd: candidate.workspaceDir, timeoutMs: 30_000, maxBuffer: 256 * 1024 },
      );
      if (auth.code !== 0 || auth.timedOut) {
        block('GitHub CLI is missing or not authenticated in this execution backend');
      } else {
        const repoView = await this.commands.run(
          candidate.executionBackend,
          'gh',
          ['repo', 'view', '--repo', githubRepository(providerRepository), '--json', 'nameWithOwner'],
          { cwd: candidate.workspaceDir, timeoutMs: 30_000, maxBuffer: 256 * 1024 },
        );
        if (repoView.code !== 0 || repoView.timedOut
            || !sameProviderRepository(providerRepository, parseRepoView(repoView.stdout))) {
          block('GitHub CLI cannot access the origin repository');
        } else {
          candidate.pullRequest = await this.findPullRequest(
            candidate.executionBackend,
            candidate.workspaceDir!,
            providerRepository,
            candidate.headBranch,
          );
          if (candidate.pullRequest) {
            preview.ciStatus = candidate.pullRequest.ciStatus;
            if (!isExactDraftPullRequest(candidate.pullRequest, candidate)) {
              block('Publication branch already has a non-matching or non-draft Pull Request');
            }
          }
        }
      }

      candidate.title = publicationTitle(run);
      preview.title = candidate.title;
      candidate.body = publicationBody(run, preview, verificationResult);
    } catch (error) {
      block(`Publication preflight failed: ${errorMessage(error)}`);
    }

    preview.eligible = preview.reasons.length === 0;
    return candidate;
  }

  private async gitText(
    candidate: CandidateInspection,
    args: string[],
    timeoutMs = 120_000,
  ): Promise<string> {
    if (!candidate.workspaceDir || !candidate.executionBackend) {
      throw new Error('ade: publication Git scope is incomplete');
    }
    return this.commands.text(
      candidate.executionBackend,
      'git',
      ['-C', candidate.workspaceDir, ...args],
      { timeoutMs, maxBuffer: 4 * 1024 * 1024 },
    );
  }

  private async remoteBranchSha(
    backend: ExecutionBackendId,
    workspaceDir: string,
    branch: string,
  ): Promise<string | null> {
    const output = await this.commands.text(
      backend,
      'git',
      ['-C', workspaceDir, 'ls-remote', '--heads', REMOTE_NAME, `refs/heads/${branch}`],
      { timeoutMs: 30_000, maxBuffer: 256 * 1024 },
    );
    const sha = output.trim().split(/\s+/)[0] ?? '';
    if (!sha) return null;
    if (!GIT_OBJECT_ID.test(sha)) throw new Error('ade: origin returned an invalid branch object id');
    return sha;
  }

  private async assertRemoteBase(candidate: CandidateInspection): Promise<void> {
    if (!candidate.baseBranch || !candidate.baseSha) {
      throw new Error('ade: publication remote base is incomplete');
    }
    const current = parseRemoteDefaultHead(
      await this.gitText(candidate, ['ls-remote', '--symref', REMOTE_NAME, 'HEAD'], 30_000),
    );
    if (!current || current.branch !== candidate.baseBranch || current.sha !== candidate.baseSha) {
      throw new Error('ade: remote default branch moved during publication; Draft PR success was not recorded');
    }
  }

  private async findPullRequest(
    backend: ExecutionBackendId,
    workspaceDir: string,
    providerRepository: string,
    headBranch: string,
  ): Promise<PullRequestView | null> {
    const result = await this.commands.run(
      backend,
      'gh',
      [
        'pr', 'list', '--repo', githubRepository(providerRepository),
        '--state', 'all', '--head', headBranch, '--limit', '10',
        '--json', 'number,url,isDraft,state,baseRefName,headRefName,headRefOid,statusCheckRollup',
      ],
      { cwd: workspaceDir, timeoutMs: 30_000, maxBuffer: 1024 * 1024 },
    );
    if (result.code !== 0 || result.timedOut) {
      throw new Error('ade: GitHub CLI could not inspect existing Pull Requests');
    }
    return parsePullRequestList(result.stdout, headBranch);
  }

  private async viewPullRequest(
    backend: ExecutionBackendId,
    workspaceDir: string,
    providerRepository: string,
    url: string,
  ): Promise<PullRequestView> {
    const result = await this.checked(
      backend,
      'gh',
      [
        'pr', 'view', url, '--repo', githubRepository(providerRepository),
        '--json', 'number,url,isDraft,state,baseRefName,headRefName,headRefOid,statusCheckRollup',
      ],
      { cwd: workspaceDir, timeoutMs: 30_000, maxBuffer: 1024 * 1024 },
      'GitHub could not verify the created Draft PR',
    );
    const parsed = parsePullRequestJson(decodeOutput(result.stdout));
    if (!parsed) throw new Error('ade: GitHub returned an invalid Pull Request record');
    return parsed;
  }

  private async checked(
    backend: ExecutionBackendId,
    executable: string,
    args: string[],
    options: BackendCommandOptions,
    failure: string,
  ): Promise<BackendCommandResult> {
    const result = await this.commands.run(backend, executable, args, options);
    if (result.code === 0 && !result.timedOut) return result;
    const raw = decodeOutput(result.stderr).trim() || decodeOutput(result.stdout).trim();
    const detail = redactSensitiveText(raw).slice(0, 1_000);
    throw new Error(`ade: ${failure}${detail ? `: ${detail}` : ''}`);
  }

  private serialized<T>(runId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.chains.get(runId) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(operation);
    const marker = next.then(() => undefined, () => undefined);
    this.chains.set(runId, marker);
    void marker.finally(() => {
      if (this.chains.get(runId) === marker) this.chains.delete(runId);
    });
    return next;
  }
}

export function publicationBranch(run: Pick<Run, 'id' | 'name'>): string {
  const id = slug(run.id).slice(0, 8) || 'run';
  const name = slug(run.name).slice(0, 50) || 'verified';
  const branch = `ade/run-${id}-${name}`.replace(/[-/.]+$/, '');
  if (!PUBLICATION_BRANCH.test(branch) || branch.includes('..') || branch.includes('//')) {
    throw new Error('ade: generated publication branch is invalid');
  }
  return branch;
}

export function redactSensitiveText(value: string): string {
  return value
    .replace(/https?:\/\/[^/@\s]+:[^@/\s]+@/gi, 'https://[credentials]@')
    .replace(/\b(?:github_pat_[A-Za-z0-9_]+|gh[pousr]_[A-Za-z0-9_]+)\b/g, '[credential]')
    .replace(/\bauthorization\s*:\s*[^\r\n]+/gi, 'authorization: [credential]')
    .replace(/\bbearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [credential]')
    .replace(/\b(token|password|secret|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi, '$1=[credential]')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
}

function redactForPublication(value: string): string {
  return redactSensitiveText(value)
    .replace(/\b[A-Za-z]:\\[^\r\n]*/g, '[local-path]')
    .replace(/\\\\[^\r\n]*/g, '[local-path]')
    .replace(/(^|[\s"'`(=])\/(?!\/)[^\r\n]*/g, '$1[local-path]');
}

function markdownEvidence(value: string, max: number): string {
  return redactForPublication(value)
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/`/g, "'")
    .replace(/@/g, '＠')
    .replace(/[<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function slug(value: string): string {
  return value.normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9._/-]+/g, '-')
    .replace(/^[-./]+|[-./]+$/g, '')
    .replace(/\.{2,}/g, '.')
    .replace(/\/{2,}/g, '/');
}

function parseRemoteDefaultHead(value: string): { branch: string; sha: string } | null {
  const ref = value.split(/\r?\n/).find((line) => line.startsWith('ref: refs/heads/'));
  const head = value.split(/\r?\n/).find((line) => /\sHEAD$/.test(line) && !line.startsWith('ref:'));
  const branch = ref?.slice('ref: refs/heads/'.length).split(/\s/)[0] ?? '';
  const sha = head?.split(/\s/)[0] ?? '';
  if (!isSafeGitRefName(branch) || !GIT_OBJECT_ID.test(sha)) return null;
  return { branch, sha };
}

function parseRepoView(value: Buffer): string | null {
  try {
    const parsed = JSON.parse(decodeOutput(value)) as { nameWithOwner?: unknown };
    return typeof parsed.nameWithOwner === 'string' ? parsed.nameWithOwner : null;
  } catch {
    return null;
  }
}

function sameProviderRepository(expected: string, actual: string | null): boolean {
  return actual !== null && expected.toLowerCase() === actual.toLowerCase();
}

function parsePullRequestList(value: Buffer, headBranch: string): PullRequestView | null {
  try {
    const parsed = JSON.parse(decodeOutput(value));
    if (!Array.isArray(parsed)) return null;
    const matching = parsed.filter((item) => isRecord(item) && item.headRefName === headBranch);
    if (matching.length > 1) throw new Error('ade: multiple Pull Requests use the publication branch');
    return matching.length === 1 ? pullRequestFromRecord(matching[0]) : null;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('ade:')) throw error;
    throw new Error('ade: GitHub returned an invalid Pull Request list');
  }
}

function parsePullRequestJson(value: string): PullRequestView | null {
  try {
    const parsed = JSON.parse(value);
    return isRecord(parsed) ? pullRequestFromRecord(parsed) : null;
  } catch {
    return null;
  }
}

function pullRequestFromRecord(value: Record<string, unknown>): PullRequestView | null {
  const number = value.number;
  const url = value.url;
  const isDraft = value.isDraft;
  const state = value.state;
  const baseRefName = value.baseRefName;
  const headRefName = value.headRefName;
  const headRefOid = value.headRefOid;
  const safeUrl = typeof url === 'string' ? firstSafeGithubPullUrl(url) : null;
  if (!Number.isInteger(number) || (number as number) < 1
      || !safeUrl
      || typeof isDraft !== 'boolean' || typeof state !== 'string'
      || typeof baseRefName !== 'string' || typeof headRefName !== 'string'
      || typeof headRefOid !== 'string' || !GIT_OBJECT_ID.test(headRefOid)) return null;
  return {
    number: number as number,
    url: safeUrl,
    isDraft,
    state,
    baseRefName,
    headRefName,
    headRefOid,
    ciStatus: parseCiStatus(value.statusCheckRollup),
  };
}

function parseCiStatus(value: unknown): PublicationCiStatus {
  if (!Array.isArray(value) || value.length === 0) return 'none';
  let pending = false;
  for (const raw of value) {
    if (!isRecord(raw)) {
      pending = true;
      continue;
    }
    const status = String(raw.status ?? raw.state ?? '').toUpperCase();
    const conclusion = String(raw.conclusion ?? '').toUpperCase();
    if (['FAILURE', 'FAILED', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'STARTUP_FAILURE'].includes(conclusion)
        || ['ERROR', 'FAILURE'].includes(status)) return 'failed';
    if (!['COMPLETED', 'SUCCESS', 'NEUTRAL', 'SKIPPED'].includes(status)
        && !['SUCCESS', 'NEUTRAL', 'SKIPPED'].includes(conclusion)) pending = true;
  }
  return pending ? 'pending' : 'passed';
}

function isExactDraftPullRequest(pr: PullRequestView, candidate: CandidateInspection): boolean {
  return pr.isDraft
    && pr.state.toUpperCase() === 'OPEN'
    && pr.baseRefName === candidate.baseBranch
    && pr.headRefName === candidate.headBranch
    && pr.headRefOid === candidate.headSha
    && Boolean(candidate.providerRepository
      && safeGithubPullRequestUrl(pr.url, candidate.providerRepository, pr.number));
}

function assertExactDraftPullRequest(pr: PullRequestView, candidate: CandidateInspection): void {
  if (!isExactDraftPullRequest(pr, candidate)) {
    throw new Error('ade: created Pull Request is not an exact open Draft for the attested candidate');
  }
}

function isSafeGitRefName(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/.test(value)
    && !value.includes('..')
    && !value.includes('//')
    && !value.includes('@{')
    && !value.endsWith('/')
    && !value.endsWith('.')
    && !value.endsWith('.lock');
}

function publicationTitle(run: Pick<Run, 'name'>): string {
  const name = markdownEvidence(run.name, 140);
  return `ADE: ${name || 'verified change'}`;
}

function publicationBody(
  run: Run,
  preview: RunPublicationPreview,
  verification: RunTaskResult | undefined,
): string {
  const files = preview.changedFiles.map((file) => `- \`${markdownEvidence(file, 500)}\``);
  if (preview.changedFilesTruncated) files.push('- … additional files omitted from this bounded preview');
  const tests = verification?.tests.slice(0, 30).map((test) =>
    `- **${test.status}** \`${markdownEvidence(test.command, 300)}\``) ?? [];
  const risks = verification?.risks.slice(0, 20).map((risk) =>
    `- ${markdownEvidence(risk, 500)}`) ?? [];
  const goal = markdownEvidence(run.goal, 1_000);
  const runId = markdownEvidence(run.id, 200);
  return [
    '## ADE verified run',
    '',
    goal ? `**Goal:** ${goal}` : '',
    `- Run: \`${runId}\``,
    `- Base: \`${preview.baseBranch}\` at \`${preview.baseSha}\``,
    `- Verified head: \`${preview.headSha}\``,
    `- Commits: ${preview.commitCount}`,
    `- Changed files: ${preview.changedFiles.length}${preview.changedFilesTruncated ? '+' : ''}`,
    '',
    '### Final verification evidence',
    '',
    ...(tests.length ? tests : ['- No bounded command summary available.']),
    '',
    '### Changed files',
    '',
    ...(files.length ? files : ['- No files reported.']),
    '',
    '### Recorded risks',
    '',
    ...(risks.length ? risks : ['- No risks recorded by the final verifier.']),
    '',
    '> ADE created this as a Draft Pull Request after explicit operator confirmation. '
      + 'ADE did not update or merge the default branch; repository CI and human review remain authoritative.',
    '',
  ].filter((line, index, all) => line !== '' || all[index - 1] !== '').join('\n').slice(0, 30_000);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
