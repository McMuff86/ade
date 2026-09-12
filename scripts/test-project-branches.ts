import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { ConfigStore } from '../src/main/config/store';
import { ProjectDefaultsService } from '../src/main/settings/ProjectDefaultsService';
import { ProjectWorkspaceService } from '../src/main/repositories/ProjectWorkspaceService';
import { ProjectBranchService } from '../src/main/repositories/ProjectBranchService';
import { workspaceOperations } from '../src/main/repositories/WorkspaceOperationGate';
import type { ProjectBranchAction } from '../src/shared/projectBranches';
import type { RunWorkspaceLease, SessionMeta } from '../src/shared/types';

let passed = 0;
const check = (name: string, ok: boolean) => { if (!ok) throw new Error(name); passed++; console.log(`  ok  ${name}`); };
const refuses = async (name: string, operation: () => unknown, match?: RegExp) => { try { await operation(); } catch (error) { check(name, !match || match.test(String(error))); return; } throw new Error(name); };
const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'ade-project-branches-')));
const git = (path: string, args: string[]) => execFileSync('git', ['-C', path, '-c', 'core.hooksPath=NUL', '-c', 'core.fsmonitor=false',
  '-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost', '-c', 'commit.gpgSign=false', ...args], { windowsHide: true, timeout: 10000, encoding: 'utf8' }).trim();
void (async () => {
  const parent = join(root, 'projects'); const path = join(parent, 'Garden'); mkdirSync(path, { recursive: true });
  git(path, ['init', '--initial-branch=main']); git(path, ['config', 'core.autocrlf', 'false']); writeFileSync(join(path, 'README.md'), 'base\n'); git(path, ['add', 'README.md']); git(path, ['commit', '-m', 'Base']);
  const base = git(path, ['rev-parse', 'HEAD']); git(path, ['branch', 'feature/layout']);
  git(path, ['remote', 'add', 'origin', path]); git(path, ['update-ref', 'refs/remotes/origin/mobile', base]);
  git(path, ['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/mobile']);
  const store = new ConfigStore(join(root, 'profile', 'config.json')); new ProjectDefaultsService(store).save({ rootPath: parent, agentId: null });
  const projects = new ProjectWorkspaceService(store); const entry = (await projects.directory()).entries.find((item) => item.name === 'Garden')!;
  const workspace = await projects.open(entry.id); const sessions: SessionMeta[] = []; let now = Date.now();
  const branches = new ProjectBranchService(store, projects, () => sessions, () => now);
  const apply = async (action: ProjectBranchAction) => branches.apply((await branches.preview(workspace.id, action, 'desktop')).id, 'desktop');
  const overview = await branches.overview(workspace.id);
  check('native overview reads local and cached remote branches without fetching or following symbolic HEAD', overview.workspace.branch === 'main' && overview.head === base
    && overview.branches.length === 3 && overview.branches.some((item) => item.ref === 'refs/remotes/origin/mobile' && item.kind === 'remote'));
  check('branch and worktree DTOs contain opaque identities without host paths', overview.worktrees[0]?.id.startsWith('w') === true
    && !JSON.stringify(overview).includes(root.replace(/\\/g, '\\\\')) && !overview.dirty && !overview.blockedReason);
  const preview = await branches.preview(workspace.id, { kind: 'switch', ref: 'refs/heads/feature/layout' }, 'tablet');
  check('branch preview identifies exact transition without changing HEAD or branch', preview.fromBranch === 'main' && preview.toBranch === 'feature/layout' && !preview.separate
    && git(path, ['branch', '--show-current']) === 'main');
  await refuses('preview cannot be applied by another principal', () => branches.apply(preview.id, 'other'), /andere/);
  const switched = await branches.apply(preview.id, 'tablet');
  check('confirmed switch keeps the exact checkout and chooses selected branch', switched.id === workspace.id && switched.branch === 'feature/layout'
    && store.get().projectWorkspaces[0]?.workspaceDir === path && git(path, ['rev-parse', 'HEAD']) === base);
  await refuses('branch preview is single use', () => branches.apply(preview.id, 'tablet'), /abgelaufen/);
  await apply({ kind: 'create', name: 'feature/new', baseRef: 'refs/heads/main', separate: false });
  check('new local branch uses the selected committed basis without a worktree or agent', git(path, ['branch', '--show-current']) === 'feature/new'
    && git(path, ['rev-parse', 'HEAD']) === base && store.get().projectWorkspaces.length === 1 && !store.get().agents.length);
  await refuses('existing branch cannot be overwritten by create', () => apply({ kind: 'create', name: 'main', baseRef: null, separate: false }), /existiert bereits/);
  writeFileSync(join(path, 'README.md'), 'unsaved\n');
  await refuses('dirty current checkout blocks branch switching', () => apply({ kind: 'switch', ref: 'refs/heads/main' }), /Ungesicherte/);
  const additional = await apply({ kind: 'create', name: 'parallel/tablet', baseRef: 'refs/heads/main', separate: true });
  const copy = store.get().projectWorkspaces.find((item) => item.id === additional.id)!;
  check('explicit additional worktree starts from base and preserves unsaved source changes', additional.kind === 'worktree' && additional.branch === 'parallel/tablet'
    && copy.workspaceDir !== path && readFileSync(join(path, 'README.md'), 'utf8') === 'unsaved\n' && readFileSync(join(copy.workspaceDir, 'README.md'), 'utf8') === 'base\n');
  check('additional checkout is independent of agent bindings and keeps common repository', store.get().projectWorkspaces.length === 2
    && additional.repositoryId === workspace.repositoryId && !store.get().workspaceBindings.length && !existsSync(join(copy.workspaceDir, 'AGENTS.md')));
  writeFileSync(join(path, 'README.md'), 'base\n');
  const withCopy = await branches.overview(workspace.id); const copyEntry = withCopy.worktrees.find((item) => item.branch === 'parallel/tablet')!;
  await refuses('branch checked out elsewhere is not silently stolen', () => apply({ kind: 'switch', ref: 'refs/heads/parallel/tablet' }), /anderen Arbeitskopie/);
  const adopted = await apply({ kind: 'open-worktree', worktreeId: copyEntry.id });
  check('explicit existing worktree selection reuses its registered identity', adopted.id === additional.id && store.get().projectWorkspaces.length === 2);
  sessions.push({ id: 'live', agentId: 'fixture', title: 'Shell', kind: 'interactive', status: 'running', createdAt: 1, workspaceDir: path, executionBackend: 'native' });
  await refuses('open shell blocks switching its working directory branch', () => apply({ kind: 'switch', ref: 'refs/heads/main' }), /Terminalsitzung/);
  const parallelLive = await apply({ kind: 'create', name: 'parallel/live', baseRef: null, separate: true });
  check('parallel worktree does not retarget an existing live shell', parallelLive.id !== workspace.id && sessions[0]?.workspaceDir === path && git(path, ['branch', '--show-current']) === 'feature/new');
  sessions.length = 0;
  const lease: RunWorkspaceLease = { id: 'lease', status: 'active', commonGitDir: store.get().repositories[0]!.commonGitDir,
    runId: 'run', participantId: 'participant', agentId: 'fixture', workspaceDir: copy.workspaceDir, isRepo: true, branch: additional.branch, baseSha: base, acquiredAt: 1 };
  store.save({ runWorkspaceLeases: [lease] });
  await refuses('managed repository lease blocks even separate branch worktree creation', () => apply({ kind: 'create', name: 'parallel/leased', baseRef: null, separate: true }), /verwalteten Auftrag/);
  store.save({ runWorkspaceLeases: [] });
  const stale = await branches.preview(workspace.id, { kind: 'switch', ref: 'refs/heads/main' }, 'desktop');
  git(path, ['branch', 'unrelated-change']);
  await refuses('ref drift after preview blocks mutation', () => branches.apply(stale.id, 'desktop'), /seit der Vorschau/);
  const dirtyPreview = await branches.preview(workspace.id, { kind: 'switch', ref: 'refs/heads/main' }, 'desktop');
  writeFileSync(join(path, 'draft.txt'), 'keep');
  await refuses('new untracked files after preview block mutation', () => branches.apply(dirtyPreview.id, 'desktop'), /seit der Vorschau/);
  rmSync(join(path, 'draft.txt'));
  const expired = await branches.preview(workspace.id, { kind: 'switch', ref: 'refs/heads/main' }, 'desktop'); now += 5 * 60_000 + 1;
  await refuses('expired preview cannot mutate', () => branches.apply(expired.id, 'desktop'), /abgelaufen/);
  let checks = 0; const revoked = await branches.preview(workspace.id, { kind: 'switch', ref: 'refs/heads/main' }, 'desktop');
  await refuses('authorization is rechecked immediately before Git mutation', () => branches.apply(revoked.id, 'desktop', () => { if (++checks > 1) throw new Error('revoked'); }), /revoked/);
  check('revocation leaves branch unchanged', checks === 2 && git(path, ['branch', '--show-current']) === 'feature/new');
  writeFileSync(join(path, '.git', 'MERGE_HEAD'), `${base}\n`);
  await refuses('unfinished Git operation blocks another branch operation', () => apply({ kind: 'switch', ref: 'refs/heads/main' }), /Git-Operation/);
  await refuses('unfinished Git operation also blocks additional worktrees', () => apply({ kind: 'create', name: 'parallel/merge', baseRef: null, separate: true }), /Git-Operation/);
  rmSync(join(path, '.git', 'MERGE_HEAD'));
  const marker = join(root, 'hook-ran'); writeFileSync(join(path, '.git', 'hooks', 'post-checkout'), `#!/bin/sh\nprintf bad > '${marker.replace(/\\/g, '/')}'\n`);
  await apply({ kind: 'switch', ref: 'refs/remotes/origin/mobile' });
  check('remote branch starts an explicitly named local tracking branch', git(path, ['branch', '--show-current']) === 'mobile' && git(path, ['rev-parse', '--abbrev-ref', '@{upstream}']) === 'origin/mobile');
  check('branch switching never executes repository checkout hooks', !existsSync(marker));
  const sessionRace = await branches.preview(workspace.id, { kind: 'switch', ref: 'refs/heads/main' }, 'desktop');
  sessions.push({ id: 'raced', agentId: 'fixture', title: 'CLI', kind: 'interactive', status: 'running', createdAt: 2, workspaceDir: path });
  await refuses('session that starts after preview blocks the actual switch', () => branches.apply(sessionRace.id, 'desktop'), /Terminalsitzung/); sessions.length = 0;
  const adoptionPreview = await branches.preview(workspace.id, { kind: 'create', name: 'parallel/recover', baseRef: null, separate: true }, 'desktop');
  const registeredBefore = store.get().projectWorkspaces.length;
  await refuses('revocation after worktree creation reports failure without erasing created files', () => branches.apply(adoptionPreview.id, 'desktop', () => {
    if (git(path, ['worktree', 'list', '--porcelain']).includes('branch refs/heads/parallel/recover')) throw new Error('revoked');
  }), /revoked/);
  const recoverable = (await branches.overview(workspace.id)).worktrees.find((item) => item.branch === 'parallel/recover')!;
  check('partially completed worktree remains discoverable for explicit recovery', !!recoverable && recoverable.available && store.get().projectWorkspaces.length === registeredBefore);
  const recovered = await apply({ kind: 'open-worktree', worktreeId: recoverable.id });
  check('recovery adopts the one created worktree rather than creating another branch', recovered.branch === 'parallel/recover' && store.get().projectWorkspaces.length === registeredBefore + 1);
  const movedPreview = await branches.preview(workspace.id, { kind: 'switch', ref: 'refs/heads/main' }, 'desktop');
  const moved = join(parent, 'Moved'); renameSync(path, moved);
  try { await refuses('moving the source checkout invalidates branch confirmation', () => branches.apply(movedPreview.id, 'desktop')); }
  finally { renameSync(moved, path); }
  const gated = await branches.preview(workspace.id, { kind: 'switch', ref: 'refs/heads/main' }, 'desktop');
  let release!: () => void; const held = workspaceOperations.use(() => new Promise<void>((done) => { release = done; }));
  await refuses('in-flight workspace preparation fences branch mutation without consuming its preview', () => branches.apply(gated.id, 'desktop'), /Workspace-Vorbereitung/); release(); await held;
  check('same preview works once the independent preparation finishes', (await branches.apply(gated.id, 'desktop')).branch === 'main');
  git(path, ['switch', '-c', 'with-ignored-file']); writeFileSync(join(path, 'local-only.txt'), 'tracked on feature\n');
  git(path, ['add', 'local-only.txt']); git(path, ['commit', '-m', 'Feature file']); git(path, ['switch', 'main']);
  writeFileSync(join(path, '.git', 'info', 'exclude'), 'local-only.txt\n'); writeFileSync(join(path, 'local-only.txt'), 'local private data\n');
  await refuses('switch refuses to overwrite an ignored local file', () => apply({ kind: 'switch', ref: 'refs/heads/with-ignored-file' }), /nicht bestätigt/);
  check('ignored-file refusal preserves the original branch and exact local bytes', git(path, ['branch', '--show-current']) === 'main'
    && readFileSync(join(path, 'local-only.txt'), 'utf8') === 'local private data\n');
  const extraRefs = Array.from({ length: 201 }, (_, i) => `refs/heads/limit-${i}`);
  const updateRefs = (remove: boolean) => execFileSync('git', ['-C', path, 'update-ref', '--stdin'], { windowsHide: true, timeout: 10000,
    input: extraRefs.map((ref) => remove ? `delete ${ref}\n` : `create ${ref} ${base}\n`).join('') });
  updateRefs(false);
  try { await refuses('oversized branch inventory fails explicitly rather than hiding targets', () => branches.overview(workspace.id), /Maximal 200/); }
  finally { updateRefs(true); }
  const beforeEnv = process.env.GIT_DIR; process.env.GIT_DIR = root;
  try { check('inherited Git override cannot redirect branch actions', (await branches.overview(workspace.id)).workspace.branch === 'main'); }
  finally { if (beforeEnv === undefined) delete process.env.GIT_DIR; else process.env.GIT_DIR = beforeEnv; }
  const unborn = join(parent, 'empty'); mkdirSync(unborn); git(unborn, ['init', '--initial-branch=master']);
  const empty = await projects.open((await projects.directory()).entries.find((item) => item.name === 'empty')!.id);
  check('unborn repository reports its branch without inventing a commit', (await branches.overview(empty.id)).head === null);
  const unbornPreview = await branches.preview(empty.id, { kind: 'create', name: 'fresh', baseRef: null, separate: false }, 'desktop');
  check('unborn current workspace can take a new branch name', (await branches.apply(unbornPreview.id, 'desktop')).branch === 'fresh');
  await refuses('unborn repository explains why separate worktree needs a first commit', () => branches.preview(empty.id, { kind: 'create', name: 'other', baseRef: null, separate: true }, 'desktop'), /zuerst einen Commit/);
  check('final positive branch switch succeeds after all negative controls', (await apply({ kind: 'switch', ref: 'refs/heads/main' })).branch === 'main'
    && readFileSync(join(path, 'README.md'), 'utf8') === 'base\n');
  console.log(`Project branches: ${passed} passed, 0 failed`);
})().catch((error) => { console.error(error); console.log(`Project branches: ${passed} passed, 1 failed`); process.exitCode = 1; })
  .finally(() => { if (dirname(root) !== realpathSync.native(tmpdir())) throw new Error('Unexpected fixture root'); rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });
