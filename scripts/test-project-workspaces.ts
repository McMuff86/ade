import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigStore, validateCompleteConfig } from '../src/main/config/store';
import { normalizeConfig } from '../src/main/orchestration/migrate';
import { ProjectWorkspaceService } from '../src/main/repositories/ProjectWorkspaceService';
import { ProjectDefaultsService } from '../src/main/settings/ProjectDefaultsService';
import { workspaceOperations } from '../src/main/repositories/WorkspaceOperationGate';
import { DEFAULT_CONFIG } from '../src/shared/types';
import { validProjectBranchAction, validProjectBranchName, validProjectBranchRef } from '../src/shared/projectBranches';

let passed = 0;
const check = (name: string, ok: boolean): void => { if (!ok) throw new Error(name); passed++; console.log(`  ok  ${name}`); };
const refuses = async (name: string, fn: () => unknown, match?: RegExp): Promise<void> => {
  try { await fn(); } catch (error) { check(name, !match || match.test(String(error))); return; } throw new Error(name);
};
const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'ade-project-workspaces-')));
const hooks = join(root, 'no-hooks'); mkdirSync(hooks);
const git = (path: string, args: string[]): string => execFileSync('git', ['-C', path, '-c', `core.hooksPath=${hooks}`, '-c', 'core.fsmonitor=false',
  '-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost', '-c', 'commit.gpgSign=false', ...args], { encoding: 'utf8', windowsHide: true, timeout: 10000 }).trim();
void (async () => {
  check('branch contract accepts ordinary nested and Unicode branch names', ['main', 'feature/tablet', 'Änderung'].every(validProjectBranchName));
  check('branch contract refuses option, reflog, wildcard and traversal syntax', ['-f', '@{-1}', 'a..b', 'a b', 'a.lock', '.hidden', 'a//b', 'HEAD', 'a*'].every((name) => !validProjectBranchName(name)));
  check('branch references are confined to local and remote branch namespaces', validProjectBranchRef('refs/heads/main') && validProjectBranchRef('refs/remotes/origin/topic')
    && !validProjectBranchRef('HEAD~1') && !validProjectBranchRef('refs/tags/release'));
  check('branch action contract accepts explicit switch, create and opaque worktree selections', validProjectBranchAction({ kind: 'switch', ref: 'refs/heads/main' })
    && validProjectBranchAction({ kind: 'create', name: 'topic', baseRef: null, separate: true }) && validProjectBranchAction({ kind: 'open-worktree', worktreeId: 'w' + 'a'.repeat(32) }));
  check('branch action contract rejects hidden execution parameters and host paths', !validProjectBranchAction({ kind: 'switch', ref: 'refs/heads/main', command: 'whoami' })
    && !validProjectBranchAction({ kind: 'open-worktree', worktreeId: root }));
  const parent = join(root, 'projects'); mkdirSync(parent);
  const configFile = join(root, 'profile', 'config.json');
  const store = new ConfigStore(configFile); const defaults = new ProjectDefaultsService(store); const service = new ProjectWorkspaceService(store);
  const empty = await service.directory();
  check('unset project root explains setup without inventing projects', !empty.configured && !empty.entries.length && !!empty.notice);
  const main = join(parent, "Ä project 'one'"); mkdirSync(main); git(main, ['init', '--initial-branch=main']);
  writeFileSync(join(main, 'AGENTS.md'), 'Repository instructions stay unchanged.\n');
  git(main, ['add', 'AGENTS.md']); git(main, ['commit', '-m', 'Initial']);
  const originalInstructions = readFileSync(join(main, 'AGENTS.md'), 'utf8');
  const folder = join(parent, 'empty-idea'); mkdirSync(folder);
  const hidden = join(parent, '.ade-worktrees'); mkdirSync(hidden);
  const nodeModules = join(parent, 'node_modules'); mkdirSync(nodeModules);
  const outside = join(root, 'outside'); mkdirSync(outside);
  const link = join(parent, 'linked-outside'); symlinkSync(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
  defaults.save({ rootPath: parent, agentId: null });
  const before = readFileSync(configFile, 'utf8'); const directory = await service.directory();
  check('discovery includes unregistered repository and ordinary empty folder', directory.entries.some((item) => item.kind === 'repository' && !item.repositoryId)
    && directory.entries.some((item) => item.name === 'empty-idea' && item.kind === 'folder'));
  check('discovery neither registers projects nor changes config', readFileSync(configFile, 'utf8') === before && !store.get().agents.length);
  check('ADE internals and node_modules are omitted and external junction is unavailable', !directory.entries.some((item) => ['.ade-worktrees', 'node_modules'].includes(item.name))
    && directory.entries.find((item) => item.name === 'linked-outside')?.kind === 'unavailable');
  check('directory DTO contains names and opaque IDs without native paths', directory.entries.every((item) => /^p[a-f0-9]{32}$/.test(item.id))
    && !JSON.stringify(directory).includes(root.replace(/\\/g, '\\\\')));
  const selected = directory.entries.find((item) => item.kind === 'repository')!;
  await refuses('caller cannot open arbitrary host path as entry ID', () => service.open(main), /ungültig/);
  await refuses('ordinary folder is not silently initialized as Git', () => service.open(directory.entries.find((item) => item.name === 'empty-idea')!.id), /Git-Repository/);
  await refuses('junction cannot become a project workspace', () => service.open(directory.entries.find((item) => item.name === 'linked-outside')!.id), /Git-Repository/);
  const opened = await service.open(selected.id);
  check('opening creates one project workspace without an agent or agent binding', store.get().projectWorkspaces.length === 1 && !store.get().agents.length
    && !store.get().workspaceBindings.length && opened.branch === 'main' && opened.kind === 'checkout');
  check('profile-free workspace uses the selected checkout without injecting instructions', store.get().projectWorkspaces[0]!.workspaceDir === main
    && readFileSync(join(main, 'AGENTS.md'), 'utf8') === originalInstructions && !existsSync(join(main, 'CLAUDE.md')) && git(main, ['status', '--porcelain']) === '');
  const reopened = await Promise.all([service.open(selected.id), service.open(selected.id)]);
  check('repeated and concurrent opens keep one workspace identity', reopened.every((item) => item.id === opened.id) && store.get().projectWorkspaces.length === 1);
  const registered = await service.directory();
  check('registered project is merged with its discovered folder instead of duplicated', registered.entries.filter((item) => item.repositoryId === opened.repositoryId).length === 1);
  const persisted = new ConfigStore(configFile); const restored = new ProjectWorkspaceService(persisted);
  check('workspace identity and branch survive a real config reload', (await restored.overview(opened.id)).id === opened.id && !persisted.getLoadFailure());
  validateCompleteConfig(persisted.get());
  check('new config contract is canonical and re-normalization is stable', !normalizeConfig(persisted.get()).migrated);
  await refuses('workspace schema refuses relative paths', () => validateCompleteConfig({ ...store.get(), projectWorkspaces: [
    { ...store.get().projectWorkspaces[0]!, workspaceDir: 'relative-checkout' },
  ] }));
  await refuses('independent workspace schema cannot carry a hidden agent profile', () => validateCompleteConfig({ ...store.get(), projectWorkspaces: [
    { ...store.get().projectWorkspaces[0]!, agentId: 'hidden-profile' } as never,
  ] }));
  const oldGitDir = process.env.GIT_DIR;
  try {
    process.env.GIT_DIR = outside;
    check('inherited Git location overrides cannot redirect project reads', (await service.overview(opened.id)).branch === 'main');
  } finally { if (oldGitDir === undefined) delete process.env.GIT_DIR; else process.env.GIT_DIR = oldGitDir; }
  git(main, ['switch', '--detach']);
  check('detached HEAD is reported truthfully while checkout identity remains stable', (await service.overview(opened.id)).branch === '(detached HEAD)');
  git(main, ['switch', 'main']);
  await refuses('config replacement cannot forge an unrelated project workspace', () => persisted.replace({ ...persisted.get(), projectWorkspaces: [] }), /unrelated config collection/);

  const linked = join(parent, 'topic-worktree'); git(main, ['worktree', 'add', '-b', 'topic', linked]);
  const linkedEntry = (await service.directory()).entries.find((item) => item.name === 'topic-worktree')!;
  const linkedView = await service.open(linkedEntry.id);
  check('existing linked worktree gets its own exact workspace and shares repository identity', linkedView.id !== opened.id && linkedView.repositoryId === opened.repositoryId
    && linkedView.kind === 'worktree' && linkedView.branch === 'topic' && store.get().projectWorkspaces.at(-1)!.workspaceDir === linked);
  check('main-owned worktree adoption keeps the exact identity without another profile or binding', (await workspaceOperations.mutate(() => service.registerCheckout(linked, opened.repositoryId, () => undefined))).id === linkedView.id
    && !store.get().agents.length && !store.get().workspaceBindings.length);
  await refuses('worktree adoption rechecks authorization', () => workspaceOperations.mutate(() => service.registerCheckout(linked, opened.repositoryId, () => { throw new Error('revoked'); })), /revoked/);
  git(outside, ['init', '--initial-branch=main']);
  await refuses('worktree adoption refuses another repository despite a caller-provided expected identity', () => workspaceOperations.mutate(() => service.registerCheckout(outside, opened.repositoryId, () => undefined)), /gehört nicht/);
  const otherStore = new ConfigStore(join(root, 'other-profile', 'config.json')); new ProjectDefaultsService(otherStore).save({ rootPath: parent, agentId: null });
  await new ProjectWorkspaceService(otherStore).open(linkedEntry.id);
  check('discovering a linked worktree first still registers the canonical main checkout', otherStore.get().repositories[0]!.rootPath === main);
  const pointer = readFileSync(join(linked, '.git'), 'utf8'); writeFileSync(join(linked, '.git'), pointer + '\n', { flag: 'r+' });
  await refuses('modified git pointer invalidates saved workspace before reuse', () => service.resolve(linkedView.id), /verschoben oder ersetzt/);

  let release!: () => void; const held = workspaceOperations.mutate(() => new Promise<void>((done) => { release = done; }));
  await refuses('workspace opening refuses an active Git mutation fence', () => service.open(selected.id), /Git-Aktualisierung/); release(); await held;
  const moved = join(parent, 'renamed-main'); renameSync(main, moved);
  await refuses('stale directory ID cannot open a renamed folder', () => service.open(selected.id), /geändert/);
  await refuses('saved project workspace fails closed after its checkout disappears', () => service.resolve(opened.id));
  renameSync(moved, main);
  const parentMoved = join(root, 'old-projects'); renameSync(parent, parentMoved); mkdirSync(parent);
  const replaced = await service.directory();
  check('replaced project root is reported instead of scanning its new contents', !!replaced.notice && !replaced.entries.some((item) => item.source === 'root'));
  rmdirSync(parent); renameSync(parentMoved, parent);

  const legacy = structuredClone(DEFAULT_CONFIG); delete (legacy as Partial<typeof legacy>).projectWorkspaces;
  const normalized = normalizeConfig(legacy); validateCompleteConfig(normalized.config);
  check('legacy config gains an empty workspace collection without creating identities', normalized.migrated && !normalized.config.projectWorkspaces.length && !normalized.config.agents.length);
  await refuses('malformed workspace collection is not silently erased by migration', () => validateCompleteConfig(normalizeConfig({ ...legacy, projectWorkspaces: {} as never }).config));
  const unborn = join(parent, 'unborn-project'); mkdirSync(unborn); git(unborn, ['init', '--initial-branch=master']);
  const unbornEntry = (await service.directory()).entries.find((item) => item.name === 'unborn-project')!;
  check('a repository without a first commit opens on its actual master branch', (await service.open(unbornEntry.id)).branch === 'master');
  const cappedRoot = join(root, 'many-projects'); mkdirSync(cappedRoot);
  for (let n = 0; n < 505; n++) mkdirSync(join(cappedRoot, `folder-${n}`));
  defaults.save({ rootPath: cappedRoot, agentId: null });
  const capped = await service.directory();
  check('large project roots return a bounded listing with an explicit truncation flag', capped.limited && capped.entries.length === 500);
  check('final positive control resolves unchanged original workspace after discovery preference changes', (await service.resolve(opened.id)).workspace.workspaceDir === main);
  check('source instructions and empty idea remain untouched after all operations', readFileSync(join(main, 'AGENTS.md'), 'utf8') === originalInstructions && readdirSync(folder).length === 0);
  console.log(`Project workspaces: ${passed} passed, 0 failed`);
})().catch((error) => { console.error(error); console.log(`Project workspaces: ${passed} passed, 1 failed`); process.exitCode = 1; })
  .finally(() => rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
