import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRemoteWorkspaceFixture } from './helpers/remoteWorkspaceFixture';
import { RemoteApiError, type RemoteCommandContext } from '../src/main/application/AdeApplicationService';
import { validateTerminal } from '../src/main/application/RemoteTerminalService';
import { assertIpcPayload } from '../src/main/ipcValidation';
import { SessionLaunchService } from '../src/main/pty/SessionLaunchService';
import { ExecutionBackendService } from '../src/main/execution/ExecutionBackendService';
import { validProjectWorkspaceCommand, validProjectWorkspaceQuery } from '../src/shared/projectWorkspaceRequests';
import { resolveLaunchCommand } from '../src/shared/runtimes';
import type { SessionMeta } from '../src/shared/types';
import { validateCompleteConfig } from '../src/main/config/store';
import { projectOverview } from '../src/main/overview/projectOverview';

let passed = 0; let failed = 0;
const check = (name: string, ok: boolean) => { if (ok) { passed++; console.log(`  ok  ${name}`); } else { failed++; console.error(`FAIL  ${name}`); } };
async function rejects(name: string, action: () => unknown, code?: string) { try { await action(); check(name, false); } catch (error) { check(name, !code || error instanceof RemoteApiError && error.code === code); } }
const root = mkdtempSync(join(tmpdir(), 'ade-project-launch-'));
void (async () => {
  const f = createRemoteWorkspaceFixture(root); const { application: app, store, devices } = f;
  await rejects('project creation refuses injected host paths', () => assertIpcPayload('project:create', { name: 'C:\\private' }));
  await rejects('project creation refuses extra launch and command fields', () => assertIpcPayload('project:create', { name: 'Garden', command: 'shell' }));
  devices.enroll('tablet', 'Tablet', 't'.repeat(40)); devices.setAdminScopes('tablet', ['catalog:write', 'workspace:read', 'projects:write']);
  const context = (): RemoteCommandContext => ({ principal: { id: 'tablet', kind: 'device', proof: 'device-signature', scopes: new Set(devices.activeDevices()[0]!.scopes) }, idempotencyKey: randomUUID(), requestId: 'project-launch-test' });
  const project = await app.administer(context(), { operation: 'project-create', input: { name: 'Independent CLI' } });
  const oldGitDir = process.env.GIT_DIR; const redirected = join(root, 'redirected-git');
  try {
    process.env.GIT_DIR = redirected;
    await rejects('project creation refuses inherited Git redirection before catalog import', () => app.administer(context(), { operation: 'project-create', input: { name: 'Environment Guard' } }), 'command_rejected');
    check('Git redirection creates no foreign metadata or catalog entry', !existsSync(redirected) && !store.get().repositories.some((item) => item.name === 'Environment Guard'));
  } finally { if (oldGitDir === undefined) delete process.env.GIT_DIR; else process.env.GIT_DIR = oldGitDir; }
  const entry = (await app.queryProjects(context(), { operation: 'directory' })).directory!.entries.find((item) => item.repositoryId === project.created!.id)!;
  const opened = await app.commandProject(context(), { operation: 'open', entryId: entry.id }); const workspaceId = opened.workspace.id;
  const history = structuredClone(store.get());
  history.sessionBookends = [{ id: 'project-history', projectWorkspaceId: workspaceId, branch: 'main', agentName: 'Ohne Agent-Profil', runtime: 'codex',
    repositoryId: opened.workspace.repositoryId, repositoryName: 'Independent CLI', startedAt: 1, endedAt: 2, exitReason: 'exit' }];
  validateCompleteConfig(history);
  check('project session history remains selectable without a fictitious agent', projectOverview(history, [], Date.now()).work.some((item) => item.kind === 'session' && item.projectWorkspaceId === workspaceId && !item.detached));
  const ambiguous = structuredClone(history); ambiguous.sessionBookends[0]!.agentId = 'builder';
  await rejects('persisted session history refuses two owners', () => validateCompleteConfig(ambiguous));
  const noRepo = structuredClone(history); noRepo.sessionBookends[0]!.repositoryId = null;
  await rejects('project session history requires its repository context', () => validateCompleteConfig(noRepo));
  const selection = { projectWorkspaceId: workspaceId }; const launch = { ...selection, expectedBranch: 'main', mode: 'codex' };
  check('desktop and remote accept project launch without agent', (() => { assertIpcPayload('session:launch', launch); validateTerminal({ ...launch, operation: 'open' }, 'command'); return true; })());
  for (const bad of [{ agentId: 'builder' }, { repositoryId: entry.repositoryId }, { workspaceBindingId: randomUUID() }, { workspaceDir: root }, { customCommand: 'bad' }, { profileId: 'builder' }, { expectedBranch: undefined }]) {
    await rejects(`desktop refuses ambiguous project launch ${Object.keys(bad)[0]}`, () => assertIpcPayload('session:launch', { ...launch, ...bad }));
    await rejects(`remote refuses ambiguous project launch ${Object.keys(bad)[0]}`, () => validateTerminal({ ...launch, ...bad, operation: 'open' }, 'command'), 'invalid_payload');
  }
  check('saved profile is explicit and only accepted in profile launch mode', (() => { assertIpcPayload('session:launch', { ...launch, mode: 'agent', profileId: 'builder' }); return true; })());
  await rejects('profile mode cannot imply a default identity', () => assertIpcPayload('session:launch', { ...launch, mode: 'agent' }));
  check('branch queries reject injected paths and commands', !validProjectWorkspaceQuery({ operation: 'branches', workspaceId, path: root }) && !validProjectWorkspaceCommand({ operation: 'branch-apply', previewId: randomUUID(), command: 'git' }));
  const overview = (await app.queryProjects(context(), { operation: 'branches', workspaceId })).branches!;
  check('read grant exposes actual local branch without paths', overview.workspace.branch === 'main' && overview.branches.some((branch) => branch.name === 'main') && !JSON.stringify(overview).includes(root));
  const action = { kind: 'create', name: 'feature/tablet', baseRef: 'refs/heads/main', separate: false };
  await rejects('existing project-open grant does not grant branch mutation', () => app.queryProjects(context(), { operation: 'branch-preview', workspaceId, action }), 'scope_not_granted');
  devices.setAdminScopes('tablet', ['workspace:read', 'projects:write', 'projectGit:write']);
  const preview = (await app.queryProjects(context(), { operation: 'branch-preview', workspaceId, action })).preview!;
  const scope = await f.workbench.resolve(selection); const revision = f.workbench.version(scope!);
  const commandContext = context(); const applied = await app.commandProject(commandContext, { operation: 'branch-apply', previewId: preview.id });
  const replayed = await app.commandProject(commandContext, { operation: 'branch-apply', previewId: preview.id });
  check('branch command is receipt-backed and runs once', applied.workspace.branch === 'feature/tablet' && !applied.replayed && replayed.replayed && replayed.workspace.id === workspaceId);
  await rejects('old workspace version is rejected after branch change', () => f.workbench.revalidate(scope!));
  const current = await f.workbench.resolve(selection);
  check('branch context changes scope revision', f.workbench.version(current!) !== revision);
  const session: SessionMeta = { id: 'project-session', projectWorkspaceId: workspaceId, repositoryId: entry.repositoryId!, workspaceDir: current!.workspaceDir,
    executionBackend: 'native', branch: 'main', title: 'Shell', status: 'running', kind: 'interactive', createdAt: 1 };
  check('terminal matching excludes a session from a different branch', !f.workbench.sessionMatches(current!, session));
  session.branch = 'feature/tablet';
  check('matching does not require an agent identity', f.workbench.sessionMatches(current!, session));
  devices.setAdminScopes('tablet', ['workspace:read', 'projects:write']);
  await rejects('revoked branch grant cannot replay an earlier success', () => app.commandProject(commandContext, { operation: 'branch-apply', previewId: preview.id }), 'scope_not_granted');
  const execution = new ExecutionBackendService(); execution.run = async () => ({ code: 0, stdout: Buffer.from('found'), stderr: Buffer.alloc(0), timedOut: false, signal: null });
  const launchService = new SessionLaunchService(store, execution);
  const firstAgent = store.get().agents[0]!;
  store.save({ agents: [...store.get().agents, { ...firstAgent, id: 'wsl-profile', homeExecutionBackend: 'wsl:Ubuntu' }] });
  check('native project profile picker excludes a WSL home profile', !(await launchService.options(selection)).profiles!.some((item) => item.id === 'wsl-profile'));
  store.save({ agents: [], categories: [] }); const originalBindings = JSON.stringify(store.get().workspaceBindings);
  const choices = await launchService.options(selection);
  check('CLI discovery works without any saved agents', choices.choices.find((item) => item.mode === 'codex')!.available && choices.profiles!.length === 0 && !choices.choices.find((item) => item.mode === 'agent')!.available);
  for (const mode of ['codex', 'claude', 'grok', 'shell'] as const) {
    const settings = await launchService.effectiveSettings({ name: 'Ohne Agent-Profil', runtime: 'shell', permissionMode: 'default' }, 'native', { mode });
    check(`${mode} has profile-free default command`, resolveLaunchCommand(settings) === (mode === 'shell' ? '' : mode) && settings.permissionMode === 'default' && !settings.customCommand);
  }
  check('discovery and launch choices create no hidden agent or binding', !store.get().agents.length && JSON.stringify(store.get().workspaceBindings) === originalBindings);
  check('final positive control remains on selected real branch', execFileSync('git', ['-C', current!.workspaceDir, 'branch', '--show-current'], { encoding: 'utf8', windowsHide: true }).trim() === 'feature/tablet');
})().catch((error) => { failed++; console.error(error); }).finally(() => {
  if (dirname(resolve(root)) !== resolve(tmpdir())) throw new Error('unexpected fixture root'); rmSync(root, { recursive: true, force: true });
  console.log(`Project launch: ${passed} passed, ${failed} failed`); process.exitCode = failed ? 1 : 0;
});
