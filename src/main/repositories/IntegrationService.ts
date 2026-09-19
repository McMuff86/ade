import { t as translate } from "../../shared/i18n";
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { AdeConfig, Repository, SessionMeta } from '../../shared/types';
import type { IntegrationCommand, IntegrationPreview, IntegrationQuery, IntegrationReport, IntegrationResult } from '../../shared/remote';
import { validIntegrationCommand, validIntegrationQuery } from '../../shared/integrationRequests';
import { redactForWire, redactedWireMessage } from '../errors';
import { projectRootIdentity } from '../settings/ProjectDefaultsService';
import { integrationGit } from './IntegrationGit';
import { assertNoLinks } from './pathDiscipline';
import { workspaceOperations } from './WorkspaceOperationGate';
import type { ProjectWorkspaceService, ProjectAuthorization } from './ProjectWorkspaceService';
import { analyzeIntegration, assertIntegrationGit, gitNames, gitText, integrationAvailability, integrationContents,
  integrationDigest, integrationFail, integrationSources, integrationStatus, type IntegrationContent } from './IntegrationAnalysis';
import { IntegrationRecords, type IntegrationRecord } from './IntegrationRecords';
import { integrationRecipes, runIntegrationCheck, type IntegrationRecipe } from './IntegrationChecks';

type Analysis = Awaited<ReturnType<typeof analyzeIntegration>>;
interface Preview { view: IntegrationPreview; owner: string; fingerprint: string }
type CheckRunner = (cwd: string, recipe: IntegrationRecipe, signal: AbortSignal) => Promise<{ output: string; exitCode: number }>;
const IDENTITY = ['-c', 'user.name=ADE Integration', '-c', 'user.email=ade-integration@localhost'];

/** Selective three-way transfer. Clients name opaque identities, never paths or commands. */
export class IntegrationService {
  private readonly records: IntegrationRecords;
  private readonly previews = new Map<string, Preview>();
  private readonly jobs = new Map<string, AbortController>();
  constructor(private readonly store: { get(): AdeConfig }, private readonly projects: ProjectWorkspaceService,
    private readonly sessions: () => SessionMeta[], private readonly dataDirectory: string,
    private readonly now = Date.now, private readonly runCheck: CheckRunner = runIntegrationCheck) {
    this.records = new IntegrationRecords(join(dataDirectory, 'reviews.json'));
  }
  busy(): boolean { return this.jobs.size > 0; }
  stop(): void { for (const job of this.jobs.values()) job.abort(); }

  async query(query: IntegrationQuery, owner: string, authorize: ProjectAuthorization = () => undefined): Promise<IntegrationResult> {
    if (!validIntegrationQuery(query)) integrationFail(translate("Invalid integration request."));
    return workspaceOperations.use(async () => {
      authorize();
      if (query.operation === 'diff') {
        const preview = this.previews.get(query.previewId);
        if (!preview || preview.owner !== owner || preview.view.expiresAt < this.now()) integrationFail(translate("Preview expired or for another session."));
        const repository = this.repository(preview!.view.repositoryId); authorize({ repositoryId: repository.id });
        const state = await this.sourceAnalysis(repository, preview!.view.sourceId);
        if (state.fingerprint !== preview!.fingerprint) integrationFail(translate("Files changed since preview. Check again."));
        const content = state.contents.find((file) => file.path === query.path); if (!content) integrationFail(translate("File not in this preview."));
        const read = async (head: string): Promise<Buffer> => {
          const entry = await gitText(repository.rootPath, ['--literal-pathspecs', 'ls-tree', head, '--', query.path]);
          return entry ? (await integrationGit(repository.rootPath, ['show', `${head}:${query.path}`])).stdout : Buffer.alloc(0);
        };
        const bodies = [await read(state.base), content!.body ?? Buffer.alloc(0), await read(state.targetHead)]; authorize();
        const text = (body: Buffer) => body.includes(0) ? translate("Binary · no text preview.") : redactForWire(body.toString('utf8'), 16 * 1024);
        return { diff: { path: query.path, base: text(bodies[0]!), source: text(bodies[1]!), target: text(bodies[2]!), limited: bodies.some((body) => body.length > 16 * 1024) } };
      }
      if (query.operation === 'report') {
        const record = this.records.get(query.integrationId); authorize({ repositoryId: record.report.repositoryId });
        const report = await this.report(record); authorize(); return { report };
      }
      const repository = this.repository(query.repositoryId); authorize({ repositoryId: repository.id });
      const sources = await integrationSources(this.store.get(), repository, this.projects); authorize();
      if (query.operation === 'sources') return { sources: sources.map((item) => item.view), reviews: this.records.list().filter((item) => item.report.repositoryId === repository.id)
        .sort((a, b) => b.report.createdAt - a.report.createdAt).map(({ report }) => ({ id: report.id, sourceName: report.sourceName, phase: report.phase })) };
      const source = sources.find((item) => item.view.id === query.sourceId);
      if (!source) integrationFail(translate("Source is no longer accessible. Update list."));
      const analysis = await analyzeIntegration(repository, source!, this.projects, this.sessions(), this.store.get()); authorize();
      const view: IntegrationPreview = { id: randomUUID(), repositoryId: repository.id, projectName: redactForWire(repository.name, 200), sourceId: source!.view.id,
        sourceName: source!.view.name, sourceBranch: source!.view.branch, sourceHead: analysis.sourceHead, targetBranch: redactForWire(analysis.targetScope.branch, 200),
        targetHead: analysis.targetHead, ownCommits: analysis.ownCommits, behind: analysis.behind, files: analysis.files, blockers: analysis.blockers, expiresAt: this.now() + 300_000 };
      for (const [id, preview] of this.previews) if (preview.view.expiresAt < this.now()) this.previews.delete(id);
      if (this.previews.size >= 50) integrationFail(translate("Too many open previews. Check again later."));
      this.previews.set(view.id, { view, owner, fingerprint: analysis.fingerprint }); return { preview: structuredClone(view) };
    });
  }

  async command(command: IntegrationCommand, owner: string, authorize: ProjectAuthorization = () => undefined): Promise<IntegrationResult> {
    if (!validIntegrationCommand(command)) integrationFail(translate("Invalid integration action."));
    if (command.operation === 'test') return this.startTests(command.integrationId, authorize);
    return workspaceOperations.mutate(async () => {
      authorize();
      if (command.operation === 'prepare') return { report: await this.prepare(command, owner, authorize) };
      const record = this.records.get(command.integrationId); authorize({ repositoryId: record.report.repositoryId });
      return { report: await this.integrate(record, command.revision, command.message, authorize) };
    });
  }

  private repository(id: string): Repository {
    const repository = this.store.get().repositories.find((item) => item.id === id);
    if (!repository?.verified || repository.executionBackend !== 'native') integrationFail(translate("Select a verified native repository."));
    return repository!;
  }
  private async sourceAnalysis(repository: Repository, sourceId: string): Promise<Analysis> {
    const source = (await integrationSources(this.store.get(), repository, this.projects)).find((item) => item.view.id === sourceId);
    if (!source) integrationFail(translate("Source workspace changed or was removed. Check again."));
    return analyzeIntegration(repository, source!, this.projects, this.sessions(), this.store.get());
  }
  private reviewPath(record: IntegrationRecord): string { return join(dirname(this.repository(record.report.repositoryId).rootPath), '.ade-worktrees', 'integrations', record.report.id); }
  private async buildTree(cwd: string, base: string, contents: IntegrationContent[]): Promise<string> {
    const index = join(this.dataDirectory, `${randomUUID()}.index`); assertNoLinks(index);
    try {
      await integrationGit(cwd, ['read-tree', base], { index });
      for (const file of contents) {
        if (file.body === null) await integrationGit(cwd, ['--literal-pathspecs', 'update-index', '--force-remove', '--', file.path], { index });
        else {
          const oid = await gitText(cwd, ['hash-object', '-w', `--path=${file.path}`, '--stdin'], { input: file.body });
          if (oid !== file.oid) integrationFail(translate("File filters were changed during the test."));
          await integrationGit(cwd, ['update-index', '--add', '--cacheinfo', file.mode, oid, file.path], { index });
        }
      }
      return await gitText(cwd, ['write-tree'], { index });
    } finally { assertNoLinks(index); try { unlinkSync(index); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; } }
  }

  private async prepare(command: Extract<IntegrationCommand, { operation: 'prepare' }>, owner: string, authorize: ProjectAuthorization): Promise<IntegrationReport> {
    const preview = this.previews.get(command.previewId);
    if (!preview || preview.owner !== owner || preview.view.expiresAt < this.now()) integrationFail(translate("Preview expired or for another session. Check again."));
    const repository = this.repository(preview!.view.repositoryId); authorize({ repositoryId: repository.id });
    const state = await this.sourceAnalysis(repository, preview!.view.sourceId); authorize();
    if (state.fingerprint !== preview!.fingerprint) integrationFail(translate("Source or destination changed since preview. Check again."));
    if (state.blockers.length) integrationFail(state.blockers.join(' '));
    if (command.paths.some((path) => !state.files.some((file) => file.path === path && file.selectable))) integrationFail(translate("File selection is no longer valid."));
    const id = randomUUID(); const report: IntegrationReport = { id, repositoryId: repository.id, projectName: preview!.view.projectName, sourceName: preview!.view.sourceName,
      sourceHead: state.sourceHead, targetBranch: preview!.view.targetBranch, targetHead: state.targetHead, branch: `ade/integration-${id}`, workspaceId: null,
      phase: 'preparing', files: command.paths.map((path) => ({ path, conflict: false })), blockers: [], checks: [], checkNotice: '', tested: false,
      revision: integrationDigest(id), createdAt: this.now(), integratedCommit: null };
    const record: IntegrationRecord = { report, sourceId: state.source.view.id, sourceFingerprint: state.fingerprint, targetIdentity: integrationDigest(state.targetScope),
      selected: [...command.paths], snapshot: null, testedTree: null, testedState: null, reviewCommit: null };
    this.records.save(record); this.previews.delete(command.previewId);
    try {
      const tree = await this.buildTree(state.source.path, state.base, state.contents.filter((file) => command.paths.includes(file.path)));
      const again = await this.sourceAnalysis(repository, record.sourceId); authorize();
      if (again.fingerprint !== record.sourceFingerprint || again.blockers.length) integrationFail(translate("Source or destination changed during backup."));
      record.snapshot = await gitText(repository.rootPath, [...IDENTITY, 'commit-tree', tree, '-p', state.base], { input: translate("ADE: Secure selected source changes\n") });
      await integrationGit(repository.rootPath, ['update-ref', `refs/ade/integrations/${id}/source`, record.snapshot, '0'.repeat(state.sourceHead.length)]);
      this.records.save(record);
      const path = this.reviewPath(record); const parent = dirname(path); assertNoLinks(parent); mkdirSync(parent, { recursive: true });
      const identity = projectRootIdentity(parent); assertNoLinks(path);
      if (existsSync(path)) integrationFail(translate("Integration working copy already exists."));
      authorize(); if (projectRootIdentity(parent) !== identity) integrationFail(translate("Workspace root was replaced."));
      await integrationGit(repository.rootPath, ['worktree', 'add', '--no-track', '-b', report.branch, '--', path, state.targetHead]);
      const workspace = await this.projects.registerCheckout(path, repository.id, authorize); report.workspaceId = workspace.id; this.records.save(record);
      const scope = await this.projects.resolve(workspace.id); await assertIntegrationGit(path, scope.workspace.gitDirectory, repository.commonGitDir); authorize();
      const merged = await integrationGit(path, [...IDENTITY, 'merge', '--no-ff', '--no-commit', '--no-overwrite-ignore', '--', record.snapshot], { accept: [1] });
      if (merged.code && !(await integrationStatus(path)).conflicts.length) integrationFail(translate("Merging was interrupted. Working copy checked."));
      report.phase = 'review'; this.records.save(record); return await this.report(record);
    } catch (error) {
      report.phase = 'interrupted'; report.blockers = [redactedWireMessage(error, 1000)]; this.records.save(record); throw error;
    }
  }

  private async reviewState(record: IntegrationRecord) {
    if (!record.report.workspaceId) integrationFail(translate("Preparation without working copy interrupted. Create new preview; backup is preserved."));
    const scope = await this.projects.resolve(record.report.workspaceId!); const cwd = scope.workspace.workspaceDir;
    if (cwd !== this.reviewPath(record) || scope.branch !== record.report.branch) integrationFail(translate("Integration working copy or branch has been changed."));
    await assertIntegrationGit(cwd, scope.workspace.gitDirectory, scope.repository.commonGitDir);
    const head = await gitText(cwd, ['rev-parse', 'HEAD']);
    if ((await integrationGit(cwd, ['merge-base', '--is-ancestor', record.report.targetHead, head], { accept: [1] })).code) integrationFail(translate("Working copy is no longer based on the tested target."));
    const mergeHead = await gitText(cwd, ['rev-parse', '--verify', '--quiet', 'MERGE_HEAD'], { accept: [1] });
    if (!record.snapshot || mergeHead !== record.snapshot && (await integrationGit(cwd, ['merge-base', '--is-ancestor', record.snapshot, head], { accept: [1] })).code) integrationFail(translate("Prepared merger is missing or has been canceled. Prepare a new integration."));
    const status = await integrationStatus(cwd);
    const changed = await gitNames(cwd, ['diff', '--name-only', '-z', '--no-renames', record.report.targetHead, head]);
    const paths = [...new Set([...changed, ...status.paths])].sort();
    const contents = await integrationContents(cwd, paths, head);
    const markers = contents.filter((file) => file.body && /^(?:<<<<<<< |=======\r?$|>>>>>>> )/m.test(file.body.toString('utf8'))).map((file) => file.path);
    const blockers = integrationAvailability(this.store.get(), scope.repository, [cwd, scope.repository.rootPath], this.sessions());
    if (status.conflicts.length || markers.length) blockers.push(translate("Edit conflicts and mark them as resolved in Git."));
    for (const marker of ['rebase-merge', 'rebase-apply', 'CHERRY_PICK_HEAD', 'REVERT_HEAD']) if (existsSync(join(scope.workspace.gitDirectory, marker))) blockers.push(translate("Finish the ongoing Git operation in the worktree."));
    const fingerprint = integrationDigest([scope, head, status.raw, contents.map(({ path, body, mode, oid }) => [path, body === null ? null : integrationDigest(body), mode, oid])]);
    return { scope, cwd, head, paths, contents, status, markers, blockers, fingerprint };
  }

  private async report(record: IntegrationRecord): Promise<IntegrationReport> {
    const report = structuredClone(record.report);
    if (report.phase === 'integrated' || !report.workspaceId) return report;
    try {
      const state = await this.reviewState(record);
      report.files = state.paths.map((path) => ({ path, conflict: state.status.conflicts.includes(path) || state.markers.includes(path) }));
      report.blockers = state.blockers;
      const repository = this.repository(report.repositoryId); const target = await this.projects.inspectCheckout(repository.rootPath, repository.id);
      if (integrationDigest(target) !== record.targetIdentity || await gitText(repository.rootPath, ['rev-parse', 'HEAD']) !== report.targetHead
        || (await integrationStatus(repository.rootPath)).raw) report.blockers.push(translate("Target status has been changed or contains local files. Prepare new integration."));
      report.tested = !!record.testedState && record.testedState === state.fingerprint;
      if (!report.tested && report.phase === 'ready') report.phase = 'review';
      report.revision = integrationDigest([state.fingerprint, record.testedTree, report.checks, report.blockers]);
      if (!report.checkNotice) report.checkNotice = integrationRecipes(state.cwd).notice;
      if (report.phase === 'interrupted') report.checkNotice += ' ' + record.report.blockers.join(' ');
    } catch (error) { report.tested = false; report.blockers = [redactedWireMessage(error, 1000)]; }
    return report;
  }

  private async startTests(id: string, authorize: ProjectAuthorization): Promise<IntegrationResult> {
    // Admission is exclusive. The long job holds a read fence: no concurrent Git mutation;
    // file/terminal work remains visible and invalidates proof if it changes this copy.
    return workspaceOperations.mutate(async () => {
      const record = this.records.get(id); authorize({ repositoryId: record.report.repositoryId });
      if (record.report.phase === 'integrated' || this.jobs.has(id)) integrationFail(translate("Integration already completed or under review."));
      const state = await this.reviewState(record); if (state.blockers.length) integrationFail(state.blockers.join(' '));
      const plan = integrationRecipes(state.cwd); if (!plan.recipes.length) integrationFail(plan.notice);
      const tree = await this.buildTree(state.cwd, state.head, state.contents); authorize();
      record.testedTree = null; record.testedState = null; record.report.tested = false; record.report.phase = 'testing'; record.report.blockers = [];
      record.report.checkNotice = plan.notice; record.report.checks = plan.recipes.map((recipe) => ({ label: recipe.label, status: 'pending', output: '', exitCode: null }));
      this.records.save(record); const controller = new AbortController(); this.jobs.set(id, controller);
      // Run after this mutation fence releases. Record and job reservation precede receipt.
      setImmediate(() => {
        void workspaceOperations.use(async () => {
          try {
            authorize();
            for (let index = 0; index < plan.recipes.length; index++) {
              authorize(); if (controller.signal.aborted) integrationFail(translate("Test interrupted."));
              const check = record.report.checks[index]!; check.status = 'running'; this.records.save(record);
              const result = await this.runCheck(state.cwd, plan.recipes[index]!, controller.signal);
              check.exitCode = result.exitCode; check.output = redactForWire(result.output, 8192); check.status = result.exitCode === 0 ? 'passed' : 'failed'; this.records.save(record);
            }
            authorize(); const after = await this.reviewState(record);
            if (after.fingerprint !== state.fingerprint || after.blockers.length) integrationFail(translate("The working copy changed or came into use during the checks. Check again."));
            const passed = record.report.checks.every((check) => check.status === 'passed');
            record.testedTree = passed ? tree : null; record.testedState = passed ? state.fingerprint : null;
            record.report.tested = passed; record.report.phase = passed ? 'ready' : 'review';
            if (!passed) record.report.blockers = [translate("Project review failed. Correct working copy and recheck.")];
          } catch (error) {
            record.report.phase = 'interrupted'; record.report.blockers = [redactedWireMessage(error, 1000)];
            for (const check of record.report.checks) if (check.status === 'running' || check.status === 'pending') { check.status = 'failed'; check.output = translate("Test interrupted."); }
          } finally { this.records.save(record); }
        }).catch((error) => { record.report.phase = 'interrupted'; record.report.blockers = [redactedWireMessage(error, 1000)]; this.records.save(record); })
          .finally(() => this.jobs.delete(id));
      });
      return { report: structuredClone(record.report) };
    });
  }

  private async integrate(record: IntegrationRecord, revision: string, message: string, authorize: ProjectAuthorization): Promise<IntegrationReport> {
    if (record.report.phase === 'integrated' || this.jobs.has(record.report.id)) integrationFail(translate("Integration completed or under review."));
    const report = await this.report(record);
    if (report.revision !== revision || !report.tested || report.blockers.length || !record.testedTree || !record.report.checks.every((check) => check.status === 'passed')) integrationFail(translate("No valid clearance: re-check working copy, target and exams."));
    if (redactForWire(message, 2000) !== message) integrationFail(translate("Commit message contains proprietary information."));
    const repository = this.repository(record.report.repositoryId); const source = await this.sourceAnalysis(repository, record.sourceId);
    if (source.fingerprint !== record.sourceFingerprint || source.blockers.length) integrationFail(translate("Source or destination changed since backup. Prepare new integration."));
    const state = await this.reviewState(record); authorize();
    if (state.fingerprint !== record.testedState || state.blockers.length) integrationFail(translate("Checked working copy has been changed."));
    if (!record.reviewCommit) {
      await integrationGit(state.cwd, ['read-tree', record.testedTree!]);
      await integrationGit(state.cwd, [...IDENTITY, 'commit', '-m', message]);
      record.reviewCommit = await gitText(state.cwd, ['rev-parse', 'HEAD']); this.records.save(record);
    }
    // The reviewed commit remains available if the target can no longer fast-forward.
    const target = await this.projects.inspectCheckout(repository.rootPath, repository.id); authorize();
    await assertIntegrationGit(repository.rootPath, target.workspace.gitDirectory, repository.commonGitDir);
    const blockers = integrationAvailability(this.store.get(), repository, [repository.rootPath, state.cwd, source.source.path], this.sessions());
    if (integrationDigest(target) !== record.targetIdentity || await gitText(repository.rootPath, ['rev-parse', 'HEAD']) !== record.report.targetHead
      || (await integrationStatus(repository.rootPath)).raw || blockers.length) integrationFail(translate("Target now changed or occupied. Tested commit remains on the integration branch."));
    if (await gitText(state.cwd, ['rev-parse', `${record.reviewCommit}^{tree}`]) !== record.testedTree) integrationFail(translate("Commit does not correspond to the tested file tree."));
    authorize(); await integrationGit(repository.rootPath, ['merge', '--ff-only', '--no-overwrite-ignore', '--', record.reviewCommit!]);
    if (await gitText(repository.rootPath, ['rev-parse', 'HEAD']) !== record.reviewCommit || (await integrationStatus(repository.rootPath)).raw) integrationFail(translate("Integration could not be confirmed cleanly. Check condition on the PC."));
    record.report.phase = 'integrated'; record.report.files = report.files; record.report.integratedCommit = record.reviewCommit; record.report.blockers = []; record.report.tested = true;
    record.report.revision = integrationDigest(record.reviewCommit); this.records.save(record); return structuredClone(record.report);
  }
}
