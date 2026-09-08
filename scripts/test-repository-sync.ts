import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { DEFAULT_CONFIG, type AdeConfig, type SessionMeta } from '../src/shared/types';
import { RepositorySyncService } from '../src/main/repositories/RepositorySyncService';
import { BackendGitService } from '../src/main/execution/BackendGitService';
import { WorkspaceOperationGate } from '../src/main/repositories/WorkspaceOperationGate';
import { assertIpcPayload } from '../src/main/ipcValidation';

let passed = 0;
let failed = 0;
function check(name: string, condition: boolean): void {
  if (condition) { passed++; console.log(`  ok  ${name}`); }
  else { failed++; console.error(`FAIL  ${name}`); }
}
async function rejects(name: string, action: () => unknown, reason: RegExp): Promise<void> {
  try { await action(); check(name, false); }
  catch (error) { check(name, reason.test(String(error))); }
}
const root = mkdtempSync(join(tmpdir(), 'ade-git-sync-'));
const git = (path: string, args: string[]): string => execFileSync('git', ['-C', path, ...args], {
  encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
});
void (async () => {
  const repo = join(root, 'main'); const remote = join(root, 'remote.git'); const agent = join(root, 'agent');
  mkdirSync(repo);
  git(repo, ['init', '--initial-branch=main']); git(repo, ['config', 'user.name', 'ADE Git Tests']); git(repo, ['config', 'user.email', 'test@example.invalid']);
  writeFileSync(join(repo, 'base.txt'), 'base\n'); git(repo, ['add', '.']); git(repo, ['commit', '-m', 'base']);
  const base = git(repo, ['rev-parse', 'HEAD']).trim();
  git(repo, ['init', '--bare', remote]); git(repo, ['remote', 'add', 'origin', remote]); git(repo, ['push', '-u', 'origin', 'main']);
  git(repo, ['worktree', 'add', '-b', 'ade/test', agent]);
  writeFileSync(join(repo, 'next.txt'), 'next\n'); git(repo, ['add', '.']); git(repo, ['commit', '-m', 'local update']);
  const next = git(repo, ['rev-parse', 'HEAD']).trim();
  const identity = await new BackendGitService().identity('native', repo);
  const config: AdeConfig = { ...structuredClone(DEFAULT_CONFIG), repositories: [{ id: 'repo', name: 'Fixture',
    ...identity, executionBackend: 'native', verified: true, createdAt: 1 }],
    agents: [{ id: 'agent', categoryId: 'cat', name: 'Test Agent', runtime: 'shell', permissionMode: 'default', workspaceDir: agent, memoryDir: join(root, 'memory') }],
    workspaceBindings: [{ id: 'binding', agentId: 'agent', repositoryId: 'repo', workspaceDir: agent,
      branch: 'ade/test', status: 'ready', executionBackend: 'native', createdAt: 1, lastUsedAt: 1 }],
  };
  let sessions: SessionMeta[] = [];
  const gate = new WorkspaceOperationGate();
  const service = new RepositorySyncService({ get: () => config }, () => sessions, undefined, gate);
  let overview = await service.overview({ repositoryId: 'repo' });
  check('overview distinguishes main and agent heads', overview.targets[0]?.headSha === next && overview.targets[1]?.headSha === base);
  check('agent behind count compares with the selected local basis', overview.targets[1]?.behind === 1 && overview.targets[1]?.ahead === 0);
  check('cached remote is not presented as recently verified', overview.remoteCheckedAt === null);
  check('sync DTO contains no host paths', !JSON.stringify(overview).includes(root) && !JSON.stringify(overview).includes('workspaceDir'));
  writeFileSync(join(repo, 'uncommitted.txt'), 'keep my work');
  overview = await service.overview({ repositoryId: 'repo' });
  check('dirty main is explicit while its clean agent remains updateable', overview.targets[0]?.changedFiles === 1
    && Boolean(overview.targets[0]?.blockedReason) && overview.targets[1]?.blockedReason === null);
  const first = await service.preview({ repositoryId: 'repo', targetId: 'binding' });
  check('preview does not move either branch', git(agent, ['rev-parse', 'HEAD']).trim() === base && git(repo, ['rev-parse', 'HEAD']).trim() === next);
  const updated = await service.apply(first.id);
  check('confirmed agent fast-forward reaches the exact basis on its existing branch', updated.targets[1]?.headSha === next && git(agent, ['branch', '--show-current']).trim() === 'ade/test');
  check('agent update preserves uncommitted main work byte-for-byte', readFileSync(join(repo, 'uncommitted.txt'), 'utf8') === 'keep my work'
    && !existsSync(join(agent, 'uncommitted.txt')));
  await rejects('preview tokens are single-use', () => service.apply(first.id), /abgelaufen/);

  writeFileSync(join(repo, 'third.txt'), 'third\n'); git(repo, ['add', 'third.txt']); git(repo, ['commit', '-m', 'third']);
  const stale = await service.preview({ repositoryId: 'repo', targetId: 'binding' });
  writeFileSync(join(repo, 'fourth.txt'), 'fourth\n'); git(repo, ['add', 'fourth.txt']); git(repo, ['commit', '-m', 'fourth']);
  await rejects('source movement invalidates confirmation', () => service.apply(stale.id), /Basis-Branch seit/);
  const dirty = await service.preview({ repositoryId: 'repo', targetId: 'binding' });
  writeFileSync(join(agent, 'dirty.txt'), 'dirty');
  await rejects('new uncommitted target work blocks a prepared update', () => service.apply(dirty.id), /uncommittete/);
  rmSync(join(agent, 'dirty.txt'));
  const targetDrift = await service.preview({ repositoryId: 'repo', targetId: 'binding' });
  writeFileSync(join(agent, 'own.txt'), 'mine'); git(agent, ['add', '.']); git(agent, ['commit', '-m', 'own']);
  await rejects('own commits are never reset or overwritten', () => service.apply(targetDrift.id), /Eigene Commits/);
  check('divergence is shown with ahead and behind counts', (await service.overview({ repositoryId: 'repo' })).targets[1]?.ahead === 1);
  // Reset only the explicitly disposable fixture branch to set up independent negative controls.
  git(agent, ['reset', '--hard', next]);
  sessions = [{ id: 'session', agentId: 'agent', title: 'test', kind: 'interactive', status: 'running', createdAt: 1, workspaceDir: agent }];
  await rejects('live terminal blocks target mutation', () => service.preview({ repositoryId: 'repo', targetId: 'binding' }), /Terminal läuft/);
  sessions = [];
  config.runWorkspaceLeases.push({ id: 'lease', runId: 'run', participantId: 'participant', agentId: 'agent', workspaceDir: agent,
    repositoryId: 'repo', workspaceBindingId: 'binding', isRepo: true, branch: 'ade/test', baseSha: next,
    commonGitDir: identity.commonGitDir, status: 'active', acquiredAt: 1 });
  await rejects('active run lease blocks target mutation', () => service.preview({ repositoryId: 'repo', targetId: 'binding' }), /aktiven Run/);
  config.runWorkspaceLeases = [];
  const gitDir = git(agent, ['rev-parse', '--absolute-git-dir']).trim();
  mkdirSync(join(gitDir, 'rebase-merge'));
  await rejects('unfinished rebase blocks a clean worktree update', () => service.preview({ repositoryId: 'repo', targetId: 'binding' }), /Git-Operation/);
  const rebaseDir = resolve(gitDir, 'rebase-merge');
  const relativeMetadata = relative(realpathSync.native(root), realpathSync.native(rebaseDir));
  if (!relativeMetadata || relativeMetadata.startsWith('..') || isAbsolute(relativeMetadata)) throw new Error('unexpected fixture metadata directory');
  rmSync(rebaseDir, { recursive: true });
  git(agent, ['checkout', '--detach']);
  await rejects('detached agent HEAD is not moved', () => service.preview({ repositoryId: 'repo', targetId: 'binding' }), /Detached/);
  git(agent, ['checkout', 'ade/test']);

  // Another checkout publishes a new commit; fetching must never change local main or worktree files.
  const other = join(root, 'other'); git(repo, ['clone', '--branch', 'main', remote, other]);
  git(other, ['config', 'user.name', 'Other']); git(other, ['config', 'user.email', 'other@example.invalid']);
  writeFileSync(join(other, 'remote.txt'), 'remote'); git(other, ['add', '.']); git(other, ['commit', '-m', 'remote update']); git(other, ['push', 'origin', 'main']);
  const localHead = git(repo, ['rev-parse', 'HEAD']).trim();
  const agentHead = git(agent, ['rev-parse', 'HEAD']).trim();
  git(repo, ['config', '--replace-all', 'remote.origin.fetch', '+refs/heads/*:refs/heads/*']);
  overview = await service.fetch('repo');
  check('explicit fetch records successful remote freshness', overview.remoteCheckedAt !== null);
  check('fetch updates only remote-tracking refs even with a hostile configured refspec', git(repo, ['rev-parse', 'HEAD']).trim() === localHead
    && git(agent, ['rev-parse', 'HEAD']).trim() === agentHead && git(repo, ['rev-parse', 'origin/main']).trim() === git(other, ['rev-parse', 'HEAD']).trim());
  check('fetch preserves dirty source files', readFileSync(join(repo, 'uncommitted.txt'), 'utf8') === 'keep my work');
  overview = await service.overview({ repositoryId: 'repo', sourceRef: 'refs/remotes/origin/main' });
  check('remote basis can be selected independently from local main', overview.sourceRef === 'refs/remotes/origin/main' && (overview.targets[0]!.ahead ?? 0) > 0);

  let release!: () => void;
  const hold = gate.use(() => new Promise<void>((done) => { release = done; }));
  await rejects('launch preparation fences concurrent Git mutation', () => service.fetch('repo'), /Workspace-Vorbereitung/);
  release(); await hold;
  await gate.mutate(async () => {
    await rejects('Git mutation fences new launches', () => gate.use(async () => undefined), /Git-Aktualisierung/);
    await rejects('concurrent mutations cannot overlap', () => gate.mutate(async () => undefined), /Workspace-Vorbereitung/);
  });
  for (const sourceRef of ['main', '--upload-pack=x', 'refs/heads/main^{tree}', 'refs/heads/../main', 'refs/heads/main\n']) {
    await rejects('IPC refuses invalid source refs', () => assertIpcPayload('repository:syncOverview', { repositoryId: 'repo', sourceRef }), /invalid/);
  }
  await rejects('IPC refuses caller-supplied Git commands', () => assertIpcPayload('repository:fetch', { repositoryId: 'repo', command: 'pull' }), /unknown field/);
  await rejects('IPC requires a generated preview id', () => assertIpcPayload('repository:syncApply', { previewId: 'repo' }), /invalid/);
  const positive = await service.preview({ repositoryId: 'repo', targetId: 'binding', sourceRef: 'refs/heads/main' });
  await service.apply(positive.id);
  check('final positive fast-forward passes after negative controls', git(agent, ['rev-parse', 'HEAD']).trim() === localHead);

  const binding = config.workspaceBindings[0]!;
  binding.workspaceDir = join(root, 'missing');
  overview = await service.overview({ repositoryId: 'repo' });
  check('unreadable agent is unknown rather than clean and does not hide main', overview.targets[1]?.headSha === null
    && overview.targets[1]?.changedFiles === null && Boolean(overview.targets[1]?.blockedReason) && overview.targets[0]?.headSha === localHead);
  binding.workspaceDir = agent;

  // A clean main can also fast-forward; ignored files and post-merge hooks are separate negative controls.
  rmSync(join(repo, 'uncommitted.txt'));
  const editor = join(root, 'editor'); git(repo, ['worktree', 'add', '-b', 'sync/root-update', editor]);
  writeFileSync(join(editor, 'ignored.txt'), 'committed content'); git(editor, ['add', '.']); git(editor, ['commit', '-m', 'next basis']);
  const finalHead = git(editor, ['rev-parse', 'HEAD']).trim();
  writeFileSync(join(repo, '.git', 'info', 'exclude'), 'ignored.txt\n');
  writeFileSync(join(agent, 'ignored.txt'), 'private ignored content');
  const ignored = await service.preview({ repositoryId: 'repo', targetId: 'binding', sourceRef: 'refs/heads/sync/root-update' });
  await rejects('fast-forward refuses overwriting an ignored local file', () => service.apply(ignored.id), /Git-Aktion fehlgeschlagen/);
  check('ignored file and branch survive the refusal', readFileSync(join(agent, 'ignored.txt'), 'utf8') === 'private ignored content'
    && git(agent, ['rev-parse', 'HEAD']).trim() === localHead);
  const hook = join(repo, '.git', 'hooks', 'post-merge');
  writeFileSync(hook, '#!/bin/sh\nprintf hook > hook-ran.txt\n'); chmodSync(hook, 0o755);
  const rootPreview = await service.preview({ repositoryId: 'repo', targetId: 'repository', sourceRef: 'refs/heads/sync/root-update' });
  await service.apply(rootPreview.id);
  check('clean main fast-forwards without running repository hooks', git(repo, ['rev-parse', 'HEAD']).trim() === finalHead && !existsSync(join(repo, 'hook-ran.txt')));
  const drift = await service.preview({ repositoryId: 'repo', targetId: 'binding', sourceRef: 'refs/heads/main' });
  binding.workspaceDir = editor;
  await rejects('changed worktree binding invalidates a prepared update', () => service.apply(drift.id), /Zuordnung geändert/);
  binding.workspaceDir = agent;
  rmSync(join(agent, 'ignored.txt'));
  await service.apply((await service.preview({ repositoryId: 'repo', targetId: 'binding' })).id);
  check('final positive agent update succeeds after ignored-file and binding controls', git(agent, ['rev-parse', 'HEAD']).trim() === finalHead);
})().catch((error) => { failed++; console.error(error); }).finally(() => {
  if (dirname(resolve(root)) !== resolve(tmpdir())) throw new Error('unexpected temporary root');
  rmSync(root, { recursive: true, force: true });
  console.log(`\nRepository sync: ${passed} passed, ${failed} failed`);
  if (failed) process.exitCode = 1;
});
