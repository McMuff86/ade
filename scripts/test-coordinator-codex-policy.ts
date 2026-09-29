import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { assertCoordinatorCodexConfig, assertCoordinatorCodexThread, assertCoordinatorCodexVersion, COORDINATOR_CODEX_OVERRIDES, COORDINATOR_DISABLED_FEATURES, launchCoordinatorCodex } from '../src/main/pty/CoordinatorCodexPolicy';

let passed = 0; let failed = 0;
const check = (label: string, ok: boolean) => { if (!ok) throw new Error(label); passed++; console.log(`  ok  ${label}`); };
const rejects = (fn: () => void) => { try { fn(); return false; } catch { return true; } };
const config = () => ({ config: { features: { ...Object.fromEntries(COORDINATOR_DISABLED_FEATURES.map(name => [name, false])), code_mode_host: true } as Record<string, boolean>, mcp_servers: {}, agents: { enabled: false },
  web_search: 'disabled', sandbox_mode: 'read-only', approval_policy: 'never' } });
try {
  assertCoordinatorCodexVersion({ userAgent: 'codex_cli_rs/0.154.0' }); assertCoordinatorCodexConfig(config());
  check('verified native version and effective feature configuration pass', true);
  for (const version of ['0.154.1', '0.155.1', '0.200.0', '1.0.0']) {
    check(`installed CLI ${version} may proceed to effective policy checks`, assertCoordinatorCodexVersion({ userAgent: `ade/${version} (Windows 10.0.26100; x86_64)` }) === version);
  }
  for (const userAgent of ['ade/0.153.9', 'ade/0.99.99', 'ade/0.155.1-alpha.1', 'ade/0.155.1garbage', 'ade/unknown Windows/0.155.1', 'prefix ade/0.155.1', 'ade/0.155', 'ade/9999999.0.0', 'ade/0.155.1 ' + 'x'.repeat(1024), '']) {
    check(`unsupported or malformed identity is refused: ${userAgent.slice(0, 45)}`, rejects(() => assertCoordinatorCodexVersion({ userAgent })));
  }
  for (const value of [null, {}, { userAgent: 155 }]) check('missing CLI identity is refused', rejects(() => assertCoordinatorCodexVersion(value)));
  for (const name of COORDINATOR_DISABLED_FEATURES) {
    const changed = config(); changed.config.features[name] = true;
    check(`enabled ${name} fails before a conversation turn`, rejects(() => assertCoordinatorCodexConfig(changed)));
  }
  check('missing effective config is not interpreted as disabled defaults', rejects(() => assertCoordinatorCodexConfig({ config: {} })));
  const withoutHost = config(); withoutHost.config.features.code_mode_host = false;
  check('native host for dynamic ADE tools must remain explicitly enabled', rejects(() => assertCoordinatorCodexConfig(withoutHost)));
  check('inherited MCP server is refused', rejects(() => assertCoordinatorCodexConfig({ config: { ...config().config, mcp_servers: { unexpected: {} } } })));
  check('explicitly enabled inherited MCP server is refused', rejects(() => assertCoordinatorCodexConfig({ config: { ...config().config, mcp_servers: { unexpected: { enabled: true } } } })));
  check('only explicitly disabled inherited MCP entries are accepted', !rejects(() => assertCoordinatorCodexConfig({ config: { ...config().config, mcp_servers: { inherited: { enabled: false } } } })));
  check('inherited writable sandbox is refused', rejects(() => assertCoordinatorCodexConfig({ config: { ...config().config, sandbox_mode: 'danger-full-access' } })));
  check('native thread must confirm no network in its read-only sandbox', rejects(() => assertCoordinatorCodexThread({ sandbox: { type: 'readOnly', networkAccess: true }, approvalPolicy: 'never' })));
  check('native thread cannot override the configured read-only policy', rejects(() => assertCoordinatorCodexThread({ sandbox: { type: 'dangerFullAccess' }, approvalPolicy: 'never' })));
  check('fixed launch overrides retain read-only configuration', COORDINATOR_CODEX_OVERRIDES.includes('sandbox_mode=read-only'));
  assertCoordinatorCodexThread({ sandbox: { type: 'readOnly', networkAccess: false }, approvalPolicy: 'never' });
  check('final positive native thread contract follows negative controls', true);
} catch (error) { failed++; console.error(error); }
/**
 * The POSIX launcher against a codex double on PATH: it logs every argv and
 * environment flag, answers `mcp list --json` from FAKE_MCP, and as app server
 * echoes stdin back so the stdio hand-off is proven end to end.
 */
async function posixLauncher(): Promise<void> {
  if (process.platform === 'win32') { console.log('  skip  POSIX coordinator launcher (Windows uses the PowerShell launch)'); return; }
  const root = mkdtempSync(join(tmpdir(), 'ade-coordinator-launch-'));
  try {
    const bin = join(root, 'bin'); const cwd = join(root, 'workspace'); mkdirSync(bin); mkdirSync(cwd);
    const log = join(root, 'calls.jsonl');
    writeFileSync(join(bin, 'codex'), `#!${process.execPath}
const fs = require('node:fs'); const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({ args, cwd: process.cwd(), electronAsNode: 'ELECTRON_RUN_AS_NODE' in process.env, pid: process.pid }) + '\\n');
if (args.includes('mcp')) { if (process.env.FAKE_MCP_FAIL) process.exit(2); process.stdout.write(process.env.FAKE_MCP || '[]'); process.exit(0); }
process.stdin.setEncoding('utf8'); process.stdin.on('data', (d) => process.stdout.write('echo:' + d));
if (process.env.FAKE_HANG) setInterval(() => {}, 1000); else process.stdin.on('end', () => process.exit(0));
`);
    chmodSync(join(bin, 'codex'), 0o755);
    const env = (extra: Record<string, string> = {}) => ({ ...process.env as Record<string, string>, PATH: `${bin}${delimiter}${process.env.PATH ?? ''}`, ...extra });
    const calls = () => existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line) as { args: string[]; cwd: string; electronAsNode: boolean; pid: number }) : [];
    const run = (extra: Record<string, string>, input?: string) => new Promise<{ code: number | null; out: string; err: string }>((done) => {
      rmSync(log, { force: true });
      const child = launchCoordinatorCodex(cwd, env(extra)); let out = ''; let err = '';
      child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
      child.stdout.on('data', (d: string) => { out += d; }); child.stderr.on('data', (d: string) => { err += d; });
      child.on('exit', (code) => done({ code, out, err }));
      if (input !== undefined) child.stdin.end(input); else child.stdin.end();
    });

    const ok = await run({ FAKE_MCP: JSON.stringify([{ name: 'demo_server' }, { name: 'other-one' }]) }, '{"id":1}\n');
    const [inventory, server] = calls();
    const overrides = COORDINATOR_CODEX_OVERRIDES.flatMap((value) => ['-c', value]);
    check('POSIX launch inventories MCP servers with the fixed overrides, without a shell',
      JSON.stringify(inventory?.args) === JSON.stringify([...overrides, 'mcp', 'list', '--json']));
    check('POSIX launch disables each inherited MCP server by name for this process only',
      JSON.stringify(server?.args) === JSON.stringify([...overrides, '-c', 'mcp_servers.demo_server.enabled=false', '-c', 'mcp_servers.other-one.enabled=false', 'app-server', '--listen', 'stdio://']));
    check('the app server gets the workspace cwd and not ELECTRON_RUN_AS_NODE', server?.cwd === cwd && server.electronAsNode === false);
    check('protocol stdio is handed to Codex unchanged and the exit code passes through', ok.out === 'echo:{"id":1}\n' && ok.code === 0);

    const bad = await run({ FAKE_MCP: JSON.stringify([{ name: 'bad name;rm' }]) });
    check('a malformed MCP server name stops before the app server starts', bad.code === 1 && bad.err.includes('(MCP-Identities)') && calls().length === 1);
    const failing = await run({ FAKE_MCP_FAIL: '1' });
    check('a failing MCP inventory stops before the app server starts', failing.code === 1 && failing.err.includes('(MCP-Inventar)') && calls().length === 1);

    rmSync(log, { force: true });
    // A hung server ignores stdin EOF, so only the forwarded signal can end it.
    const live = launchCoordinatorCodex(cwd, env({ FAKE_HANG: '1' }));
    for (let i = 0; i < 100 && calls().length < 2; i++) await new Promise((r) => setTimeout(r, 50));
    const codexPid = calls()[1]?.pid;
    live.kill('SIGTERM'); await new Promise((r) => live.on('exit', r));
    await new Promise((r) => setTimeout(r, 300));
    const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
    const ended = typeof codexPid === 'number' && !alive(codexPid);
    if (!ended && typeof codexPid === 'number') process.kill(codexPid, 'SIGKILL');
    check('SIGTERM to the launcher also ends a hung Codex app server', ended);
  } finally { rmSync(root, { recursive: true, force: true }); }
}
void posixLauncher().catch((error) => { failed++; console.error(error); }).finally(() => {
  console.log(`Coordinator Codex policy: ${passed} passed, ${failed} failed`); if (failed) process.exitCode = 1;
});
