import { execFileSync } from 'node:child_process';
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRemoteWorkspaceFixture } from './remoteWorkspaceFixture';
import { projectGit } from '../../src/main/repositories/ProjectGitBoundary';
import type { ProjectGhCommand } from '../../src/main/repositories/ProjectPublishService';
import { projectRootIdentity } from '../../src/main/settings/ProjectDefaultsService';

/** Real native repository and bare remote; GitHub network/provider is a deterministic command port. */
export function projectPublishFixture(root: string) {
  root = realpathSync.native(root);
  const remote = join(root, 'publish-remote.git'); mkdirSync(remote, { recursive: true });
  const runAt = (cwd: string, ...args: string[]) => execFileSync('git', ['-C', cwd, '-c', 'commit.gpgSign=false', ...args], { encoding: 'utf8', windowsHide: true }).trim();
  runAt(remote, 'init', '--bare');
  const providerUrl = 'https://github.com/ade-fixture/review.git'; const ghCalls: { args: string[]; input?: string }[] = []; const gitCalls: string[][] = [];
  const controls = { providerDown: false, loseCreatedReply: false, unsafeUrl: false, prCount: 0 };
  const prs: Record<string, unknown>[] = [];
  const gh: ProjectGhCommand = async (cwd, args, input) => {
    ghCalls.push({ args: [...args], input }); if (controls.providerDown) throw new Error('provider unavailable');
    const arg = (name: string) => args[args.indexOf(name) + 1]!;
    if (args[0] !== 'pr' || arg('--repo') !== 'github.com/ade-fixture/review') throw new Error('unexpected provider target');
    if (args[1] === 'list') return JSON.stringify(prs.map((pr) => controls.unsafeUrl ? { ...pr, url: 'https://invalid.example/pull/1' } : pr));
    if (args[1] !== 'create' || arg('--body-file') !== '-' || !args.includes('--head') || !args.includes('--base')) throw new Error('unexpected provider operation');
    controls.prCount++; const number = controls.prCount;
    const record = { number, url: `https://github.com/ade-fixture/review/pull/${number}`, headRefName: arg('--head'), headRefOid: runAt(cwd, 'rev-parse', 'HEAD'),
      baseRefName: arg('--base'), isDraft: args.includes('--draft'), isCrossRepository: false };
    prs.push(record); if (controls.loseCreatedReply) { controls.loseCreatedReply = false; throw new Error('lost successful create reply'); }
    return record.url;
  };
  const git: typeof projectGit = async (cwd, args, timeout) => {
    gitCalls.push([...args]);
    // This mapping exists only inside the test's injected command port, never product configuration.
    return projectGit(cwd, args.map((arg) => arg === providerUrl ? remote : arg), timeout);
  };
  const f = createRemoteWorkspaceFixture(root, { gh, git });
  return { ...f, remote, providerUrl, runAt, controls, prs, ghCalls, gitCalls, publicationGit: git,
    async setup() {
      const parent = join(root, 'publish-projects'); const cwd = join(parent, 'Publication demo'); mkdirSync(cwd, { recursive: true });
      const run = (...args: string[]) => runAt(cwd, ...args);
      run('init', '--initial-branch=main'); run('config', 'core.autocrlf', 'false'); run('config', 'user.name', 'ADE fixture'); run('config', 'user.email', 'fixture@example.invalid');
      writeFileSync(join(cwd, 'README.md'), 'base\n'); run('add', '.'); run('commit', '-m', 'base'); run('push', remote, 'main');
      run('remote', 'add', 'origin', remote); run('fetch', 'origin'); run('switch', '-c', 'feature/review');
      writeFileSync(join(cwd, 'README.md'), 'reviewed delivery\n'); run('add', '.'); run('commit', '-m', 'Reviewed delivery');
      f.store.save({ settings: { ...f.store.get().settings, projectDefaults: { rootPath: parent, rootIdentity: projectRootIdentity(parent) } } });
      const entry = (await f.projects.directory()).entries.find((item) => item.name === 'Publication demo')!;
      const workspace = await f.projects.open(entry.id);
      return { cwd, run, workspace, entry, useGitHub: () => run('remote', 'set-url', 'origin', providerUrl) };
    },
  };
}
