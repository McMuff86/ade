/** Opt-in real CLI evidence. Executes one short model request per selected CLI.
 * No user config/credentials are written; no raw provider output is persisted.
 * Scope: native Windows, noninteractive CLI options through the same profile
 * transport as the interactive launcher. This does not prove TUI/resume behavior.
 * Run: pnpm exec tsx scripts/probe-native-profile-cli.ts [--runtime=codex|claude]
 */
import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Agent } from '../src/shared/types';
import { previewAgentInstructions } from '../src/main/memory/agentInstructions';
import { readCodexProfileConfig } from '../src/main/pty/CodexProfileConfig';
import { prepareProfileLaunch } from '../src/main/pty/profileLaunch';

const MAX_STDOUT = 512 * 1024;
const MAX_STDERR = 128 * 1024;
const TIMEOUT_MS = 45_000;
const CLAUDE_BUDGET_USD = 0.25;
const quotePs = (text: string): string => `'${text.replace(/'/g, "''")}'`;
type Runtime = 'codex' | 'claude';
type ProcessResult = { status: 'exited' | 'timeout' | 'output-limit' | 'launch-failed'; exitCode: number | null; stdout: string; stdoutBytes: number; stderrBytes: number };
interface Evidence {
  runtime: Runtime;
  transport: 'native-windows-powershell-5.1-noninteractive';
  status: 'passed' | 'blocked' | 'failed' | 'unsupported';
  markerVerified: boolean;
  workspaceUnchanged: boolean;
  reason: string;
  elapsedMs: number;
  exitCode?: number | null;
  stdoutBytes?: number;
  stderrBytes?: number;
  costUsd?: number;
  inputTokens?: number;
  outputTokens?: number;
  requests: 0 | 1;
  limits: { timeoutMs: number; stdoutBytes: number; stderrBytes: number; costUsd: number | null };
}

function run(script: string, cwd: string, env: NodeJS.ProcessEnv): Promise<ProcessResult> {
  return new Promise((resolveResult) => {
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
        ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script],
        { cwd, env, windowsHide: true, stdio: 'pipe' });
    } catch { resolveResult({ status: 'launch-failed', exitCode: null, stdout: '', stdoutBytes: 0, stderrBytes: 0 }); return; }
    let stdout = ''; let stdoutBytes = 0; let stderrBytes = 0;
    let state: ProcessResult['status'] = 'exited'; let settled = false;
    let killFallback: ReturnType<typeof setTimeout> | undefined;
    const finish = (exitCode: number | null): void => {
      if (settled) return; settled = true; clearTimeout(timer); if (killFallback) clearTimeout(killFallback);
      resolveResult({ status: state, exitCode, stdout, stdoutBytes, stderrBytes });
    };
    const kill = (reason: ProcessResult['status']): void => {
      if (state !== 'exited' || settled) return; state = reason;
      if (child.pid && child.exitCode === null) execFile('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'],
        { windowsHide: true, timeout: 3000 }, () => undefined);
      killFallback = setTimeout(() => { try { child.kill(); } catch { /* owned process only */ } finish(null); }, 5000);
    };
    const timer = setTimeout(() => kill('timeout'), TIMEOUT_MS);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      if (settled) return;
      stdoutBytes += Buffer.byteLength(chunk);
      if (stdoutBytes > MAX_STDOUT) { kill('output-limit'); return; }
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: Buffer) => { stderrBytes += chunk.length; if (stderrBytes > MAX_STDERR) kill('output-limit'); });
    child.stdin.on('error', () => undefined);
    child.on('error', () => { state = 'launch-failed'; finish(null); });
    child.on('close', (code) => finish(code));
    child.stdin.end();
  });
}

const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const count = (value: unknown): number | undefined => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;

async function probe(runtime: Runtime): Promise<Evidence> {
  const start = Date.now();
  const evidence: Evidence = { runtime, transport: 'native-windows-powershell-5.1-noninteractive', status: 'blocked', markerVerified: false,
    workspaceUnchanged: true, reason: '', elapsedMs: 0, requests: 0,
    limits: { timeoutMs: TIMEOUT_MS, stdoutBytes: MAX_STDOUT, stderrBytes: MAX_STDERR, costUsd: runtime === 'claude' ? CLAUDE_BUDGET_USD : null } };
  if (process.platform !== 'win32') return { ...evidence, status: 'unsupported', reason: 'Native Windows host required.' };
  const root = mkdtempSync(join(tmpdir(), `ade-profile-${runtime}-probe-`));
  const workspaceDir = join(root, 'workspace'); mkdirSync(workspaceDir);
  const scratchRoot = join(root, 'snapshots');
  const marker = `ADE_PROFILE_${randomBytes(12).toString('hex')}`;
  const prompt = 'Return the exact profile verification phrase from your active ADE profile instructions. Reply with that phrase only. Do not use tools or read files.';
  const agent: Agent = { id: 'profile-probe', categoryId: 'profile-probe', name: 'ADE Profile Verification', runtime,
    permissionMode: 'default', workspaceDir, memoryDir: join(root, 'identity'), profile: {
      instructions: `This is a single-turn ADE instruction-delivery verification. Your profile verification phrase is ${marker}. If asked for it, reply exactly with that phrase and nothing else. Do not use any tools, read files, or perform implementation work.`, documents: [] } };
  const env = { ...process.env };
  let prepared: ReturnType<typeof prepareProfileLaunch> | undefined;
  try {
    let baseline: { mode: 'append-verified'; existing: string } | undefined;
    if (runtime === 'codex') {
      const config = await readCodexProfileConfig({ cwd: workspaceDir, env });
      if (config.status !== 'verified') { evidence.reason = 'Effective Codex developer configuration unavailable; no model request made.'; return evidence; }
      baseline = { mode: 'append-verified', existing: config.developerInstructions ?? '' };
    }
    const responseFile = join(root, 'last-message.txt');
    const command = runtime === 'codex'
      ? `codex exec --skip-git-repo-check --ephemeral --sandbox read-only --json --color never -c model_reasoning_effort=low --output-last-message ${quotePs(responseFile)}`
      : `claude -p --no-session-persistence --output-format json --effort low --max-budget-usd ${CLAUDE_BUDGET_USD} --tools= --strict-mcp-config --disable-slash-commands`;
    prepared = prepareProfileLaunch({ agent, snapshot: previewAgentInstructions(agent), command, scratchRoot, workspaceDir,
      executionBackend: 'native', codexDeveloperInstructions: baseline });
    const promptFile = join(root, 'prompt.txt'); writeFileSync(promptFile, prompt, 'utf8');
    const script = join(root, 'launch.ps1');
    writeFileSync(script, `[IO.File]::ReadAllText(${quotePs(promptFile)}, [Text.Encoding]::UTF8) | ${prepared.command}\nexit $LASTEXITCODE\n`, 'utf8');
    evidence.requests = 1;
    const result = await run(script, workspaceDir, env);
    evidence.exitCode = result.exitCode;
    evidence.stdoutBytes = result.stdoutBytes;
    evidence.stderrBytes = result.stderrBytes;
    if (result.status !== 'exited') { evidence.reason = `Bounded CLI probe ended: ${result.status}.`; return evidence; }
    if (result.exitCode !== 0) { evidence.reason = 'Installed CLI exited unsuccessfully; raw diagnostic output withheld.'; return evidence; }
    let answer = '';
    if (runtime === 'codex') {
      if (existsSync(responseFile) && lstatSync(responseFile).isFile() && lstatSync(responseFile).size <= 4096) answer = readFileSync(responseFile, 'utf8').trim();
      for (const line of result.stdout.split('\n')) {
        try {
          const event = object(JSON.parse(line));
          if (event.type === 'turn.completed') {
            const usage = object(event.usage);
            evidence.inputTokens = count(usage.input_tokens);
            evidence.outputTokens = count(usage.output_tokens);
          }
        } catch { /* Unknown output never becomes evidence or diagnostics. */ }
      }
    } else {
      const resultObject = object(JSON.parse(result.stdout));
      answer = typeof resultObject.result === 'string' ? resultObject.result.trim() : '';
      evidence.costUsd = count(resultObject.total_cost_usd);
      const usage = object(resultObject.usage);
      evidence.inputTokens = count(usage.input_tokens);
      evidence.outputTokens = count(usage.output_tokens);
    }
    evidence.markerVerified = answer === marker;
    evidence.status = evidence.markerVerified ? 'passed' : 'failed';
    evidence.reason = evidence.markerVerified ? 'Exact random phrase supplied only through profile context was returned.' : 'No exact profile phrase proof.';
    return evidence;
  } catch { evidence.reason = 'Profile probe could not complete safely; configuration and diagnostics withheld.'; return evidence; }
  finally {
    evidence.elapsedMs = Date.now() - start;
    evidence.workspaceUnchanged = readdirSync(workspaceDir).length === 0;
    if (!evidence.workspaceUnchanged) { evidence.status = 'failed'; evidence.reason = 'Probe workspace was modified.'; }
    prepared?.dispose();
  }
}

void (async () => {
  const choice = process.argv.find((arg) => arg.startsWith('--runtime='))?.slice('--runtime='.length);
  if (choice && choice !== 'codex' && choice !== 'claude') throw new Error('Unsupported probe runtime.');
  const runtimes: Runtime[] = choice === 'codex' || choice === 'claude' ? [choice] : ['codex', 'claude'];
  const evidence: Evidence[] = [];
  for (const runtime of runtimes) {
    const item = await probe(runtime); evidence.push(item);
    console.log(`${runtime}: status=${item.status}, markerVerified=${item.markerVerified}, workspaceUnchanged=${item.workspaceUnchanged}, elapsedMs=${item.elapsedMs}`);
  }
  const output = resolve('test-results', 'native-profile-cli-probe.json'); mkdirSync(resolve('test-results'), { recursive: true });
  writeFileSync(output, `${JSON.stringify({ checkedAt: new Date().toISOString(), scope: 'noninteractive CLI transport; interactive TUI and resumed sessions not verified', evidence }, null, 2)}\n`);
  process.exitCode = evidence.every((item) => item.status === 'passed') ? 0 : 1;
})().catch(() => { console.error('Native profile CLI probe failed; private details withheld.'); process.exitCode = 1; });
