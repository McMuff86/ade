/** Isolated real Electron/Main/preload/PTY integration; local native fixtures only. */
import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron, type ElectronApplication } from 'playwright';
import { DEFAULT_CONFIG, type SessionMeta } from '../src/shared/types';

let passed = 0;
const check = (label: string, condition: unknown): void => { assert.ok(condition, label); passed++; console.log(`ok ${label}`); };
const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'ade-profile-session-electron-')));
const bin = join(root, 'bin'); mkdirSync(bin);
const proofs = join(root, 'proofs'); mkdirSync(proofs);
const userData = join(root, 'profile'); mkdirSync(join(userData, 'ade'), { recursive: true });
writeFileSync(join(userData, 'ade', 'config.json'), JSON.stringify({ ...DEFAULT_CONFIG,
  settings: { ...DEFAULT_CONFIG.settings, memory: { enabled: false, userProfileEnabled: false, memoryCharLimit: 2200, userCharLimit: 1375 } } }));
const source = `using System; using System.IO; using System.Collections.Generic; using System.Web.Script.Serialization;
public class Fixture { public static void Main(string[] args) {
 var json=new JavaScriptSerializer(); var cli=Path.GetFileNameWithoutExtension(System.Diagnostics.Process.GetCurrentProcess().MainModule.FileName).ToLowerInvariant();
 var proofRoot=Environment.GetEnvironmentVariable("ADE_PROFILE_FIXTURE_PROOFS");
 if(cli=="codex" && args.Length>0 && args[0]=="app-server") { string line; while((line=Console.ReadLine())!=null) {
  if(line.Contains("config/read")) { if(File.Exists(Path.Combine(proofRoot,"fail-config"))) Console.WriteLine("{\\"id\\":2,\\"error\\":{\\"message\\":\\"fixture unavailable\\"}}");
   else Console.WriteLine("{\\"id\\":2,\\"result\\":{\\"config\\":{\\"developer_instructions\\":\\"FIXTURE_BASELINE_KEEP\\"},\\"origins\\":{}}}"); }
  else if(line.Contains("clientInfo")) Console.WriteLine("{\\"id\\":1,\\"result\\":{}}");
 } return; }
 string text=""; string file="";
 for(int i=0;i<args.Length;i++) {
  if(args[i]=="--append-system-prompt-file" && i+1<args.Length) { file=args[++i]; text=File.ReadAllText(file); }
  else if(args[i]=="-c" && i+1<args.Length) { string value=args[++i]; if(value.StartsWith("developer_instructions=")) text=json.Deserialize<string>(value.Substring(value.IndexOf('=')+1)); }
 }
 var proof=new Dictionary<string,object>(); proof["cli"]=cli; proof["args"]=args; proof["cwd"]=Environment.CurrentDirectory; proof["profileText"]=text; proof["sourcePath"]=file;
 File.WriteAllText(Path.Combine(proofRoot,Guid.NewGuid().ToString("N")+".json"),json.Serialize(proof));
 Console.WriteLine("ADE_PROFILE_CLI_READY"); while(Console.ReadLine()!=null) { }
} }`;
const compile = join(root, 'compile.ps1');
writeFileSync(compile, `param([string]$Target)\nAdd-Type -ReferencedAssemblies System.Web.Extensions -OutputAssembly $Target -OutputType ConsoleApplication -TypeDefinition @'\n${source}\n'@\n`);
interface Proof { cli: string; args: string[]; cwd: string; profileText: string; sourcePath: string }
let app: ElectronApplication | undefined;

void (async () => {
  if (process.platform !== 'win32') throw new Error('Native profile session integration requires Windows.');
  execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', compile, join(bin, 'fixture.exe')], { windowsHide: true, timeout: 30_000 });
  for (const cli of ['codex', 'claude']) copyFileSync(join(bin, 'fixture.exe'), join(bin, `${cli}.exe`));
  app = await electron.launch({ args: [resolve('out/main/index.js')], cwd: resolve('.'), timeout: 30_000,
    env: { ...process.env, Path: `${bin};${process.env.Path ?? process.env.PATH}`, ADE_PROFILE_FIXTURE_PROOFS: proofs,
      ADE_USER_DATA_DIR: userData, ADE_HOST_API_ENABLED: '0', NODE_ENV: 'test' } });
  const page = await app.firstWindow(); page.setDefaultTimeout(20_000);
  await page.waitForFunction(() => !!window.ade);
  check('isolated ADE configuration starts with optional memory disabled', (await page.evaluate(() => window.ade.invoke('config:get'))).settings.memory?.enabled === false);
  const agents = await page.evaluate(async () => {
    const category = await window.ade.invoke('category:create', { name: 'Profile integration' });
    const result = [];
    for (const runtime of ['claude', 'codex'] as const) {
      const agent = await window.ade.invoke('agent:create', { categoryId: category.id, name: `Profile ${runtime}`, runtime, permissionMode: 'default' });
      const view = await window.ade.invoke('agent:behaviorGet', { agentId: agent.id });
      await window.ade.invoke('agent:behaviorSet', { agentId: agent.id, revision: view.revision, profile: {
        instructions: 'Geometry specialization.\nKeep "quotes", $dollar, `tick and Unicode ä 漢字 intact.',
        documents: [{ id: 'quality', name: 'QUALITY.md', text: 'Validate geometry tolerance and report evidence.' }] } });
      result.push(agent);
    }
    return result;
  });
  const preserved = new Map<string, { agents: string; claude: string }>();
  for (const agent of agents) {
    const instructions = { agents: '# Repository-owned AGENTS\nDO_NOT_CHANGE\n', claude: '# Repository-owned CLAUDE\nDO_NOT_CHANGE\n' };
    writeFileSync(join(agent.workspaceDir, 'AGENTS.md'), instructions.agents);
    writeFileSync(join(agent.workspaceDir, 'CLAUDE.md'), instructions.claude);
    preserved.set(agent.id, instructions);
    check(`${agent.runtime}: disabled memory creates no MEMORY scaffold`, !existsSync(join(agent.memoryDir, 'MEMORY.md')));
  }
  const known = new Set<string>();
  async function proofFor(cli: string): Promise<Proof> {
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      for (const name of readdirSync(proofs).filter((name) => name.endsWith('.json') && !known.has(name))) {
        const proof = JSON.parse(readFileSync(join(proofs, name), 'utf8')) as Proof;
        known.add(name); if (proof.cli === cli) return proof;
      }
      await new Promise((resolveWait) => setTimeout(resolveWait, 50));
    }
    throw new Error(`Missing local ${cli} PTY proof.`);
  }
  async function kill(session: SessionMeta): Promise<void> {
    await page.evaluate((sessionId) => window.ade.invoke('pty:kill', { sessionId }), session.id);
  }
  for (const agent of agents) {
    const view = await page.evaluate((agentId) => window.ade.invoke('agent:behaviorGet', { agentId }), agent.id);
    const session = await page.evaluate((agentId) => window.ade.invoke('session:launch', { agentId, repositoryId: null, mode: 'agent' }), agent.id);
    const proof = await proofFor(agent.runtime);
    check(`${agent.runtime}: real PTY receives exact effective profile with memory off`, proof.profileText === (agent.runtime === 'codex' ? 'FIXTURE_BASELINE_KEEP\n\n' : '') + view.context.text);
    check(`${agent.runtime}: SessionMeta reports profile digest and document provenance`, session.profileContext?.digest === createHash('sha256').update(view.context.text).digest('hex')
      && session.profileContext.delivery === 'supplied' && session.profileContext.sources.some((item) => item.id === 'quality')
      && session.profileContext.profileId === agent.id && session.profileContext.capturedAt > 0);
    check(`${agent.runtime}: profile files are outside execution workspace`, !proof.sourcePath || !proof.sourcePath.startsWith(agent.workspaceDir));
    if (agent.runtime === 'claude') {
      await page.reload();
      await page.getByRole('tab', { name: 'Übersicht', exact: true }).click();
      await page.getByRole('button', { name: `Terminal öffnen: ${agent.name}`, exact: true }).click();
      const context = page.locator('.session-profile-context').filter({ hasText: `Profil beim Start · ${agent.name}` });
      const summary = context.locator('summary'); await summary.focus(); await summary.press('Enter');
      check('desktop profile context expands by keyboard and shows the session digest and document', await context.getByText(session.profileContext!.digest.slice(0, 12), { exact: true }).isVisible()
        && await context.getByText(/QUALITY\.md/).isVisible());
      await context.getByRole('button', { name: 'Mit gespeichertem Profil vergleichen', exact: true }).click();
      await context.getByRole('status').filter({ hasText: 'Gespeichertes Profil entspricht dem Startstand.' }).waitFor();
      check('desktop compares saved profile against captured session context', true);
    }
    const updated = await page.evaluate(async ({ agentId, revision }) => {
      await window.ade.invoke('agent:behaviorSet', { agentId, revision, profile: { instructions: 'New revision for future sessions.', documents: [] } });
      return { view: await window.ade.invoke('agent:behaviorGet', { agentId }), sessions: (await window.ade.invoke('pty:list')).sessions };
    }, { agentId: agent.id, revision: view.revision });
    check(`${agent.runtime}: saved revision does not relabel an existing session`, updated.sessions.find((item) => item.id === session.id)?.profileContext?.digest === session.profileContext?.digest
      && updated.view.revision !== view.revision);
    const captured = await page.evaluate((sessionId) => window.ade.invoke('terminal:profileContext', { sessionId }), session.id);
    check(`${agent.runtime}: explicit context read returns immutable launch text after profile edit`, captured === view.context.text
      && captured !== updated.view.context.text && !JSON.stringify(updated.sessions).includes('Geometry specialization.'));
    if (agent.runtime === 'claude') {
      const context = page.locator('.session-profile-context').filter({ hasText: `Profil beim Start · ${agent.name}` });
      await context.getByRole('button', { name: 'Mit gespeichertem Profil vergleichen', exact: true }).click();
      await context.getByRole('status').filter({ hasText: 'Das gespeicherte Profil wurde geändert.' }).waitFor();
      check('desktop explains new profile applies to a new session while old digest stays visible', await context.getByText(session.profileContext!.digest.slice(0, 12), { exact: true }).isVisible());
      check('desktop does not show full captured instructions before explicit request', await context.getByLabel('Übergebene Profilanweisungen', { exact: true }).count() === 0);
      await context.getByRole('button', { name: 'Übergebene Anweisungen ansehen', exact: true }).click();
      const text = context.getByLabel('Übergebene Profilanweisungen', { exact: true }); await text.waitFor();
      check('desktop explicit instruction viewer shows exact old text, not newly saved profile', await text.textContent() === view.context.text
        && !(await text.textContent())?.includes('New revision for future sessions.'));
      mkdirSync(resolve('test-results/profile-sessions'), { recursive: true });
      await page.screenshot({ path: resolve('test-results/profile-sessions/start-context.png') });
    }
    await kill(session);
    const raw = await page.evaluate(({ agentId, runtime }) => window.ade.invoke('session:launch', { agentId, repositoryId: null, mode: runtime }),
      { agentId: agent.id, runtime: agent.runtime as 'codex' | 'claude' });
    const rawProof = await proofFor(agent.runtime);
    check(`${agent.runtime}: explicit raw CLI receives no profile despite owning agent tab`, !raw.profileContext && rawProof.profileText === ''
      && !rawProof.args.some((arg) => /developer_instructions|append-system-prompt/.test(arg)));
    check(`${agent.runtime}: raw CLI context read returns null`, await page.evaluate((sessionId) => window.ade.invoke('terminal:profileContext', { sessionId }), raw.id) === null);
    await kill(raw);
    const rules = preserved.get(agent.id)!;
    check(`${agent.runtime}: repository instruction files remain byte-identical`, readFileSync(join(agent.workspaceDir, 'AGENTS.md'), 'utf8') === rules.agents
      && readFileSync(join(agent.workspaceDir, 'CLAUDE.md'), 'utf8') === rules.claude);
  }
  const shell = await page.evaluate((agentId) => window.ade.invoke('session:launch', { agentId, repositoryId: null, mode: 'shell' }), agents[0]!.id);
  check('plain shell receives no profile metadata', !shell.profileContext); await kill(shell);

  const project = join(root, 'project'); mkdirSync(project);
  execFileSync('git', ['init', '--initial-branch=main', project], { windowsHide: true });
  writeFileSync(join(project, 'AGENTS.md'), '# Project AGENTS untouched\n'); writeFileSync(join(project, 'CLAUDE.md'), '# Project CLAUDE untouched\n');
  execFileSync('git', ['-C', project, 'add', 'AGENTS.md', 'CLAUDE.md'], { windowsHide: true });
  execFileSync('git', ['-C', project, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost', '-c', 'commit.gpgSign=false', 'commit', '-m', 'Fixture'], { windowsHide: true });
  const projectSetup = await page.evaluate(async ({ path, agentId }) => {
    const repo = await window.ade.invoke('repository:import', { path, name: 'Profile project', executionBackend: 'native' });
    const directory = await window.ade.invoke('project:query', { operation: 'directory' });
    const entry = directory.directory!.entries.find((item) => item.repositoryId === repo.id)!;
    const opened = await window.ade.invoke('project:command', { operation: 'open', entryId: entry.id });
    const session = await window.ade.invoke('session:launch', { projectWorkspaceId: opened.workspace.id, expectedBranch: opened.workspace.branch, mode: 'agent', profileId: agentId });
    return { session, view: await window.ade.invoke('agent:behaviorGet', { agentId }) };
  }, { path: project, agentId: agents[0]!.id });
  const projectProof = await proofFor('claude');
  check('explicit project profile uses project cwd and current profile revision', projectProof.cwd === project && projectProof.profileText === projectSetup.view.context.text
    && projectSetup.session.launchProfileId === agents[0]!.id && !!projectSetup.session.profileContext && !projectSetup.session.agentId);
  check('project launch leaves tracked instructions and Git clean', readFileSync(join(project, 'AGENTS.md'), 'utf8') === '# Project AGENTS untouched\n'
    && readFileSync(join(project, 'CLAUDE.md'), 'utf8') === '# Project CLAUDE untouched\n'
    && !execFileSync('git', ['-C', project, 'status', '--porcelain'], { encoding: 'utf8', windowsHide: true }).trim());
  await kill(projectSetup.session);
  const rejected = await page.evaluate(async (agentId) => {
    const agent = (await window.ade.invoke('config:get')).agents.find((item) => item.id === agentId)!;
    await window.ade.invoke('agent:update', { id: agent.id, name: agent.name, runtime: 'custom', permissionMode: 'default', customCommand: "Write-Output 'MUST_NOT_START'" });
    try { await window.ade.invoke('session:launch', { agentId, repositoryId: null, mode: 'agent' }); return false; }
    catch (error) { return /Startbefehl|unterstützten|Profilanweisungen/i.test(String(error)); }
  }, agents[0]!.id);
  check('unsupported custom profile start fails clearly before launching', rejected);
  writeFileSync(join(proofs, 'fail-config'), 'fail');
  const configRejected = await page.evaluate(async (agentId) => {
    try { await window.ade.invoke('session:launch', { agentId, repositoryId: null, mode: 'agent' }); return false; }
    catch (error) { return /Codex-Anweisungen|Arbeitsbereich|Profilstart/i.test(String(error)); }
  }, agents[1]!.id);
  check('unknown Codex baseline blocks profile startup', configRejected);
  await page.evaluate(async (agentId) => {
    const agent = (await window.ade.invoke('config:get')).agents.find((item) => item.id === agentId)!;
    await window.ade.invoke('agent:update', { id: agent.id, name: agent.name, runtime: 'claude', permissionMode: 'default', customCommand: '' });
  }, agents[0]!.id);
  await app.close(); app = undefined;
  const memoryText = 'MEMORY_PROFILE_PROOF: Geometry uses millimetres.\n§\nKeep tolerance 0.01.';
  const userText = 'USER_PROFILE_PROOF: User prefers concise German explanations.';
  writeFileSync(join(agents[0]!.memoryDir, 'MEMORY.md'), memoryText);
  writeFileSync(join(agents[0]!.memoryDir, 'USER.md'), userText);
  for (const userProfileEnabled of [true, false]) {
    // Change only this stopped test instance's isolated config between boots.
    const configPath = join(userData, 'ade', 'config.json');
    const persisted = JSON.parse(readFileSync(configPath, 'utf8'));
    persisted.settings.memory = { enabled: true, userProfileEnabled, memoryCharLimit: 2200, userCharLimit: 1375 };
    writeFileSync(configPath, JSON.stringify(persisted));
    app = await electron.launch({ args: [resolve('out/main/index.js')], cwd: resolve('.'), timeout: 30_000,
      env: { ...process.env, Path: `${bin};${process.env.Path ?? process.env.PATH}`, ADE_PROFILE_FIXTURE_PROOFS: proofs,
        ADE_USER_DATA_DIR: userData, ADE_HOST_API_ENABLED: '0', NODE_ENV: 'test' } });
    const memoryPage = await app.firstWindow(); memoryPage.setDefaultTimeout(20_000);
    await memoryPage.waitForFunction(() => !!window.ade);
    const started = await memoryPage.evaluate(async (agentId) => ({
      view: await window.ade.invoke('agent:behaviorGet', { agentId }),
      session: await window.ade.invoke('session:launch', { agentId, repositoryId: null, mode: 'agent' }),
    }), agents[0]!.id);
    const proof = await proofFor('claude');
    check(`memory enabled, USER ${userProfileEnabled ? 'enabled' : 'disabled'}: real PTY receives memory with maintenance instructions`,
      proof.profileText.startsWith(started.view.context.text) && proof.profileText.includes('MEMORY_PROFILE_PROOF')
      && proof.profileText.includes('How to maintain your memory') && proof.profileText.includes('MEMORY.md ->')
      && proof.profileText.includes('USER_PROFILE_PROOF') === userProfileEnabled
      && proof.profileText.includes('USER.md   ->') === userProfileEnabled);
    const context = started.session.profileContext!;
    check(`memory enabled, USER ${userProfileEnabled ? 'enabled' : 'disabled'}: full digest differs from unchanged profile comparison revision`,
      context.digest === createHash('sha256').update(proof.profileText).digest('hex') && context.profileDigest === started.view.revision
      && context.digest !== context.profileDigest && context.sources.some((source) => source.kind === 'memory' && source.name === 'MEMORY.md')
      && context.sources.some((source) => source.kind === 'memory' && source.name === 'USER.md') === userProfileEnabled);
    const captured = await memoryPage.evaluate((sessionId) => window.ade.invoke('terminal:profileContext', { sessionId }), started.session.id);
    check(`memory enabled, USER ${userProfileEnabled ? 'enabled' : 'disabled'}: explicit captured text includes precisely delivered sources`, captured === proof.profileText);
    await memoryPage.reload();
    await memoryPage.getByRole('tab', { name: 'Übersicht', exact: true }).click();
    await memoryPage.getByRole('button', { name: `Terminal öffnen: ${agents[0]!.name}`, exact: true }).click();
    const section = memoryPage.locator('.session-profile-context').filter({ hasText: `Profil beim Start · ${agents[0]!.name}` });
    await section.locator('summary').click();
    await section.getByRole('button', { name: 'Mit gespeichertem Profil vergleichen', exact: true }).click();
    await section.getByRole('status').filter({ hasText: 'Gespeichertes Profil entspricht dem Startstand.' }).waitFor();
    check(`memory enabled, USER ${userProfileEnabled ? 'enabled' : 'disabled'}: desktop comparison does not mistake captured memory for a profile edit`, true);
    const original = preserved.get(agents[0]!.id)!;
    check(`memory enabled, USER ${userProfileEnabled ? 'enabled' : 'disabled'}: repository and memory files remain unchanged`,
      readFileSync(join(agents[0]!.workspaceDir, 'AGENTS.md'), 'utf8') === original.agents
      && readFileSync(join(agents[0]!.workspaceDir, 'CLAUDE.md'), 'utf8') === original.claude
      && readFileSync(join(agents[0]!.memoryDir, 'MEMORY.md'), 'utf8') === memoryText
      && readFileSync(join(agents[0]!.memoryDir, 'USER.md'), 'utf8') === userText);
    await memoryPage.evaluate((sessionId) => window.ade.invoke('pty:kill', { sessionId }), started.session.id);
    await app.close(); app = undefined;
  }
  console.log(`Profile Electron sessions: ${passed} passed, 0 failed; real PTYs, no model calls.`);
})().catch((error) => { console.error(error instanceof Error ? error.message : 'Profile Electron test failed.'); process.exitCode = 1; })
  .finally(async () => { await app?.close(); });
