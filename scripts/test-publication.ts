import { execFileSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ExecutionBackendService, type BackendCommandOptions, type BackendCommandResult } from '../src/main/execution/ExecutionBackendService';
import { OrchestrationService } from '../src/main/orchestration/OrchestrationService';
import { WorkspaceService } from '../src/main/orchestration/WorkspaceService';
import {
  PublicationService,
  parseGithubRepository,
  publicationBranch,
  redactSensitiveText,
  type PublicationCommandPort,
} from '../src/main/publishing/PublicationService';
import { NATIVE_EXECUTION_BACKEND, type ExecutionBackendId } from '../src/shared/executionBackends';
import {
  DEFAULT_CONFIG,
  type AdeConfig,
  type Run,
} from '../src/shared/types';

let passed = 0;
let failed = 0;

function check(label: string, condition: unknown, detail?: unknown): void {
  if (condition) {
    passed += 1;
    console.log(`  ok  ${label}`);
  } else {
    failed += 1;
    console.error(`FAIL  ${label}`, detail ?? '');
  }
}

class MemoryStore {
  constructor(public config: AdeConfig) {}

  get(): AdeConfig {
    return this.config;
  }

  save(partial: Partial<AdeConfig>): AdeConfig {
    this.config = { ...this.config, ...structuredClone(partial) };
    return this.config;
  }
}

interface FakeGithubOptions {
  providerRepository: string;
  baseBranch: string;
  headBranch: string;
  headSha: string;
  authenticated?: boolean;
  failCreateOnceWith?: string;
  pullRepository?: string;
  isDraft?: boolean;
  onPrCreate?: () => void;
}

class FakeGithubCommands implements PublicationCommandPort {
  private readonly native = new ExecutionBackendService();
  createCalls = 0;
  body = '';
  repositorySelectors: string[] = [];
  private prCreated = false;
  private failCreateOnceWith: string | undefined;

  constructor(private readonly options: FakeGithubOptions) {
    this.failCreateOnceWith = options.failCreateOnceWith;
  }

  samePath(backend: ExecutionBackendId | undefined, left: string, right: string): boolean {
    return this.native.samePath(backend, left, right);
  }

  text(
    backend: ExecutionBackendId | undefined,
    executable: string,
    args: string[],
    options?: BackendCommandOptions,
  ): Promise<string> {
    return this.native.text(backend, executable, args, options);
  }

  run(
    backend: ExecutionBackendId | undefined,
    executable: string,
    args: string[],
    options: BackendCommandOptions = {},
  ): Promise<BackendCommandResult> {
    if (executable !== 'gh') return this.native.run(backend, executable, args, options);
    const repositoryIndex = args.indexOf('--repo');
    if (repositoryIndex >= 0 && args[repositoryIndex + 1]) {
      this.repositorySelectors.push(args[repositoryIndex + 1]!);
    }
    if (args[0] === 'auth' && args[1] === 'status') {
      return Promise.resolve(this.options.authenticated === false
        ? result(1, '', 'not authenticated')
        : result(0, 'authenticated\n'));
    }
    if (args[0] === 'repo' && args[1] === 'view') {
      return Promise.resolve(result(0, JSON.stringify({ nameWithOwner: this.options.providerRepository })));
    }
    if (args[0] === 'pr' && args[1] === 'list') {
      return Promise.resolve(result(0, JSON.stringify(this.prCreated ? [this.pullRequest()] : [])));
    }
    if (args[0] === 'pr' && args[1] === 'create') {
      this.createCalls += 1;
      this.options.onPrCreate?.();
      this.body = typeof options.input === 'string'
        ? options.input
        : Buffer.isBuffer(options.input) ? options.input.toString('utf8') : '';
      if (this.failCreateOnceWith) {
        const detail = this.failCreateOnceWith;
        this.failCreateOnceWith = undefined;
        return Promise.resolve(result(1, '', detail));
      }
      this.prCreated = true;
      return Promise.resolve(result(0, `${this.pullRequest().url}\n`));
    }
    if (args[0] === 'pr' && args[1] === 'view') {
      return Promise.resolve(result(0, JSON.stringify(this.pullRequest())));
    }
    return Promise.resolve(result(1, '', `unsupported fake gh args: ${args.join(' ')}`));
  }

  private pullRequest(): Record<string, unknown> {
    return {
      number: 17,
      url: `https://github.com/${this.options.pullRepository ?? this.options.providerRepository}/pull/17`,
      isDraft: this.options.isDraft ?? true,
      state: 'OPEN',
      baseRefName: this.options.baseBranch,
      headRefName: this.options.headBranch,
      headRefOid: this.options.headSha,
      statusCheckRollup: [{ name: 'CI', status: 'IN_PROGRESS', conclusion: '' }],
    };
  }
}

interface Fixture {
  root: string;
  repository: string;
  remote: string;
  workspace: string;
  baseSha: string;
  headSha: string;
  run: Run;
  store: MemoryStore;
  orchestration: OrchestrationService;
}

function fixture(label: string): Fixture {
  const root = mkdtempSync(join(tmpdir(), `ade-publish-${label}-`));
  const repository = join(root, 'repository');
  const remote = join(root, 'remote.git');
  const workspace = join(root, 'orchestrator');
  mkdirSync(repository, { recursive: true });
  git(repository, ['init']);
  git(repository, ['branch', '-M', 'main']);
  git(repository, ['config', 'user.email', 'ade-publication@example.invalid']);
  git(repository, ['config', 'user.name', 'ADE publication test']);
  writeFileSync(join(repository, 'README.md'), '# fixture\n', 'utf8');
  git(repository, ['add', 'README.md']);
  git(repository, ['commit', '-m', 'fixture base']);
  const baseSha = git(repository, ['rev-parse', 'HEAD']).trim();

  git(root, ['init', '--bare', remote]);
  gitBare(remote, ['symbolic-ref', 'HEAD', 'refs/heads/main']);
  const githubUrl = 'https://github.com/ade-publication-tests/fixture.git';
  git(repository, ['remote', 'add', 'origin', githubUrl]);
  const localRemoteUrl = pathToFileURL(remote).toString();
  git(repository, ['config', `url.${localRemoteUrl}.insteadOf`, githubUrl]);
  git(repository, ['push', '-u', 'origin', 'main']);

  git(repository, ['worktree', 'add', '-b', 'ade/orchestrator', workspace, 'main']);
  git(workspace, ['config', 'user.email', 'ade-publication@example.invalid']);
  git(workspace, ['config', 'user.name', 'ADE publication test']);
  writeFileSync(join(workspace, 'feature.txt'), 'verified feature\n', 'utf8');
  git(workspace, ['add', 'feature.txt']);
  git(workspace, ['commit', '-m', 'verified feature']);
  const headSha = git(workspace, ['rev-parse', 'HEAD']).trim();
  const commonGitDir = git(workspace, ['rev-parse', '--path-format=absolute', '--git-common-dir']).trim();
  const now = Date.now();
  const run: Run = {
    id: `run-${label}-12345678`,
    name: `Verified ${label}`,
    goal: 'Publish a verified fixture without touching main.',
    status: 'completed',
    mode: 'managed',
    phase: 'completed',
    budget: { maxConcurrentTasks: 1, maxInputTokens: null, maxOutputTokens: null, maxCostUsd: null, maxApprovals: 1 },
    repositoryId: 'repository',
    verifiedHeadSha: headSha,
    verificationTaskId: 'verify-task',
    verifiedAt: now,
    createdAt: now - 1000,
    updatedAt: now,
  };
  const config: AdeConfig = {
    ...structuredClone(DEFAULT_CONFIG),
    repositories: [{
      id: 'repository',
      name: 'Fixture',
      rootPath: repository,
      commonGitDir,
      executionBackend: NATIVE_EXECUTION_BACKEND,
      verified: true,
      createdAt: now,
    }],
    runs: [run],
    runParticipants: [{
      id: 'orchestrator-participant',
      runId: run.id,
      agentId: 'orchestrator',
      agentName: 'Orchestrator',
      runtime: 'codex',
      role: 'orchestrator',
      repositoryId: 'repository',
      createdAt: now,
    }],
    runTasks: [{
      id: 'verify-task',
      runId: run.id,
      participantId: 'orchestrator-participant',
      prompt: 'Verify',
      title: 'Verify final result',
      phase: 'verify',
      managed: true,
      dependsOn: [],
      attempt: 1,
      status: 'completed',
      repositoryId: 'repository',
      workspaceDir: workspace,
      expectedHeadSha: headSha,
      createdAt: now,
      updatedAt: now,
      endedAt: now,
    }],
    runTaskResults: [{
      id: 'verify-result',
      runId: run.id,
      taskId: 'verify-task',
      participantId: 'orchestrator-participant',
      adapterId: 'codex-json-v1',
      resultPath: join(root, 'RESULT.json'),
      version: 1,
      outcome: 'succeeded',
      summary: 'Final verification passed.',
      assignments: [],
      filesChanged: [],
      tests: [{ command: `pnpm test --cwd ${root}`, status: 'passed', output: 'ok' }],
      commitSha: null,
      risks: ['Human product review remains required.'],
      usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 },
      createdAt: now,
    }],
    runApprovals: [{
      id: 'approval',
      runId: run.id,
      type: 'integration',
      status: 'approved',
      reason: 'Verified fixture integration',
      requestedAt: now - 500,
      resolvedAt: now - 400,
    }],
    runWorkspaceLeases: [{
      id: 'lease',
      runId: run.id,
      participantId: 'orchestrator-participant',
      agentId: 'orchestrator',
      workspaceDir: workspace,
      isRepo: true,
      branch: 'ade/orchestrator',
      baseSha,
      commonGitDir,
      repositoryId: 'repository',
      status: 'released',
      acquiredAt: now - 900,
      releasedAt: now,
    }],
  };
  const store = new MemoryStore(config);
  return {
    root,
    repository,
    remote,
    workspace,
    baseSha,
    headSha,
    run,
    store,
    orchestration: new OrchestrationService(store),
  };
}

function serviceFor(item: Fixture, commands: FakeGithubCommands): PublicationService {
  return new PublicationService(item.store, item.orchestration, new WorkspaceService(), commands);
}

async function successfulPublication(): Promise<void> {
  console.log('\n== verified publication ==');
  const item = fixture('success');
  try {
    const headBranch = publicationBranch(item.run);
    const commands = new FakeGithubCommands({
      providerRepository: 'ade-publication-tests/fixture',
      baseBranch: 'main',
      headBranch,
      headSha: item.headSha,
    });
    const service = serviceFor(item, commands);
    const preview = await service.preview(item.run.id);
    check('completed attested run is eligible', preview.eligible, preview.reasons);
    check('preview binds exact base/head and a generated ade/** ref',
      preview.baseSha === item.baseSha
      && preview.headSha === item.headSha
      && preview.headBranch === headBranch
      && headBranch.startsWith('ade/run-'));
    check('preview reports bounded verifier evidence and redacts local paths',
      preview.verificationCommands.length === 1
      && !preview.verificationCommands[0]!.includes(item.root));

    const publication = await service.publish({
      runId: item.run.id,
      expectedHeadSha: item.headSha,
      expectedHeadBranch: headBranch,
      commandId: 'publish-success',
    });
    check('publisher persists only a Draft PR and host-qualifies every provider target',
      publication.status === 'draft'
      && publication.prNumber === 17
      && publication.prUrl === 'https://github.com/ade-publication-tests/fixture/pull/17'
      && commands.repositorySelectors.length >= 4
      && commands.repositorySelectors.every(
        (repository) => repository === 'github.com/ade-publication-tests/fixture'));
    check('real Git push created the exact attested remote ref',
      gitBare(item.remote, ['rev-parse', `refs/heads/${headBranch}`]).trim() === item.headSha);
    check('publication audit records request and completion',
      item.store.get().runEvents.some((event) => event.type === 'publication.requested')
      && item.store.get().runEvents.some((event) => event.type === 'publication.completed'));
    check('generated PR evidence excludes absolute host paths and main-merge claims',
      commands.body.includes('ADE verified run')
      && commands.body.includes('ADE did not update or merge the default branch')
      && !commands.body.includes(item.root));

    const replayed = await service.publish({
      runId: item.run.id,
      expectedHeadSha: item.headSha,
      expectedHeadBranch: headBranch,
      commandId: 'publish-success',
    });
    check('same command id replays without a second external PR mutation',
      replayed.id === publication.id && commands.createCalls === 1);
    let deletionBlocked = false;
    try {
      item.orchestration.deleteRun(item.run.id);
    } catch {
      deletionBlocked = true;
    }
    check('published run cannot discard its durable external audit by deletion',
      deletionBlocked && item.store.get().runs.some((run) => run.id === item.run.id));
  } finally {
    rmSync(item.root, { recursive: true, force: true });
  }
}

async function negativeControls(): Promise<void> {
  console.log('\n== fail-closed publication controls ==');

  const stale = fixture('stale');
  try {
    writeFileSync(join(stale.repository, 'remote-change.txt'), 'new base\n', 'utf8');
    git(stale.repository, ['add', 'remote-change.txt']);
    git(stale.repository, ['commit', '-m', 'remote main moved']);
    git(stale.repository, ['push', 'origin', 'main']);
    const commands = fakeFor(stale);
    const preview = await serviceFor(stale, commands).preview(stale.run.id);
    check('moved remote main invalidates old verification evidence',
      !preview.eligible && preview.reasons.some((reason) => reason.includes('moved')),
      preview.reasons);
  } finally {
    rmSync(stale.root, { recursive: true, force: true });
  }

  const dirty = fixture('dirty');
  try {
    writeFileSync(join(dirty.workspace, 'uncommitted.txt'), 'dirty\n', 'utf8');
    const preview = await serviceFor(dirty, fakeFor(dirty)).preview(dirty.run.id);
    check('dirty verified worktree is rejected',
      !preview.eligible && preview.reasons.some((reason) => reason.includes('uncommitted')),
      preview.reasons);
  } finally {
    rmSync(dirty.root, { recursive: true, force: true });
  }

  const movedDuringPublish = fixture('moved-during-publish');
  try {
    const headBranch = publicationBranch(movedDuringPublish.run);
    const commands = fakeFor(movedDuringPublish, {
      onPrCreate: () => {
        writeFileSync(join(movedDuringPublish.repository, 'concurrent-main.txt'), 'new base\n', 'utf8');
        git(movedDuringPublish.repository, ['add', 'concurrent-main.txt']);
        git(movedDuringPublish.repository, ['commit', '-m', 'main moved during publication']);
        git(movedDuringPublish.repository, ['push', 'origin', 'main']);
      },
    });
    let rejected = false;
    try {
      await serviceFor(movedDuringPublish, commands).publish({
        runId: movedDuringPublish.run.id,
        expectedHeadSha: movedDuringPublish.headSha,
        expectedHeadBranch: headBranch,
      });
    } catch {
      rejected = true;
    }
    check('remote base drift during publication prevents a recorded Draft-PR success',
      rejected
      && movedDuringPublish.store.get().runPublications[0]?.status === 'failed'
      && !movedDuringPublish.store.get().runEvents.some((event) => event.type === 'publication.completed')
      && gitBare(movedDuringPublish.remote, ['rev-parse', `refs/heads/${headBranch}`]).trim()
        === movedDuringPublish.headSha);
  } finally {
    rmSync(movedDuringPublish.root, { recursive: true, force: true });
  }

  const drift = fixture('drift');
  try {
    writeFileSync(join(drift.workspace, 'later.txt'), 'later\n', 'utf8');
    git(drift.workspace, ['add', 'later.txt']);
    git(drift.workspace, ['commit', '-m', 'post verification drift']);
    const preview = await serviceFor(drift, fakeFor(drift)).preview(drift.run.id);
    check('post-verification HEAD drift is rejected',
      !preview.eligible && preview.reasons.some((reason) => reason.includes('HEAD changed')),
      preview.reasons);
  } finally {
    rmSync(drift.root, { recursive: true, force: true });
  }

  const collision = fixture('collision');
  try {
    const headBranch = publicationBranch(collision.run);
    gitBare(collision.remote, ['update-ref', `refs/heads/${headBranch}`, collision.baseSha]);
    const preview = await serviceFor(collision, fakeFor(collision)).preview(collision.run.id);
    check('different remote ade/** ref is never overwritten',
      !preview.eligible && preview.reasons.some((reason) => reason.includes('different commit')),
      preview.reasons);
  } finally {
    rmSync(collision.root, { recursive: true, force: true });
  }

  const wrongPushTarget = fixture('wrong-push-target');
  try {
    git(wrongPushTarget.workspace, [
      'config', 'remote.origin.pushurl', 'https://github.com/someone-else/unrelated.git',
    ]);
    const preview = await serviceFor(wrongPushTarget, fakeFor(wrongPushTarget)).preview(wrongPushTarget.run.id);
    check('an explicit push URL cannot redirect publication to another repository',
      !preview.eligible && preview.reasons.some((reason) => reason.includes('push URL targets')),
      preview.reasons);
  } finally {
    rmSync(wrongPushTarget.root, { recursive: true, force: true });
  }

  const multipleOriginUrls = fixture('multiple-origin-urls');
  try {
    git(multipleOriginUrls.workspace, [
      'config', '--add', 'remote.origin.url', 'https://github.com/someone-else/unrelated.git',
    ]);
    const preview = await serviceFor(multipleOriginUrls, fakeFor(multipleOriginUrls))
      .preview(multipleOriginUrls.run.id);
    check('multiple origin URLs cannot create an ambiguous Git publication target',
      !preview.eligible && preview.reasons.some((reason) => reason.includes('exactly one')),
      preview.reasons);
  } finally {
    rmSync(multipleOriginUrls.root, { recursive: true, force: true });
  }

  const unauthenticated = fixture('unauthenticated');
  try {
    const commands = fakeFor(unauthenticated, { authenticated: false });
    const preview = await serviceFor(unauthenticated, commands).preview(unauthenticated.run.id);
    check('missing backend-local GitHub authentication is explicit and fail-closed',
      !preview.eligible && preview.reasons.some((reason) => reason.includes('not authenticated')),
      preview.reasons);
  } finally {
    rmSync(unauthenticated.root, { recursive: true, force: true });
  }

  const legacy = fixture('legacy');
  try {
    legacy.store.config.runs = legacy.store.config.runs.map((run) => ({
      ...run,
      verifiedHeadSha: undefined,
      verificationTaskId: undefined,
      verifiedAt: undefined,
    }));
    const preview = await serviceFor(legacy, fakeFor(legacy)).preview(legacy.run.id);
    check('legacy completed run without immutable attestation cannot be published',
      !preview.eligible && preview.reasons.some((reason) => reason.includes('no immutable verification')),
      preview.reasons);
  } finally {
    rmSync(legacy.root, { recursive: true, force: true });
  }

  const invalidBase = fixture('invalid-base');
  try {
    invalidBase.store.config.runWorkspaceLeases[0]!.baseSha = '--upload-pack=malicious';
    const preview = await serviceFor(invalidBase, fakeFor(invalidBase)).preview(invalidBase.run.id);
    check('invalid persisted base is rejected before it can become a Git argument',
      !preview.eligible && preview.reasons.some((reason) => reason.includes('invalid base object id')),
      preview.reasons);
  } finally {
    rmSync(invalidBase.root, { recursive: true, force: true });
  }

  const wrongRepository = fixture('wrong-pr-repository');
  try {
    const headBranch = publicationBranch(wrongRepository.run);
    const commands = fakeFor(wrongRepository, { pullRepository: 'someone-else/unrelated' });
    const service = serviceFor(wrongRepository, commands);
    let rejected = false;
    try {
      await service.publish({
        runId: wrongRepository.run.id,
        expectedHeadSha: wrongRepository.headSha,
        expectedHeadBranch: headBranch,
      });
    } catch {
      rejected = true;
    }
    check('provider PR URL for another repository is rejected and audited',
      rejected && wrongRepository.store.get().runPublications[0]?.status === 'failed');
  } finally {
    rmSync(wrongRepository.root, { recursive: true, force: true });
  }

  const nonDraft = fixture('non-draft');
  try {
    const headBranch = publicationBranch(nonDraft.run);
    const service = serviceFor(nonDraft, fakeFor(nonDraft, { isDraft: false }));
    let rejected = false;
    try {
      await service.publish({
        runId: nonDraft.run.id,
        expectedHeadSha: nonDraft.headSha,
        expectedHeadBranch: headBranch,
      });
    } catch {
      rejected = true;
    }
    check('provider response that is not a Draft PR fails closed',
      rejected && nonDraft.store.get().runPublications[0]?.status === 'failed');
  } finally {
    rmSync(nonDraft.root, { recursive: true, force: true });
  }
}

async function retryAfterPrFailure(): Promise<void> {
  console.log('\n== retry after partial publication ==');
  const item = fixture('retry');
  try {
    const headBranch = publicationBranch(item.run);
    const commands = fakeFor(item, { failCreateOnceWith: 'request failed with ghp_SUPERSECRET' });
    const service = serviceFor(item, commands);
    let failedAsExpected = false;
    try {
      await service.publish({
        runId: item.run.id,
        expectedHeadSha: item.headSha,
        expectedHeadBranch: headBranch,
        commandId: 'publish-fails',
      });
    } catch {
      failedAsExpected = true;
    }
    const failedRecord = item.store.get().runPublications[0];
    check('PR failure after branch creation is persisted as retryable failure',
      failedAsExpected && failedRecord?.status === 'failed');
    check('persisted failure redacts provider credentials',
      Boolean(failedRecord?.error?.includes('[credential]'))
      && !failedRecord?.error?.includes('SUPERSECRET'));
    check('partial failure leaves exact non-destructive remote branch evidence',
      gitBare(item.remote, ['rev-parse', `refs/heads/${headBranch}`]).trim() === item.headSha);

    const retried = await service.publish({
      runId: item.run.id,
      expectedHeadSha: item.headSha,
      expectedHeadBranch: headBranch,
      commandId: 'publish-retry',
    });
    check('retry reuses exact remote SHA and completes one Draft PR',
      retried.status === 'draft' && retried.id === failedRecord?.id && commands.createCalls === 2);
  } finally {
    rmSync(item.root, { recursive: true, force: true });
  }
}

function pureContractChecks(): void {
  console.log('\n== pure provider contract ==');
  check('HTTPS and SSH GitHub remotes resolve to credential-free provider identity',
    parseGithubRepository('https://user:secret@github.com/owner/repo.git') === 'owner/repo'
    && parseGithubRepository('git@github.com:owner/repo.git') === 'owner/repo'
    && parseGithubRepository('ssh://git@github.com/owner/repo.git') === 'owner/repo');
  check('non-GitHub and malformed remotes are rejected',
    parseGithubRepository('https://gitlab.com/owner/repo.git') === null
    && parseGithubRepository('file:///tmp/repo.git') === null
    && parseGithubRepository('file://github.com/owner/repo.git') === null
    && parseGithubRepository('http://github.com/owner/repo.git') === null
    && parseGithubRepository('https://github.com/owner') === null);
  check('generated publication refs remain bounded ADE-owned refs', (() => {
    const branch = publicationBranch({ id: '../../Run Ä 123456789', name: 'Feature / with .. unsafe ** text' });
    return branch.startsWith('ade/run-') && !branch.includes('..') && branch.length <= 100;
  })());
  const redacted = redactSensitiveText(
    'https://user:pass@github.com/o/r token=secret ghp_ABCDEF123 Authorization: Bearer arbitrary.jwt.value',
  );
  check('credential redaction removes URL, token-field and GitHub-token secrets',
    !redacted.includes('pass')
    && !redacted.includes('secret')
    && !redacted.includes('ABCDEF123')
    && !redacted.includes('arbitrary.jwt.value'));
}

function fakeFor(item: Fixture, overrides: Partial<FakeGithubOptions> = {}): FakeGithubCommands {
  return new FakeGithubCommands({
    providerRepository: 'ade-publication-tests/fixture',
    baseBranch: 'main',
    headBranch: publicationBranch(item.run),
    headSha: item.headSha,
    ...overrides,
  });
}

function result(code: number, stdout = '', stderr = ''): BackendCommandResult {
  return {
    code,
    signal: null,
    stdout: Buffer.from(stdout),
    stderr: Buffer.from(stderr),
    timedOut: false,
  };
}

function git(cwd: string, args: string[]): string {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', windowsHide: true });
}

function gitBare(repository: string, args: string[]): string {
  return execFileSync('git', ['--git-dir', repository, ...args], { encoding: 'utf8', windowsHide: true });
}

async function main(): Promise<void> {
  pureContractChecks();
  await successfulPublication();
  await negativeControls();
  await retryAfterPrFailure();
  console.log(`\n${failed ? 'FAILED' : 'PASSED'} - ${passed} passed, ${failed} failed`);
  if (failed) process.exitCode = 1;
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
