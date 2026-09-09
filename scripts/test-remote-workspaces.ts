import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { ProjectDefaultsService } from '../src/main/settings/ProjectDefaultsService';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { AdeApplicationService, RemoteApiError, validateAdministration, type RemoteCommandContext } from '../src/main/application/AdeApplicationService';
import { RemoteCommandLedger } from '../src/main/application/RemoteCommandLedger';
import { RemoteWorkspaceService } from '../src/main/application/RemoteWorkspaceService';
import { HostOperationGate } from '../src/main/application/HostOperationGate';
import { HostRestartController } from '../src/main/application/HostRestartController';
import { RepositoryScopeService } from '../src/main/repositories/RepositoryScopeService';
import { RepositorySyncService } from '../src/main/repositories/RepositorySyncService';
import { createMobileFixture } from './helpers/mobileFixture';
import type { MobileAdminCommand } from '../src/shared/remote';
import { completeProjectDraft, initialProjectDraft, selectProjectDraft, updateProjectDraft } from '../src/mobile/projectDrafts';
import type { WorkDraft } from '../src/mobile/WorkComposer';

let passed = 0; let failed = 0;
const check = (name: string, condition: boolean): void => { if (condition) { passed++; console.log(`  ok  ${name}`); } else { failed++; console.error(`FAIL  ${name}`); } };
async function refuses(name: string, operation: () => unknown, code?: string): Promise<void> {
  try { await operation(); check(name, false); } catch (error) { check(name, !code || error instanceof RemoteApiError && error.code === code); }
}
const root = mkdtempSync(join(tmpdir(), 'ade-remote-workspaces-'));
void (async () => {
  const fixture = createMobileFixture(root); const { store, devices } = fixture;
  devices.enroll('phone', 'Phone', 'd'.repeat(40)); devices.enroll('other', 'Other', 'e'.repeat(40));
  devices.setAdminScopes('phone', ['catalog:write', 'repositories:write']); devices.setAdminScopes('other', ['repositories:write']);
  const scopes = new RepositoryScopeService(store, { baseDir: join(root, 'managed') });
  const gate = new HostOperationGate();
  const ledger = new RemoteCommandLedger(join(root, 'remote', 'commands.json'), (entry) => devices.audit(entry),
    (id, scope) => devices.activeDevices().some((item) => item.id === id && item.scopes.includes(scope)));
  const administration = { ledger, restart: new HostRestartController(gate, () => [], () => undefined, 'fixture', true),
    workspaces: new RemoteWorkspaceService(store, scopes, join(root, 'managed'), () => []), git: new RepositorySyncService(store, () => []) };
  const app = new AdeApplicationService(store, fixture.orchestration, { status: () => ({ active: 0, queued: 0, maxActive: 4 }) }, { administration, activity: gate });
  let nextKey = 0;
  const context = (id = 'phone', key = `command-${++nextKey}`): RemoteCommandContext => ({ principal: { id, kind: 'device', proof: 'device-signature',
    scopes: new Set(devices.activeDevices().find((item) => item.id === id)!.scopes) }, idempotencyKey: key, requestId: 'workspace-test' });
  const command = (input: MobileAdminCommand, ctx = context()) => app.administer(ctx, input);
  for (const input of [
    { operation: 'shell', input: { command: 'whoami' } },
    { operation: 'agent-create', input: { name: 'Agent', source: { kind: 'runtime', id: 'codex' }, customCommand: 'whoami' } },
    { operation: 'project-create', input: { name: 'Project', rootPath: root } },
    { operation: 'workspace-prepare', input: { agentId: '../agent', repositoryId: 'repo' } },
    { operation: 'git-fetch', input: { repositoryId: 'repo', remote: 'somewhere' } },
    { operation: 'git-apply', input: { previewId: 'preview', force: true } },
  ]) await refuses('administration refuses unbounded or extra fields', () => validateAdministration(input), 'invalid_payload');
  await refuses('Git rights do not authorize project creation', () => command({ operation: 'project-create', input: { name: 'Denied' } }, context('other')), 'scope_not_granted');
  const projectCommand: MobileAdminCommand = { operation: 'project-create', input: { name: 'Project One' } };
  const projectContext = context();
  const created = await command(projectCommand, projectContext); const repoId = created.created!.id;
  const replay = await command(projectCommand, projectContext);
  check('project creation returns one durable opaque catalog identity', created.created!.kind === 'repository' && replay.replayed && replay.created!.id === repoId);
  const repository = store.get().repositories.find((item) => item.id === repoId)!;
  const git = (path: string, args: string[]): string => execFileSync('git', ['-C', path, ...args], { encoding: 'utf8', windowsHide: true }).trim();
  check('new project is a real native Git repository with initial main commit', git(repository.rootPath, ['branch', '--show-current']) === 'main'
    && /^[a-f0-9]{40,64}$/.test(git(repository.rootPath, ['rev-parse', 'HEAD'])) && repository.rootPath.toLowerCase().startsWith(realpathSync.native(join(root, 'managed', 'projects')).toLowerCase()));
  const second = await command({ operation: 'project-create', input: { name: 'Project Two' } });
  check('projects receive different directories and identities', second.created!.id !== repoId && store.get().repositories.find((item) => item.id === second.created!.id)!.rootPath !== repository.rootPath);
  const agentCommand: MobileAdminCommand = { operation: 'agent-create', input: { name: 'Remote Builder', source: { kind: 'agent', id: 'builder' } } };
  const agentContext = context(); const newAgent = await command(agentCommand, agentContext);
  const agentId = newAgent.created!.id; const agent = store.get().agents.find((item) => item.id === agentId)!;
  check('remote agent copies host runtime settings into an independent identity', agent.id !== 'builder' && agent.runtime === 'custom' && agent.customCommand === 'fixture-agent'
    && agent.name === 'Remote Builder' && agent.defaultRepositoryId === undefined);
  check('agent has independent memory and durable instructions', readFileSync(join(agent.memoryDir, 'AGENTS.md'), 'utf8').length > 0
    && agent.memoryDir !== store.get().agents.find((item) => item.id === 'builder')!.memoryDir);
  check('agent retry creates no duplicate', (await command(agentCommand, agentContext)).created!.id === agentId && store.get().agents.filter((item) => item.name === 'Remote Builder').length === 1);
  await refuses('missing host profile cannot create an agent', () => command({ operation: 'agent-create', input: { name: 'No profile', source: { kind: 'agent', id: 'missing' } } }), 'command_rejected');
  const workspace = await command({ operation: 'workspace-prepare', input: { agentId, repositoryId: repoId } });
  const binding = store.get().workspaceBindings.find((item) => item.id === workspace.created!.id)!;
  check('workspace preparation creates an isolated real worktree', workspace.created!.kind === 'workspace' && binding.agentId === agentId && binding.repositoryId === repoId
    && binding.workspaceDir !== repository.rootPath && git(binding.workspaceDir, ['rev-parse', 'HEAD']) === git(repository.rootPath, ['rev-parse', 'HEAD']));
  check('another explicit prepare reuses the same agent/project binding', (await command({ operation: 'workspace-prepare', input: { agentId, repositoryId: repoId } })).created!.id === binding.id);
  const secondWorkspace = await command({ operation: 'workspace-prepare', input: { agentId, repositoryId: second.created!.id } });
  check('same agent can have independent workspaces in two projects', secondWorkspace.created!.id !== binding.id
    && store.get().workspaceBindings.filter((item) => item.agentId === agentId).length === 2);
  const safeWire = JSON.stringify({ catalog: app.catalog(), workspace, created });
  check('remote catalog and provisioning results expose no paths, commands or memory', !safeWire.includes(root) && !safeWire.includes('fixture-agent')
    && !safeWire.includes('memorySeed') && !safeWire.includes('workspaceDir'));
  git(repository.rootPath, ['-c', 'user.name=Test', '-c', 'user.email=test@localhost', '-c', 'commit.gpgSign=false', 'commit', '--allow-empty', '-m', 'Advance project']);
  const overview = await app.queryGit(context(), { operation: 'git-overview', repositoryId: repoId });
  check('remote comparison sees one commit behind in the agent worktree', overview.overview.targets.find((item) => item.id === binding.id)?.behind === 1);
  const preview = (await app.queryGit(context(), { operation: 'git-preview', repositoryId: repoId, targetId: binding.id })).preview!;
  await refuses('a preview belongs to the device that requested it', () => command({ operation: 'git-apply', input: { previewId: preview.id } }, context('other')), 'command_rejected');
  const applyContext = context(); const applied = await command({ operation: 'git-apply', input: { previewId: preview.id } }, applyContext);
  check('confirmed Git update performs a real fast-forward', applied.git!.targets.find((item) => item.id === binding.id)?.behind === 0
    && git(binding.workspaceDir, ['rev-parse', 'HEAD']) === git(repository.rootPath, ['rev-parse', 'HEAD']));
  check('Git apply receipt survives consumed preview for retry', (await command({ operation: 'git-apply', input: { previewId: preview.id } }, applyContext)).replayed);
  writeFileSync(join(binding.workspaceDir, 'private-change.txt'), 'preserve me');
  const dirty = await app.queryGit(context(), { operation: 'git-overview', repositoryId: repoId });
  check('dirty worktree is shown with an actionable blocker', dirty.overview.targets.find((item) => item.id === binding.id)!.blockedReason?.includes('uncommittete') === true);
  await refuses('dirty worktree cannot create an update preview', () => app.queryGit(context(), { operation: 'git-preview', repositoryId: repoId, targetId: binding.id }));
  check('refused update preserves user file contents', readFileSync(join(binding.workspaceDir, 'private-change.txt'), 'utf8') === 'preserve me');
  unlinkSync(join(binding.workspaceDir, 'private-change.txt'));
  const remote = join(root, 'origin.git'); execFileSync('git', ['init', '--bare', remote], { windowsHide: true, stdio: 'ignore' });
  git(repository.rootPath, ['remote', 'add', 'origin', remote]); git(repository.rootPath, ['push', 'origin', 'main']);
  const fetched = await command({ operation: 'git-fetch', input: { repositoryId: repoId } });
  check('explicit Fetch records measured freshness and origin refs', fetched.git!.remoteCheckedAt !== null && fetched.git!.refs.some((item) => item.ref === 'refs/remotes/origin/main'));
  const originalCount = store.get().repositories.length;
  const linkedBase = join(root, 'linked-managed'); symlinkSync(join(root, 'managed'), linkedBase, process.platform === 'win32' ? 'junction' : 'dir');
  const linked = new RemoteWorkspaceService(store, scopes, linkedBase, () => []);
  await refuses('project creation refuses linked managed root', () => linked.execute({ operation: 'project-create', input: { name: 'Linked' } }));
  check('linked-root negative control creates no catalog entry', store.get().repositories.length === originalCount);
  const settings = store.get().settings;
  store.save({ settings: { ...settings, worktreeBaseDir: linkedBase } });
  await refuses('workspace creation refuses a linked configured worktree root', () => command({ operation: 'workspace-prepare', input: { agentId: 'coordinator', repositoryId: repoId } }), 'command_rejected');
  store.save({ settings });
  const live = new RemoteWorkspaceService(store, scopes, join(root, 'managed'), () => [{ id: 'legacy-session', agentId, title: 'Live', kind: 'interactive',
    status: 'running', createdAt: Date.now(), workspaceDir: binding.workspaceDir }]);
  await refuses('legacy live session without binding metadata still blocks workspace preparation', () => live.execute({ operation: 'workspace-prepare', input: { agentId, repositoryId: repoId } }));
  const seed: WorkDraft = { mode: 'task', repositoryId: 'one', agentIds: ['builder'], name: 'First', prompt: 'First private task', minutes: 30, cost: '' };
  let drafts = initialProjectDraft(seed);
  drafts = updateProjectDraft(drafts, { ...seed, repositoryId: 'two' });
  check('new project draft never inherits another prompt or name', drafts.drafts[drafts.active]!.prompt === '' && drafts.drafts[drafts.active]!.name === '');
  drafts = updateProjectDraft(drafts, { ...drafts.drafts[drafts.active]!, prompt: 'Second private task' });
  drafts = selectProjectDraft(drafts, seed, 'reviewer');
  check('returning to a project restores its own text and explicit agent selection', drafts.drafts[drafts.active]!.prompt === seed.prompt && drafts.drafts[drafts.active]!.agentIds[0] === 'reviewer');
  const beforeCompletion = drafts;
  drafts = completeProjectDraft(drafts, 'two', 'task', 'Second private task', '');
  check('completion clears only the matching submitted project draft', drafts.drafts[drafts.active]!.prompt === seed.prompt
    && Object.values(drafts.drafts).find((item) => item.repositoryId === 'two')!.prompt === '');
  check('late result cannot clear a subsequently edited draft', completeProjectDraft(beforeCompletion, 'two', 'task', 'Older text', '') === beforeCompletion);
  drafts = selectProjectDraft(drafts, { ...seed, mode: 'run' });
  check('managed run and single-task drafts are independent', drafts.drafts[drafts.active]!.prompt === ''
    && Object.values(drafts.drafts).find((item) => item.repositoryId === 'one' && item.mode === 'task')!.prompt === seed.prompt);
  const final = await command({ operation: 'project-create', input: { name: 'Final positive project' } });
  check('positive creation still succeeds after negative controls', !!final.created?.id && store.get().repositories.length === originalCount + 1);
  const defaults = new ProjectDefaultsService(store);
  check('project settings start unconfigured without writing the operator filesystem', !defaults.get().configured);
  const projectsRoot = join(root, 'personal-repos'); mkdirSync(projectsRoot);
  await refuses('relative project root is refused', () => defaults.save({ rootPath: '../elsewhere', agentId: null }));
  await refuses('non-Codex default profile is refused', () => defaults.save({ rootPath: projectsRoot, agentId: 'builder' }));
  const codex = await command({ operation: 'agent-create', input: { name: 'Project Codex', source: { kind: 'runtime', id: 'codex' } } });
  defaults.save({ rootPath: projectsRoot, agentId: codex.created!.id });
  check('native project root and Codex identity are persisted together', defaults.get().configured && defaults.get().agentId === codex.created!.id
    && new ProjectDefaultsService(store).get().rootPath === realpathSync.native(projectsRoot));
  const namedContext = context(); const namedCommand: MobileAdminCommand = { operation: 'project-create', input: { name: 'Garten Planer' } };
  const named = await command(namedCommand, namedContext);
  const namedRepository = store.get().repositories.find((item) => item.id === named.created!.id)!;
  check('configured root creates the named permanent repository', namedRepository.rootPath === realpathSync.native(join(projectsRoot, 'garten-planer'))
    && git(namedRepository.rootPath, ['branch', '--show-current']) === 'main');
  check('lost named-project reply recovers the same repository', (await command(namedCommand, namedContext)).created?.id === named.created!.id);
  writeFileSync(join(namedRepository.rootPath, 'keep.txt'), 'keep my work');
  await refuses('existing project folder is never overwritten', () => command(namedCommand), 'command_rejected');
  check('collision preserves existing untracked files', readFileSync(join(namedRepository.rootPath, 'keep.txt'), 'utf8') === 'keep my work');
  for (const name of ['../escape', 'a/b', 'a\\b', 'CON', 'nul', '..']) {
    await refuses('unsafe or reserved project directory name is refused', () => command({ operation: 'project-create', input: { name } }), 'command_rejected');
  }
  const wire = JSON.stringify(app.catalog());
  check('mobile project defaults disclose no root path or filesystem identity', wire.includes('projectStart') && !wire.includes('personal-repos')
    && !wire.includes('rootIdentity') && app.catalog().projectStart?.agentId === codex.created!.id);
  const moved = join(root, 'preserved-repos'); renameSync(projectsRoot, moved); mkdirSync(projectsRoot);
  await refuses('replaced root directory fails closed even at the same path', () => command({ operation: 'project-create', input: { name: 'Refused root' } }), 'command_rejected');
  const link = join(root, 'project-root-link'); symlinkSync(projectsRoot, link, process.platform === 'win32' ? 'junction' : 'dir');
  await refuses('linked project root cannot be saved', () => defaults.save({ rootPath: link, agentId: null }));
  defaults.save({ rootPath: projectsRoot, agentId: codex.created!.id });
  check('explicit root reselection restores successful project creation', !!(await command({ operation: 'project-create', input: { name: 'Final Named Project' } })).created?.id);
})().catch((error) => { failed++; console.error(error); }).finally(() => {
  if (dirname(resolve(root)) !== resolve(tmpdir())) throw new Error('unexpected fixture root');
  rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  console.log(`\nRemote workspaces: ${passed} passed, ${failed} failed`); if (failed) process.exitCode = 1;
});
