import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { projectPublishFixture } from './helpers/projectPublishFixture';
import { ProjectPublishService } from '../src/main/repositories/ProjectPublishService';
import { RemoteApiError, type RemoteCommandContext } from '../src/main/application/AdeApplicationService';
import { validProjectWorkspaceCommand, validProjectWorkspaceQuery } from '../src/shared/projectWorkspaceRequests';
import { validProjectPublishAction } from '../src/shared/projectPublish';

let passed = 0; let failed = 0;
const check = (label: string, ok: boolean) => { if (ok) { passed++; console.log(`  ok  ${label}`); } else { failed++; console.error(`FAIL  ${label}`); } };
async function rejects(label: string, call: () => unknown, expected: RegExp) { try { await call(); check(label, false); } catch (error) { check(label, expected.test(String(error))); } }
const root = mkdtempSync(join(tmpdir(), 'ade-publish-'));
void (async () => {
  const f = projectPublishFixture(root); const { cwd, run, workspace, useGitHub } = await f.setup(); const service = f.projectPublish;
  const preview = (action: Parameters<typeof service.preview>[1]) => service.preview(workspace.id, action, 'desktop');
  const apply = async (action: Parameters<typeof service.preview>[1]) => service.apply((await preview(action)).id, 'desktop');
  const head = run('rev-parse', 'HEAD');
  check('publication DTOs reject forced push, unknown argv and host path fields', !validProjectPublishAction({ kind: 'push', remote: 'origin', force: true })
    && !validProjectWorkspaceQuery({ operation: 'publish-preview', workspaceId: workspace.id, action: { kind: 'push', remote: '--mirror' } })
    && !validProjectWorkspaceCommand({ operation: 'publish-apply', previewId: randomUUID(), path: cwd }));
  const state = await service.status(workspace.id, 'origin');
  check('status accurately reports absent remote branch with path-free local target', state.remoteHead === null && state.branch === 'feature/review' && !JSON.stringify(state).includes(root));
  const initial = await preview({ kind: 'push', remote: 'origin' });
  check('first push preview shows exact HEAD, target and files before mutation', initial.status.head === head && initial.changedFiles.includes('README.md') && !runAtRemote('show-ref', '--heads').includes('feature/review'));
  await rejects('another principal cannot consume publication preview', () => service.apply(initial.id, 'other'), /abgelaufen/);
  const done = await service.apply(initial.id, 'desktop');
  check('explicit push creates only reviewed remote branch with exact commit', runAtRemote('rev-parse', 'feature/review') === head && done.publication.head === head && done.publication.url === null);
  check('push argv disables force, tags and recursive submodule publication', f.gitCalls.some((args) => args.includes('push') && args.includes('--no-force') && args.includes('--no-follow-tags') && args.includes('--recurse-submodules=no') && args.includes(`${head}:refs/heads/feature/review`)));
  await rejects('consumed preview never repeats push', () => service.apply(initial.id, 'desktop'), /abgelaufen/);
  const stale = await preview({ kind: 'push', remote: 'origin' }); writeFileSync(join(cwd, 'new.txt'), 'new\n'); run('add', '.'); run('commit', '-m', 'local head moved');
  await rejects('local HEAD drift invalidates publication', () => service.apply(stale.id, 'desktop'), /geändert/);
  const rejected = await preview({ kind: 'push', remote: 'origin' });
  await rejects('revoked authorization fails before push', () => service.apply(rejected.id, 'desktop', () => { throw new Error('revoked'); }), /revoked/);
  check('authorization rejection leaves remote unchanged', runAtRemote('rev-parse', 'feature/review') === head);
  f.sessions.push({ id: 'active', title: 'Shell', kind: 'interactive', status: 'running', createdAt: 1, workspaceDir: cwd });
  await rejects('live project PTY blocks publication', () => preview({ kind: 'push', remote: 'origin' }), /Terminalsitzung/); f.sessions.length = 0;
  let clock = 10; const delayed = new ProjectPublishService(f.projectGit, undefined, () => clock);
  const expiring = await delayed.preview(workspace.id, { kind: 'push', remote: 'origin' }, 'desktop');
  check('publication has bounded five-minute preview', expiring.expiresAt === 300_010);
  clock = 300_011; await rejects('expired publication cannot execute', () => delayed.apply(expiring.id, 'desktop'), /abgelaufen/);
  const hook = join(cwd, '.git', 'hooks', 'pre-push'); mkdirSync(dirname(hook), { recursive: true }); writeFileSync(hook, '#!/bin/sh\necho ran > hook-ran.txt\n');
  await apply({ kind: 'push', remote: 'origin' }); check('project push does not run local hooks', !existsSync(join(cwd, 'hook-ran.txt')));
  const remoteDrift = await preview({ kind: 'push', remote: 'origin' }); const peer = join(root, 'peer');
  f.runAt(root, 'clone', '--branch', 'feature/review', f.remote, peer); f.runAt(peer, 'config', 'user.name', 'Peer'); f.runAt(peer, 'config', 'user.email', 'peer@example.invalid');
  writeFileSync(join(peer, 'peer.txt'), 'remote contribution\n'); f.runAt(peer, 'add', '.'); f.runAt(peer, 'commit', '-m', 'remote movement'); f.runAt(peer, 'push', 'origin', 'feature/review');
  await rejects('remote HEAD drift invalidates already approved target', () => service.apply(remoteDrift.id, 'desktop'), /geändert/);
  writeFileSync(join(cwd, 'local.txt'), 'local contribution\n'); run('add', '.'); run('commit', '-m', 'divergent local'); run('fetch', 'origin');
  await rejects('divergent push refuses replacement even with both commits available', () => preview({ kind: 'push', remote: 'origin' }), /kein Force-Push/);
  check('divergent rejection preserves peer commit and unrelated main branch', runAtRemote('rev-parse', 'feature/review') === f.runAt(peer, 'rev-parse', 'HEAD') && runAtRemote('rev-parse', 'main') === run('rev-parse', 'main'));
  run('merge', '--no-edit', 'origin/feature/review'); await apply({ kind: 'push', remote: 'origin' });
  check('explicit merge followed by push preserves both contributions', runAtRemote('rev-parse', 'feature/review') === run('rev-parse', 'HEAD') && existsSync(join(cwd, 'peer.txt')));
  useGitHub(); const action = { kind: 'pr' as const, remote: 'origin', base: 'main', title: 'Reviewed feature', body: 'Tested changes.\n\nLiteral `code` and $(text).', draft: true };
  const pr = await preview(action);
  check('PR preview pins provider, source, base and complete user body', pr.status.provider === 'ade-fixture/review' && pr.baseHead === runAtRemote('rev-parse', 'main') && pr.action.kind === 'pr' && pr.action.body === action.body);
  const prDone = await service.apply(pr.id, 'desktop');
  check('PR creation is explicit draft with safe verified URL', prDone.publication.url === 'https://github.com/ade-fixture/review/pull/1' && f.controls.prCount === 1);
  const ghCreate = f.ghCalls.find((call) => call.args[1] === 'create')!;
  check('PR passes literal multiline body by stdin and disables implicit push/fork via explicit head', ghCreate.input === action.body && ghCreate.args.includes('--head') && ghCreate.args.includes('--base') && ghCreate.args.includes('--draft') && ghCreate.args[ghCreate.args.indexOf('--body-file') + 1] === '-');
  const priorGitPushes = f.gitCalls.filter((args) => args.includes('push')).length;
  await apply(action); check('existing matching PR is reused without another create or push', f.controls.prCount === 1 && f.gitCalls.filter((args) => args.includes('push')).length === priorGitPushes);
  f.controls.providerDown = true;
  check('unavailable GitHub is shown truthfully while remote Git remains inspectable', !!(await service.status(workspace.id, 'origin')).providerNotice);
  await rejects('provider outage blocks PR preparation', () => preview(action), /lesbaren GitHub/); f.controls.providerDown = false;
  f.controls.unsafeUrl = true; await rejects('foreign provider URL never becomes a publishable PR result', () => preview(action), /lesbaren GitHub/); f.controls.unsafeUrl = false;
  writeFileSync(join(cwd, 'new.txt'), 'unpublished version\n'); run('add', '.'); run('commit', '-m', 'unpublished');
  await rejects('PR cannot implicitly push an unpublished HEAD', () => preview(action), /zuerst ausdrücklich pushen/);
  await apply({ kind: 'push', remote: 'origin' }); f.prs.length = 0; f.controls.loseCreatedReply = true;
  await rejects('lost successful PR response remains unconfirmed', () => apply(action), /lost successful/);
  check('inspection recovers PR after an uncertain successful create', (await service.status(workspace.id, 'origin')).pullRequests[0]?.head === run('rev-parse', 'HEAD'));
  await apply(action); check('explicit fresh review finds existing PR after lost response', f.controls.prCount === 2);
  run('config', 'remote.origin.pushurl', 'https://github.com/different/target.git');
  // Refuse transport before a network call by making it unsupported.
  run('config', 'remote.origin.pushurl', 'ext::unexpected');
  await rejects('unsupported push transport fails before publication', () => preview({ kind: 'push', remote: 'origin' }), /unterstütztes Push-Ziel/); run('config', '--unset', 'remote.origin.pushurl');
  f.devices.enroll('tablet', 'Tablet', 't'.repeat(40)); f.devices.setAdminScopes('tablet', ['workspace:read', 'projects:write', 'projectGit:write']);
  const context = (): RemoteCommandContext => ({ principal: { id: 'tablet', kind: 'device', proof: 'device-signature', scopes: new Set(f.devices.activeDevices()[0]!.scopes) }, requestId: 'publish-test', idempotencyKey: randomUUID() });
  async function denied(label: string, call: () => unknown, code: string) { try { await call(); check(label, false); } catch (error) { check(label, error instanceof RemoteApiError && error.code === code); } }
  await denied('local Git grant does not authorize publication preview', () => f.application.queryProjects(context(), { operation: 'publish-preview', workspaceId: workspace.id, action }), 'scope_not_granted');
  f.devices.setAdminScopes('tablet', ['workspace:read', 'projects:write', 'projectGit:publish']);
  const api = (await f.application.queryProjects(context(), { operation: 'publish-preview', workspaceId: workspace.id, action })).publishPreview!;
  const ctx = context(); const command = { operation: 'publish-apply', previewId: api.id };
  await denied('publication requires durable idempotency key', () => f.application.commandProject({ ...ctx, idempotencyKey: undefined }, command), 'idempotency_key_required');
  const receipt = await f.application.commandProject(ctx, command); const replay = await f.application.commandProject(ctx, command);
  check('signed receipt replay confirms original publication without another write', !receipt.replayed && replay.replayed && f.controls.prCount === 2 && receipt.publication?.head === replay.publication?.head);
  f.devices.setAdminScopes('tablet', ['workspace:read', 'projects:write']); await denied('revocation prevents publication receipt replay', () => f.application.commandProject(ctx, command), 'scope_not_granted');
  check('final positive control preserves clean local branch and exact remote publication', !run('status', '--porcelain') && run('rev-parse', 'HEAD') === runAtRemote('rev-parse', 'feature/review') && readFileSync(join(cwd, 'new.txt'), 'utf8') === 'unpublished version\n');
  run('config', 'remote.origin.pushurl', f.remote);
  const redirected = await service.status(workspace.id, 'origin');
  check('different push destination is displayed truthfully and disables GitHub PR identity', redirected.provider === null && redirected.target.startsWith('Lokales Repository'));
  await rejects('PR refuses a separate nonmatching push destination', () => preview(action), /lesbaren GitHub/);
  run('config', '--unset', 'remote.origin.pushurl');
  check('restored provider is a final positive control after destination rejection', (await service.status(workspace.id, 'origin')).provider === 'ade-fixture/review');
  const bin = join(root, 'gh-bin'); mkdirSync(bin);
  writeFileSync(join(bin, 'list.json'), '[]');
  writeFileSync(join(bin, 'created.json'), JSON.stringify([{ number: 3, url: 'https://github.com/ade-fixture/review/pull/3', headRefName: 'feature/review',
    headRefOid: run('rev-parse', 'HEAD'), baseRefName: 'main', isDraft: true, isCrossRepository: false }]));
  const compile = join(root, 'compile-gh.ps1');
  writeFileSync(compile, `param([string]$Target)
Add-Type -OutputAssembly $Target -OutputType ConsoleApplication -TypeDefinition @'
using System; using System.IO; using System.Text;
public class FixtureGh { public static int Main(string[] args) {
  string root = Path.GetDirectoryName(System.Diagnostics.Process.GetCurrentProcess().MainModule.FileName);
  if (args.Length < 2 || args[0] != "pr") return 12;
  if (args[1] == "list") { Console.WriteLine(File.ReadAllText(Path.Combine(root, "list.json"))); return 0; }
  if (args[1] != "create") return 13;
  File.WriteAllText(Path.Combine(root, "body.txt"), Console.In.ReadToEnd(), new UTF8Encoding(false));
  File.WriteAllText(Path.Combine(root, "args.txt"), String.Join("\\n", args));
  File.Copy(Path.Combine(root, "created.json"), Path.Combine(root, "list.json"), true);
  Console.WriteLine("https://github.com/ade-fixture/review/pull/3"); return 0;
} }
'@
`);
  execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', compile, join(bin, 'gh.exe')], { windowsHide: true, timeout: 30_000 });
  const pathKey = Object.keys(process.env).find((key) => key.toUpperCase() === 'PATH') ?? 'PATH'; const oldPath = process.env[pathKey];
  try {
    process.env[pathKey] = `${bin};${oldPath ?? ''}`;
    const nativePublisher = new ProjectPublishService(f.projectGit, undefined, Date.now, f.publicationGit);
    const nativePreview = await nativePublisher.preview(workspace.id, action, 'desktop'); const nativeResult = await nativePublisher.apply(nativePreview.id, 'desktop');
    check('native gh executable receives exact multiline body through real stdin', readFileSync(join(bin, 'body.txt'), 'utf8') === action.body);
    const args = readFileSync(join(bin, 'args.txt'), 'utf8');
    check('native gh invocation pins repository branch base and draft without shell interpolation', args.includes('github.com/ade-fixture/review') && args.includes('feature/review') && args.includes('--body-file\n-') && args.includes('--draft'));
    check('native gh result is verified by subsequent provider read', nativeResult.publication.url === 'https://github.com/ade-fixture/review/pull/3');
  } finally { if (oldPath === undefined) delete process.env[pathKey]; else process.env[pathKey] = oldPath; }
  function runAtRemote(...args: string[]) { return f.runAt(f.remote, ...args); }
})().catch((error) => { failed++; console.error(error); }).finally(() => {
  if (dirname(resolve(root)) !== resolve(tmpdir())) throw new Error('unexpected fixture root'); rmSync(root, { recursive: true, force: true });
  console.log(`Project publication: ${passed} passed, ${failed} failed`); process.exitCode = failed ? 1 : 0;
});
