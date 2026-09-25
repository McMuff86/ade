/**
 * `pnpm verify`: the repository-wide check, run against an isolated build.
 *
 * Why this exists: the former `&&` chain built into `out/`, which the personal
 * ADE instance runs from, so the full run was skipped whenever ADE was open.
 * It also stopped at the first failure, printed no timings, and one stuck
 * Electron driver could hang it forever. This runner builds into its own
 * directory (exported to every driver as ADE_BUILD_DIR, see
 * scripts/helpers/buildOutput.ts), keeps going after a failure, bounds every
 * step, and writes one log per step plus a timed report.
 *
 * Order: the typechecks at once, then the build, then the focused suites, the
 * driver pool and the clipboard lane side by side, and last the solo drivers
 * one at a time on an otherwise idle machine (see Lane).
 *
 * Options:
 *   --gate            the fast check before an activation (scripts/activate.ps1):
 *                     typecheck, focused suites, isolated build and GATE_DRIVERS
 *   --only a,b        run just these step ids; the build is added when a driver needs it
 *   --reuse-build     keep an existing isolated build instead of rebuilding
 *   --build-dir DIR   isolated build directory (default test-results/verify-build)
 *   --driver-jobs N   pool drivers at once (default 4, or ADE_DRIVER_JOBS)
 */

import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { appendFileSync, createWriteStream, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

type Kind = 'typecheck' | 'suites' | 'build' | 'driver';

/**
 * How a driver may share the machine. Every driver has its own profile, ports
 * and temp directories, so most run in the pool. Two drive the real system
 * clipboard and must not overlap each other; the solo drivers measure latency,
 * races or pixels, or restart fixture CLIs back to back, and run alone at the end.
 */
type Lane = 'pool' | 'clipboard' | 'solo';

interface Step {
  id: string;
  kind: Kind;
  command: string[];
  timeoutMs: number;
  lane: Lane;
}

type Status = 'passed' | 'failed' | 'timeout' | 'skipped';

interface Outcome {
  id: string;
  kind: Kind;
  status: Status;
  seconds: number;
  exitCode: number | null;
  passed: number | null;
  failed: number | null;
  log: string;
}

const REPOSITORY = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const requireFromHere = createRequire(import.meta.url);
const NODE = process.execPath;
const MINUTE = 60_000;

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function bin(pkg: string, name: string): string {
  const manifest = requireFromHere(`${pkg}/package.json`) as { bin: string | Record<string, string> };
  const entry = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin[name];
  if (!entry) throw new Error(`${pkg} has no "${name}" binary`);
  return join(dirname(requireFromHere.resolve(`${pkg}/package.json`)), entry);
}

const BUILD_DIR = resolve(REPOSITORY, option('--build-dir') ?? 'test-results/verify-build');
const LOG_DIR = join(REPOSITORY, 'test-results', 'verify');
const REUSE_BUILD = process.argv.includes('--reuse-build');
const ONLY = option('--only')?.split(',').map((id) => id.trim()).filter(Boolean);
const GATE = process.argv.includes('--gate');
if (GATE && ONLY) {
  console.error('verify: --gate and --only exclude each other');
  process.exit(2);
}

/**
 * The drivers of the gate cover the main desktop and tablet paths in a few
 * minutes; everything else waits for the full run.
 */
const GATE_DRIVERS = new Set(['electron-workflow', 'mobile-browser', 'mobile-electron', 'remote-terminal-electron:tablet-layout',
  'organizer-electron', 'work-electron']);

function positiveInteger(value: string | undefined): number | undefined {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : undefined;
}
const DRIVER_JOBS = positiveInteger(option('--driver-jobs')) ?? positiveInteger(process.env.ADE_DRIVER_JOBS) ?? 4;

// The personal instance runs from out/, and externalized dependencies resolve
// upward from the build, so the directory must stay inside the repository.
if (BUILD_DIR === join(REPOSITORY, 'out') || !BUILD_DIR.startsWith(REPOSITORY + sep)) {
  console.error(`verify: build directory must be inside the repository and not out/: ${BUILD_DIR}`);
  process.exit(2);
}

const tsc = (project: string): Step => ({
  id: `typecheck:${project.replace(/^tsconfig\.|\.json$/g, '')}`, kind: 'typecheck', timeoutMs: 10 * MINUTE, lane: 'pool',
  command: [NODE, bin('typescript', 'tsc'), '--noEmit', '-p', project],
});

const driver = (id: string, script: string, options: { args?: string[]; lane?: Lane } = {}): Step => ({
  id, kind: 'driver', timeoutMs: 20 * MINUTE, lane: options.lane ?? 'pool',
  command: [NODE, '--import', 'tsx', join('scripts', script), ...(options.args ?? [])],
});
const only = (flag: string, lane: Lane = 'pool') => ({ args: [`--${flag}-only`], lane });

const STEPS: Step[] = [
  tsc('tsconfig.node.json'),
  tsc('tsconfig.web.json'),
  tsc('tsconfig.scripts.json'),
  { id: 'suites', kind: 'suites', timeoutMs: 40 * MINUTE, lane: 'pool', command: [NODE, '--import', 'tsx', join('scripts', 'run-suites.ts')] },
  { id: 'build:desktop', kind: 'build', timeoutMs: 10 * MINUTE, lane: 'pool',
    command: [NODE, bin('electron-vite', 'electron-vite'), 'build', '--outDir', BUILD_DIR] },
  { id: 'build:mobile', kind: 'build', timeoutMs: 10 * MINUTE, lane: 'pool',
    command: [NODE, bin('vite', 'vite'), 'build', '--config', 'vite.mobile.config.ts', '--outDir', join(BUILD_DIR, 'mobile'), '--emptyOutDir'] },
  driver('ollama-electron', 'test-ollama-electron.ts'),
  driver('speech-electron', 'test-speech-electron.ts'),
  driver('reply-speech-electron', 'test-reply-speech-electron.ts'),
  driver('dictation-electron:computer', 'test-dictation-electron.ts', only('computer')),
  driver('dictation-electron:terminal-media', 'test-dictation-electron.ts', only('terminal-media', 'clipboard')),
  driver('dictation-electron', 'test-dictation-electron.ts'),
  driver('mobile-speech-browser', 'test-mobile-speech-browser.ts'),
  driver('agent-behavior-browser', 'test-agent-behavior-browser.ts'),
  driver('profile-session-electron', 'test-profile-session-electron.ts'),
  driver('agent-settings-profile-electron', 'test-agent-settings-profile-electron.ts'),
  driver('work-electron', 'test-work-electron.ts'),
  driver('organizer-electron', 'test-organizer-electron.ts'),
  driver('organizer-browser', 'test-organizer-browser.ts'),
  driver('usage-overview-electron', 'test-usage-overview-electron.ts'),
  driver('conversation-electron', 'test-conversation-electron.ts'),
  driver('electron-workflow', 'test-electron-workflow.ts'),
  driver('git-sync-electron', 'test-git-sync-electron.ts'),
  driver('mobile-browser', 'test-mobile-browser.ts'),
  driver('mobile-electron', 'test-mobile-electron.ts'),
  driver('remote-restart-electron', 'test-remote-restart-electron.ts'),
  driver('remote-workspace-browser', 'test-remote-workspace-browser.ts'),
  driver('remote-workbench-browser', 'test-remote-workbench-browser.ts'),
  driver('remote-terminal-electron:session-navigation', 'test-remote-terminal-electron.ts', only('session-navigation')),
  driver('remote-terminal-electron:tablet-layout', 'test-remote-terminal-electron.ts', only('tablet-layout')),
  // Restarts short-lived fixture CLIs back to back; beside the pool it failed at changing spots.
  driver('remote-terminal-electron', 'test-remote-terminal-electron.ts', { lane: 'solo' }),
  driver('remote-terminal-electron:run-inspection', 'test-remote-terminal-electron.ts', only('run-inspection')),
  driver('remote-terminal-electron:workspace-cli', 'test-remote-terminal-electron.ts', only('workspace-cli', 'clipboard')),
  driver('remote-terminal-electron:project-git', 'test-remote-terminal-electron.ts', only('project-git')),
  driver('remote-terminal-electron:terminal-latency', 'test-remote-terminal-electron.ts', only('terminal-latency', 'solo')),
  driver('remote-terminal-electron:input-race', 'test-remote-terminal-electron.ts', only('input-race', 'solo')),
  driver('project-publish-browser', 'test-project-publish-browser.ts'),
  driver('setup-electron', 'test-setup-electron.ts'),
  driver('visual-regression', 'test-visual-regression.ts', { lane: 'solo' }),
];

function selectSteps(): Step[] {
  if (GATE) {
    const missing = [...GATE_DRIVERS].filter((id) => !STEPS.some((step) => step.id === id));
    if (missing.length > 0) throw new Error(`gate names unknown drivers: ${missing.join(', ')}`);
    return STEPS.filter((step) => step.kind !== 'driver' || GATE_DRIVERS.has(step.id));
  }
  if (!ONLY) return STEPS;
  const unknown = ONLY.filter((id) => !STEPS.some((step) => step.id === id));
  if (unknown.length > 0) {
    console.error(`verify: unknown step(s) ${unknown.join(', ')}. Known:\n  ${STEPS.map((step) => step.id).join('\n  ')}`);
    process.exit(2);
  }
  const chosen = STEPS.filter((step) => ONLY.includes(step.id));
  const needsBuild = chosen.some((step) => step.kind === 'driver');
  const built = existsSync(join(BUILD_DIR, 'main', 'index.js')) && existsSync(join(BUILD_DIR, 'mobile', 'index.html'));
  if (!needsBuild || (REUSE_BUILD && built)) return chosen;
  return STEPS.filter((step) => ONLY.includes(step.id) || step.kind === 'build');
}

/** Every driver ends with "<n> passed, <m> failed"; the suite runner with "<n> checks passed". */
function summarize(kind: Kind, output: string): { passed: number | null; failed: number | null } {
  if (kind === 'suites') {
    const total = /(\d+) suites, (\d+) checks passed/.exec(output);
    const broken = /FAILED - (\d+) of/.exec(output);
    return { passed: total ? Number(total[2]) : null, failed: broken ? Number(broken[1]) : total ? 0 : null };
  }
  let last: RegExpExecArray | null = null;
  for (const match of output.matchAll(/(\d+) passed, (\d+) failed/g)) last = match as RegExpExecArray;
  return last ? { passed: Number(last[1]), failed: Number(last[2]) } : { passed: null, failed: null };
}

function killTree(pid: number): void {
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true });
  else try { process.kill(-pid, 'SIGKILL'); } catch { /* already gone */ }
}

async function runStep(step: Step, env: NodeJS.ProcessEnv): Promise<Outcome> {
  const log = join(LOG_DIR, `${step.id.replace(/[^a-z0-9.-]+/gi, '-')}.log`);
  const sink = createWriteStream(log);
  const started = Date.now();
  // Enough of the end for the summary line and a readable failure tail.
  let tail = '';
  const child = spawn(step.command[0]!, step.command.slice(1), {
    cwd: REPOSITORY, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, detached: process.platform !== 'win32',
  });
  const collect = (chunk: Buffer): void => {
    sink.write(chunk);
    tail = (tail + chunk.toString()).slice(-64 * 1024);
  };
  child.stdout.on('data', collect);
  child.stderr.on('data', collect);
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; if (child.pid) killTree(child.pid); }, step.timeoutMs);
  const exitCode = await new Promise<number | null>((done) => {
    child.on('error', (error) => { collect(Buffer.from(`\nverify: could not start: ${String(error)}\n`)); done(null); });
    child.on('close', (code) => done(code));
  });
  clearTimeout(timer);
  await new Promise<void>((done) => sink.end(done));
  const seconds = Math.round((Date.now() - started) / 100) / 10;
  const { passed, failed } = summarize(step.kind, tail);
  const counted = step.kind === 'driver' || step.kind === 'suites';
  const status: Status = timedOut ? 'timeout'
    : exitCode === 0 && (!counted || (passed !== null && failed === 0)) ? 'passed' : 'failed';
  if (status !== 'passed') {
    const lines = tail.trimEnd().split(/\r?\n/).slice(-30).map((line) => `      ${line}`).join('\n');
    console.log(`${lines}\n      (full log: ${relative(REPOSITORY, log)})`);
  }
  return { id: step.id, kind: step.kind, status, seconds, exitCode, passed, failed, log: relative(REPOSITORY, log) };
}

function git(args: string[]): string {
  try { return execFileSync('git', args, { cwd: REPOSITORY, encoding: 'utf8', windowsHide: true }).trim(); } catch { return ''; }
}

function formatSeconds(seconds: number): string {
  return seconds >= 60 ? `${Math.floor(seconds / 60)}m ${String(Math.round(seconds % 60)).padStart(2, '0')}s` : `${seconds.toFixed(1)}s`;
}

/** Seconds each step took in recent runs, to start long pool drivers first. */
function lastDurations(): Map<string, number> {
  const durations = new Map<string, number>();
  try {
    const lines = readFileSync(join(LOG_DIR, 'history.jsonl'), 'utf8').trim().split('\n').slice(-20);
    for (const line of lines) for (const step of (JSON.parse(line) as { steps: Outcome[] }).steps) {
      if (step.status === 'passed') durations.set(step.id, step.seconds);
    }
  } catch { /* first run: declared order */ }
  return durations;
}

/**
 * One run at a time: a second one would delete the build the first one's
 * drivers are using (e.g. an activation while the owed full run still runs).
 */
function acquireRunLock(): void {
  const lock = join(LOG_DIR, 'verify.lock');
  const alive = (pid: number): boolean => { try { process.kill(pid, 0); return true; } catch { return false; } };
  try {
    writeFileSync(lock, String(process.pid), { flag: 'wx' });
  } catch {
    const holder = Number(readFileSync(lock, 'utf8'));
    if (Number.isInteger(holder) && holder > 0 && holder !== process.pid && alive(holder)) {
      console.error(`verify: another run (PID ${holder}) still holds ${relative(REPOSITORY, lock)}; wait for it or stop it first`);
      process.exit(2);
    }
    writeFileSync(lock, String(process.pid));
  }
  process.on('exit', () => {
    try { if (readFileSync(lock, 'utf8') === String(process.pid)) rmSync(lock); } catch { /* already gone */ }
  });
}

async function main(): Promise<void> {
  const steps = selectSteps();
  mkdirSync(LOG_DIR, { recursive: true });
  acquireRunLock();
  const env = { ...process.env, ADE_BUILD_DIR: BUILD_DIR };
  const startedAt = new Date();
  console.log(`verify: ${steps.length} step(s), isolated build ${relative(REPOSITORY, BUILD_DIR)}, logs ${relative(REPOSITORY, LOG_DIR)},`
    + ` ${DRIVER_JOBS} pool driver(s) at once`);

  const outcomes = new Map<string, Outcome>();
  const label = (step: Step): string => `[${String(steps.indexOf(step) + 1).padStart(2)}/${steps.length}] ${step.id}`;
  const run = async (step: Step): Promise<Outcome> => {
    if (step.id === 'build:desktop') rmSync(BUILD_DIR, { recursive: true, force: true });
    console.log(`${label(step)} ...`);
    const outcome = await runStep(step, env);
    outcomes.set(step.id, outcome);
    const counts = outcome.passed === null ? '' : `  ${outcome.passed} passed${outcome.failed ? `, ${outcome.failed} failed` : ''}`;
    console.log(`${label(step)}  ${outcome.status}${counts}  ${formatSeconds(outcome.seconds)}`);
    return outcome;
  };
  const ofKind = (kind: Kind): Step[] => steps.filter((step) => step.kind === kind);

  await Promise.all(ofKind('typecheck').map(run));
  let buildBroken = false;
  for (const step of ofKind('build')) if ((await run(step)).status !== 'passed') buildBroken = true;

  const drivers = ofKind('driver');
  if (buildBroken) {
    for (const step of drivers) {
      console.log(`${label(step)}  skipped (build failed)`);
      outcomes.set(step.id, { id: step.id, kind: step.kind, status: 'skipped', seconds: 0, exitCode: null, passed: null, failed: null, log: '' });
    }
  }
  const lane = (name: Lane): Step[] => (buildBroken ? [] : drivers.filter((step) => step.lane === name));
  const known = lastDurations();
  // Unmeasured drivers first, then the longest, so the pool ends on short ones.
  const pool = lane('pool').sort((a, b) => (known.get(b.id) ?? Infinity) - (known.get(a.id) ?? Infinity));
  const poolWorker = async (): Promise<void> => { for (let step = pool.shift(); step; step = pool.shift()) await run(step); };
  const serial = async (items: Step[]): Promise<void> => { for (const step of items) await run(step); };
  await Promise.all([
    ...ofKind('suites').map(run),
    serial(lane('clipboard')),
    ...Array.from({ length: Math.min(DRIVER_JOBS, pool.length) }, poolWorker),
  ]);
  await serial(lane('solo'));

  const finishedAt = new Date();
  const totalSeconds = Math.round((finishedAt.getTime() - startedAt.getTime()) / 1000);
  const report = {
    startedAt: startedAt.toISOString(), finishedAt: finishedAt.toISOString(), totalSeconds,
    head: git(['rev-parse', '--short', 'HEAD']), dirtyFiles: git(['status', '--porcelain']).split('\n').filter(Boolean).length,
    mode: GATE ? 'gate' : ONLY ? 'only' : 'full',
    buildDir: relative(REPOSITORY, BUILD_DIR), only: ONLY ?? null, driverJobs: DRIVER_JOBS,
    steps: steps.map((step) => outcomes.get(step.id)!),
  };
  writeFileSync(join(LOG_DIR, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  appendFileSync(join(LOG_DIR, 'history.jsonl'), JSON.stringify(report) + '\n');

  console.log(`\n${'-'.repeat(64)}\nSlowest steps:`);
  const ordered = steps.map((step) => outcomes.get(step.id)!);
  for (const outcome of [...ordered].sort((a, b) => b.seconds - a.seconds).slice(0, 10)) {
    console.log(`  ${formatSeconds(outcome.seconds).padStart(8)}  ${outcome.id}`);
  }
  const broken = ordered.filter((outcome) => outcome.status !== 'passed');
  console.log(`\n${ordered.length} step(s) in ${formatSeconds(totalSeconds)}; report ${relative(REPOSITORY, join(LOG_DIR, 'report.json'))}`);
  if (broken.length > 0) {
    console.log(`FAILED - ${broken.length} step(s):`);
    for (const outcome of broken) console.log(`  ${outcome.id}: ${outcome.status}${outcome.log ? ` (${outcome.log})` : ''}`);
    process.exit(1);
  }
  console.log('PASSED - every step is green');
}

void main();
