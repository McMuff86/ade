import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';
import type {
  AdeConfig,
  GitStatus,
  Repository,
  RunPublication,
} from '../src/shared/types';
import { DEFAULT_CONFIG } from '../src/shared/types';
import {
  NATIVE_EXECUTION_BACKEND,
  type ExecutionBackendId,
} from '../src/shared/executionBackends';
import {
  RepositoryInspectorService,
  parsePullRequestChecks,
  parseRepositoryPullRequests,
  summarizeCheckRollup,
  type RepositoryInspectorCommandPort,
  type RepositoryInspectorGitPort,
} from '../src/main/repositories/RepositoryInspectorService';
import { BackendGitService } from '../src/main/execution/BackendGitService';
import {
  ExecutionBackendService,
  type BackendCommandOptions,
  type BackendCommandResult,
} from '../src/main/execution/ExecutionBackendService';
import { assertIpcPayload } from '../src/main/ipcValidation';

let passed = 0;
let failed = 0;

function check(name: string, condition: boolean, detail?: unknown): void {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failed += 1;
    console.error(`  FAIL  ${name}`, detail ?? '');
  }
}

function git(cwd: string, args: string[]): string {
  return execFileSync('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    windowsHide: true,
  }).trim();
}

function result(
  stdout: string,
  options: { code?: number | null; stderr?: string; timedOut?: boolean } = {},
): BackendCommandResult {
  return {
    code: options.code === undefined ? 0 : options.code,
    signal: null,
    stdout: Buffer.from(stdout),
    stderr: Buffer.from(options.stderr ?? ''),
    timedOut: options.timedOut ?? false,
  };
}

function rollupFixture(): Array<Record<string, unknown>> {
  return [
    { __typename: 'CheckRun', name: 'build', status: 'COMPLETED', conclusion: 'SUCCESS' },
    { __typename: 'CheckRun', name: 'tests', status: 'COMPLETED', conclusion: 'FAILURE' },
    { __typename: 'StatusContext', context: 'lint', state: 'PENDING' },
    { __typename: 'CheckRun', name: 'docs', status: 'COMPLETED', conclusion: 'SKIPPED' },
  ];
}

function prFixture(number = 12): Record<string, unknown> {
  return {
    number,
    title: 'Inspector fixture Pull Request',
    url: `https://github.com/ade-e2e/inspector/pull/${number}`,
    author: { login: 'octo-reviewer' },
    isDraft: false,
    updatedAt: '2026-07-19T12:00:00Z',
    headRefName: 'ade/inspector',
    baseRefName: 'main',
    reviewDecision: 'REVIEW_REQUIRED',
    changedFiles: 3,
    additions: 14,
    deletions: 2,
    statusCheckRollup: rollupFixture(),
  };
}

function checksViewFixture(number = 12): Record<string, unknown> {
  return {
    number,
    url: `https://github.com/ade-e2e/inspector/pull/${number}`,
    statusCheckRollup: rollupFixture(),
  };
}

class GithubFixtureCommands implements RepositoryInspectorCommandPort {
  private readonly execution = new ExecutionBackendService();
  ghMode: 'valid' | 'malformed' | 'failed' | 'timeout' = 'valid';
  viewMode: 'valid' | 'wrong-number' | 'foreign-url' | 'malformed-rollup' = 'valid';
  ghCalls: Array<{ backend: ExecutionBackendId | undefined; args: string[]; options?: BackendCommandOptions }> = [];

  samePath(backend: ExecutionBackendId | undefined, left: string, right: string): boolean {
    return this.execution.samePath(backend, left, right);
  }

  async run(
    backend: ExecutionBackendId | undefined,
    executable: string,
    args: string[],
    options?: BackendCommandOptions,
  ): Promise<BackendCommandResult> {
    if (executable !== 'gh') return this.execution.run(backend, executable, args, options);
    this.ghCalls.push({ backend, args: [...args], options });
    if (this.ghMode === 'failed') {
      return result('', {
        code: 1,
        stderr: 'authorization: Bearer ghp_super_secret_fixture',
      });
    }
    if (this.ghMode === 'timeout') return result('', { code: null, timedOut: true });
    if (args[0] === 'pr' && args[1] === 'view') {
      if (this.viewMode === 'wrong-number') return result(JSON.stringify(checksViewFixture(99)));
      if (this.viewMode === 'foreign-url') {
        return result(JSON.stringify({
          ...checksViewFixture(),
          url: 'https://github.com/other/repository/pull/12',
        }));
      }
      if (this.viewMode === 'malformed-rollup') {
        return result(JSON.stringify({ ...checksViewFixture(), statusCheckRollup: ['broken'] }));
      }
      return result(JSON.stringify(checksViewFixture()));
    }
    if (this.ghMode === 'malformed') {
      return result(JSON.stringify([{ ...prFixture(), url: 'https://evil.invalid/pull/12' }]));
    }
    return result(JSON.stringify([prFixture()]));
  }
}

async function testRealRepository(scratch: string): Promise<void> {
  const root = join(scratch, 'repository');
  mkdirSync(root, { recursive: true });
  git(root, ['init', '--initial-branch=main']);
  git(root, ['config', 'user.email', 'inspector@example.invalid']);
  git(root, ['config', 'user.name', 'Inspector Fixture']);
  writeFileSync(join(root, 'README.md'), '# Inspector fixture\n', 'utf8');
  git(root, ['add', 'README.md']);
  git(root, ['commit', '-m', 'Initial inspector fixture']);
  writeFileSync(join(root, 'history.txt'), 'bounded history\n', 'utf8');
  git(root, ['add', 'history.txt']);
  git(root, ['commit', '-m', 'Add bounded history']);
  writeFileSync(join(root, 'large.txt'), `large diff\n${'x'.repeat(1_100_000)}\n`, 'utf8');
  git(root, ['add', 'large.txt']);
  git(root, ['commit', '-m', 'Add large diff fixture']);
  const headSha = git(root, ['rev-parse', 'HEAD']);
  git(root, ['remote', 'add', 'origin', 'https://github.com/ade-e2e/inspector.git']);
  writeFileSync(join(root, 'dirty.txt'), 'one\ntwo\n', 'utf8');

  const execution = new ExecutionBackendService();
  const backendGit = new BackendGitService(execution);
  const identity = await backendGit.identity(NATIVE_EXECUTION_BACKEND, root);
  const repository: Repository = {
    id: 'inspector-repository',
    name: 'Inspector repository',
    rootPath: identity.rootPath,
    commonGitDir: identity.commonGitDir,
    executionBackend: NATIVE_EXECUTION_BACKEND,
    verified: true,
    createdAt: Date.now(),
  };
  const config: AdeConfig = {
    ...structuredClone(DEFAULT_CONFIG),
    repositories: [repository],
  };
  const store = { get: (): AdeConfig => config };
  const inspector = new RepositoryInspectorService(store, { commands: execution, git: backendGit });
  const overview = await inspector.overview(repository.id);

  check('overview resolves the verified repository identity and branch',
    overview.repositoryId === repository.id
      && overview.repositoryName === repository.name
      && overview.branch === 'main'
      && overview.headSha === headSha);
  check('overview reports dirty local state without a remote fetch',
    overview.changedFiles === 1 && overview.additions === 2 && overview.deletions === 0);
  check('overview returns bounded newest-first commit history',
    overview.commits.length === 3
      && overview.commits[0]?.sha === headSha
      && overview.commits[0]?.subject === 'Add large diff fixture'
      && overview.commits[2]?.subject === 'Initial inspector fixture');
  check('overview exposes only credential-free GitHub repository identity',
    overview.remote.kind === 'github'
      && overview.remote.providerRepository === 'ade-e2e/inspector');

  const diff = await inspector.commitDiff(repository.id, headSha);
  check('commit detail verifies the exact full object id and returns file metadata',
    diff.commitSha === headSha
      && diff.title === 'Add large diff fixture'
      && diff.files.some((file) => file.path === 'large.txt'));
  check('commit detail caps a large patch and reports truncation truthfully',
    diff.truncated && Buffer.byteLength(diff.diff) <= 1_048_700, Buffer.byteLength(diff.diff));

  let shortRejected = false;
  try {
    await inspector.commitDiff(repository.id, headSha.slice(0, 10));
  } catch {
    shortRejected = true;
  }
  let unknownRejected = false;
  try {
    await inspector.commitDiff(repository.id, 'f'.repeat(40));
  } catch {
    unknownRejected = true;
  }
  check('commit detail rejects abbreviated and unknown object ids', shortRejected && unknownRejected);

  const commands = new GithubFixtureCommands();
  const providerInspector = new RepositoryInspectorService(store, { commands, git: backendGit });
  const prs = await providerInspector.pullRequests(repository.id);
  check('GitHub read returns bounded normalized Pull Request metadata',
    prs.status === 'ready'
      && prs.providerRepository === 'ade-e2e/inspector'
      && prs.pullRequests[0]?.number === 12
      && prs.pullRequests[0]?.reviewDecision === 'review-required');
  const ghCall = commands.ghCalls[0];
  check('GitHub read is host-qualified, read-only, capped and rooted in the repository',
    ghCall?.backend === NATIVE_EXECUTION_BACKEND
      && ghCall.args.includes('github.com/ade-e2e/inspector')
      && ghCall.args.includes('open')
      && ghCall.args.some((arg) => arg.includes('statusCheckRollup'))
      && ghCall.options?.cwd === repository.rootPath
      && ghCall.options.maxBuffer === 1024 * 1024
      && ghCall.options.timeoutMs === 15_000);
  check('PR list carries a bounded CI rollup summary instead of raw provider checks',
    prs.pullRequests[0]?.ci.state === 'failed'
      && prs.pullRequests[0]?.ci.total === 4
      && prs.pullRequests[0]?.ci.failed === 1
      && prs.pullRequests[0]?.ci.pending === 1
      && prs.pullRequests[0]?.adePublication === null);

  const publication: RunPublication = {
    id: 'publication-1',
    runId: 'run-1',
    repositoryId: repository.id,
    provider: 'github',
    providerRepository: 'ADE-E2E/Inspector',
    remoteName: 'origin',
    baseBranch: 'main',
    headBranch: 'ade/inspector',
    baseSha: 'a'.repeat(40),
    headSha: 'b'.repeat(40),
    status: 'draft',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    prNumber: 12,
    prUrl: 'https://github.com/ade-e2e/inspector/pull/12',
  };
  config.runPublications = [publication];
  const linkedByNumber = await providerInspector.pullRequests(repository.id);
  check('open PRs link back to the ADE publication and run by exact PR number',
    linkedByNumber.pullRequests[0]?.adePublication?.runId === 'run-1'
      && linkedByNumber.pullRequests[0]?.adePublication?.publicationId === 'publication-1'
      && linkedByNumber.pullRequests[0]?.adePublication?.status === 'draft');
  const { prNumber: _unusedNumber, ...unnumberedPublication } = publication;
  config.runPublications = [{ ...unnumberedPublication, status: 'publishing' }];
  const linkedByBranch = await providerInspector.pullRequests(repository.id);
  check('a not-yet-numbered publication attempt still links through its ADE branch',
    linkedByBranch.pullRequests[0]?.adePublication?.status === 'publishing');
  config.runPublications = [
    { ...publication, repositoryId: 'someone-else', prNumber: 12 },
    { ...publication, id: 'p2', providerRepository: 'other/repository', prNumber: 12 },
    { ...publication, id: 'p3', prNumber: 500, headBranch: 'ade/unrelated' },
  ];
  const unlinked = await providerInspector.pullRequests(repository.id);
  check('foreign repositories, providers and branches never claim a PR link',
    unlinked.pullRequests[0]?.adePublication === null);
  config.runPublications = [];

  const checksCallIndex = commands.ghCalls.length;
  const checks = await providerInspector.pullRequestChecks(repository.id, 12);
  const checksCall = commands.ghCalls[checksCallIndex];
  check('on-demand PR checks return bounded named states without provider URLs',
    checks.status === 'ready'
      && checks.pullRequestNumber === 12
      && checks.checks.length === 4
      && checks.checks[0]?.name === 'build' && checks.checks[0]?.state === 'passed'
      && checks.checks[1]?.name === 'tests' && checks.checks[1]?.state === 'failed'
      && checks.checks[2]?.name === 'lint' && checks.checks[2]?.state === 'pending'
      && checks.checks[3]?.name === 'docs' && checks.checks[3]?.state === 'skipped'
      && !checks.checksTruncated
      && !JSON.stringify(checks).includes('http'));
  check('the checks read is an exact numbered, host-qualified, capped gh view',
    checksCall?.args[0] === 'pr' && checksCall.args[1] === 'view'
      && checksCall.args[2] === '12'
      && checksCall.args.includes('github.com/ade-e2e/inspector')
      && checksCall.options?.cwd === repository.rootPath
      && checksCall.options.maxBuffer === 1024 * 1024
      && checksCall.options.timeoutMs === 15_000);

  commands.viewMode = 'wrong-number';
  const wrongNumber = await providerInspector.pullRequestChecks(repository.id, 12);
  commands.viewMode = 'foreign-url';
  const foreignUrl = await providerInspector.pullRequestChecks(repository.id, 12);
  commands.viewMode = 'malformed-rollup';
  const malformedRollup = await providerInspector.pullRequestChecks(repository.id, 12);
  commands.viewMode = 'valid';
  check('checks fail closed on wrong number, foreign URL or malformed rollup',
    wrongNumber.status === 'unavailable'
      && foreignUrl.status === 'unavailable'
      && malformedRollup.status === 'unavailable'
      && [wrongNumber, foreignUrl, malformedRollup]
        .every((value) => value.checks.length === 0));
  let invalidNumberRejected = false;
  try {
    await providerInspector.pullRequestChecks(repository.id, 1.5);
  } catch {
    invalidNumberRejected = true;
  }
  check('checks reject non-integer PR numbers before any provider call', invalidNumberRejected);

  commands.ghMode = 'malformed';
  const malformed = await providerInspector.pullRequests(repository.id);
  check('unsafe provider URLs fail closed without exposing a clickable record',
    malformed.status === 'unavailable' && malformed.pullRequests.length === 0);

  commands.ghMode = 'failed';
  const unavailable = await providerInspector.pullRequests(repository.id);
  check('provider failures expose an actionable state without credential text',
    unavailable.status === 'unavailable'
      && unavailable.message?.includes('Diagnostics') === true
      && !JSON.stringify(unavailable).includes('super_secret'));

  commands.ghMode = 'timeout';
  const timedOut = await providerInspector.pullRequests(repository.id);
  check('provider timeout remains independent from the local overview',
    timedOut.status === 'unavailable' && timedOut.message?.includes('timed out') === true);

  const ghCallsBeforeUnsupported = commands.ghCalls.length;
  git(root, ['remote', 'set-url', 'origin', 'https://gitlab.com/ade-e2e/inspector.git']);
  const unsupported = await providerInspector.pullRequests(repository.id);
  const unsupportedChecks = await providerInspector.pullRequestChecks(repository.id, 12);
  check('non-GitHub origin returns unsupported without invoking gh',
    unsupported.status === 'unsupported'
      && unsupportedChecks.status === 'unsupported'
      && commands.ghCalls.length === ghCallsBeforeUnsupported);
}

async function testBackendPropagation(): Promise<void> {
  const backend = 'wsl:Ubuntu' as ExecutionBackendId;
  const repository: Repository = {
    id: 'wsl-inspector',
    name: 'WSL inspector',
    rootPath: '/home/ade/repository',
    commonGitDir: '/home/ade/repository/.git',
    executionBackend: backend,
    verified: true,
    createdAt: Date.now(),
  };
  const config: AdeConfig = { ...structuredClone(DEFAULT_CONFIG), repositories: [repository] };
  const seen: Array<{ backend: ExecutionBackendId | undefined; executable: string; args: string[]; cwd?: string }> = [];
  const commands: RepositoryInspectorCommandPort = {
    samePath: (_backend, left, right) => left === right,
    run: async (selectedBackend, executable, args, options) => {
      seen.push({ backend: selectedBackend, executable, args, cwd: options?.cwd });
      if (executable === 'git') return result('https://github.com/ade-e2e/inspector.git\n');
      return result(JSON.stringify([prFixture()]));
    },
  };
  const status: GitStatus = { isRepo: true, branch: 'main', ahead: 0, behind: 0, files: [] };
  const gitPort: RepositoryInspectorGitPort = {
    identity: async () => ({ rootPath: repository.rootPath, commonGitDir: repository.commonGitDir }),
    status: async () => status,
    showCommit: async () => ({ title: '', files: [], diff: '' }),
  };
  const inspector = new RepositoryInspectorService({ get: () => config }, { commands, git: gitPort });
  const prs = await inspector.pullRequests(repository.id);
  check('repository PR reads stay inside the selected WSL backend',
    prs.status === 'ready'
      && seen.length === 2
      && seen.every((call) => call.backend === backend)
      && seen.find((call) => call.executable === 'gh')?.cwd === repository.rootPath);
}

function testStrictProviderAndIpcParsing(): void {
  let unsafeRejected = false;
  try {
    parseRepositoryPullRequests(
      JSON.stringify([{ ...prFixture(), url: 'https://github.com/other/repository/pull/12' }]),
      'ade-e2e/inspector',
    );
  } catch {
    unsafeRejected = true;
  }
  let overflowRejected = false;
  try {
    parseRepositoryPullRequests(
      JSON.stringify(Array.from({ length: 21 }, (_, index) => prFixture(index + 1))),
      'ade-e2e/inspector',
    );
  } catch {
    overflowRejected = true;
  }
  check('provider parser rejects repository mismatch and oversized responses',
    unsafeRejected && overflowRejected);

  const emptyRollup = summarizeCheckRollup(undefined);
  const passedRollup = summarizeCheckRollup([
    { status: 'COMPLETED', conclusion: 'SUCCESS' },
    { state: 'SUCCESS' },
    { status: 'COMPLETED', conclusion: 'SKIPPED' },
  ]);
  const pendingRollup = summarizeCheckRollup([
    { status: 'QUEUED', conclusion: '' },
    { status: 'COMPLETED', conclusion: 'SUCCESS' },
  ]);
  const malformedEntryRollup = summarizeCheckRollup(['not-a-check']);
  check('rollup summaries stay conservative: unknown counts as pending, failures win',
    emptyRollup.state === 'none' && emptyRollup.total === 0
      && passedRollup.state === 'passed' && passedRollup.total === 3
      && pendingRollup.state === 'pending' && pendingRollup.pending === 1
      && malformedEntryRollup.state === 'pending');

  const oversizedChecks = parsePullRequestChecks(
    JSON.stringify({
      ...checksViewFixture(),
      statusCheckRollup: Array.from({ length: 150 }, (_, index) => ({
        __typename: 'CheckRun',
        name: `check-${index}`,
        status: 'COMPLETED',
        conclusion: 'SUCCESS',
      })),
    }),
    'ade-e2e/inspector',
    12,
  );
  const nullRollupChecks = parsePullRequestChecks(
    JSON.stringify({ ...checksViewFixture(), statusCheckRollup: null }),
    'ade-e2e/inspector',
    12,
  );
  let checksMismatchRejected = false;
  try {
    parsePullRequestChecks(JSON.stringify(checksViewFixture(13)), 'ade-e2e/inspector', 12);
  } catch {
    checksMismatchRejected = true;
  }
  check('check parsing caps at 100 named checks and stays exact about identity',
    oversizedChecks.checks.length === 100
      && oversizedChecks.checksTruncated
      && nullRollupChecks.checks.length === 0
      && !nullRollupChecks.checksTruncated
      && checksMismatchRejected);

  let extraRejected = false;
  try {
    assertIpcPayload('repository:overview', { repositoryId: 'repo', path: 'C:\\secret' });
  } catch {
    extraRejected = true;
  }
  let shortRejected = false;
  try {
    assertIpcPayload('repository:commitDiff', { repositoryId: 'repo', commitSha: 'abc123' });
  } catch {
    shortRejected = true;
  }
  let shellRejected = false;
  try {
    assertIpcPayload('repository:commitDiff', {
      repositoryId: 'repo',
      commitSha: `${'a'.repeat(40)}; git push`,
    });
  } catch {
    shellRejected = true;
  }
  let partialFullRejected = false;
  try {
    assertIpcPayload('repository:commitDiff', {
      repositoryId: 'repo',
      commitSha: 'a'.repeat(41),
    });
  } catch {
    partialFullRejected = true;
  }
  let validAccepted = true;
  try {
    assertIpcPayload('repository:overview', { repositoryId: 'repo' });
    assertIpcPayload('repository:pullRequests', { repositoryId: 'repo' });
    assertIpcPayload('repository:commitDiff', {
      repositoryId: 'repo',
      commitSha: 'a'.repeat(40),
    });
    assertIpcPayload('repository:pullRequestChecks', {
      repositoryId: 'repo',
      pullRequestNumber: 42,
    });
  } catch {
    validAccepted = false;
  }
  check('inspector IPC accepts only repository ids and full lowercase object ids',
    extraRejected && shortRejected && shellRejected && partialFullRejected && validAccepted);

  const invalidCheckPayloads: unknown[] = [
    { repositoryId: 'repo' },
    { repositoryId: 'repo', pullRequestNumber: 0 },
    { repositoryId: 'repo', pullRequestNumber: -3 },
    { repositoryId: 'repo', pullRequestNumber: 1.5 },
    { repositoryId: 'repo', pullRequestNumber: '42' },
    { repositoryId: 'repo', pullRequestNumber: 1_000_000_001 },
    { repositoryId: 'repo', pullRequestNumber: 42, extra: true },
  ];
  const allChecksPayloadsRejected = invalidCheckPayloads.every((payload) => {
    try {
      assertIpcPayload('repository:pullRequestChecks', payload);
      return false;
    } catch {
      return true;
    }
  });
  check('checks IPC rejects missing, fractional, string, oversized and extra fields',
    allChecksPayloadsRejected);
}

async function run(): Promise<void> {
  const scratch = mkdtempSync(join(tmpdir(), 'ade-repository-inspector-'));
  try {
    await testRealRepository(scratch);
    await testBackendPropagation();
    testStrictProviderAndIpcParsing();
  } finally {
    const safeRoot = resolve(tmpdir());
    const safeScratch = resolve(scratch);
    if (dirname(safeScratch) === safeRoot
        && basename(safeScratch).startsWith('ade-repository-inspector-')
        && safeScratch.startsWith(`${safeRoot}${sep}`)) {
      rmSync(safeScratch, { recursive: true, force: true });
    }
  }
  console.log(`\n${failed ? 'FAILED' : 'PASSED'} - ${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
}

void run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
