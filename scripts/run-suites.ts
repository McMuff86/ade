/**
 * Runs every focused suite, enforces a measured floor on the number of checks
 * each one reports, and prints a single verdict.
 *
 * Why this exists: a plain `&&` chain stops at the first failure, so later
 * suites never run, and it accepts any check count a driver happens to print.
 * A suite that silently stops emitting checks — an early `return`, a skipped
 * platform branch, a fixture that no longer builds — still reads green. The
 * floors below turn that into a failure.
 *
 * Floors are per platform because several drivers gate checks on
 * `process.platform`. Only platforms whose numbers were actually observed are
 * enforced; anything else is reported as unmeasured rather than guessed.
 *
 * `--record` prints a manifest with the counts from this run, ready to paste.
 */

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

interface Suite {
  id: string;
  script: string;
  /** Lowest check count observed on a green run, per platform. */
  floors: Partial<Record<NodeJS.Platform, number>>;
}

const SUITES: Suite[] = [
  { id: 'config', script: 'test-config-store.ts', floors: { win32: 34 } },
  { id: 'device-drafts', script: 'test-device-drafts.ts', floors: { win32: 20 } },
  { id: 'runtime-models', script: 'test-runtime-models.ts', floors: { win32: 27 } },
  { id: 'main-log', script: 'test-main-log.ts', floors: { win32: 14 } },
  { id: 'memory', script: 'test-memory.ts', floors: { win32: 28 } },
  { id: 'dispatch', script: 'test-worker-dispatch.ts', floors: { win32: 12 } },
  { id: 'runtime', script: 'test-runtime-reliability.ts', floors: { win32: 47 } },
  { id: 'backends', script: 'test-execution-backends.ts', floors: { win32: 27 } },
  { id: 'orchestration', script: 'test-orchestration.ts', floors: { win32: 81 } },
  { id: 'orchestration-beta', script: 'test-orchestration-beta.ts', floors: { win32: 151 } },
  { id: 'publication', script: 'test-publication.ts', floors: { win32: 29 } },
  { id: 'prompts', script: 'test-prompts.ts', floors: { win32: 31 } },
  { id: 'repositories', script: 'test-repository-scopes.ts', floors: { win32: 62 } },
  { id: 'project-workspaces', script: 'test-project-workspaces.ts', floors: { win32: 40 } },
  { id: 'project-branches', script: 'test-project-branches.ts', floors: { win32: 40 } },
  { id: 'project-directory-api', script: 'test-project-directory-api.ts', floors: { win32: 26 } },
  { id: 'repository-inspector', script: 'test-repository-inspector.ts', floors: { win32: 27 } },
  { id: 'repository-sync', script: 'test-repository-sync.ts', floors: { win32: 38 } },
  { id: 'harness', script: 'test-harness-credentials.ts', floors: { win32: 21 } },
  { id: 'overview', script: 'test-overview.ts', floors: { win32: 34 } },
  { id: 'host-api', script: 'test-host-api.ts', floors: { win32: 184 } },
  { id: 'remote-devices', script: 'test-remote-devices.ts', floors: { win32: 38 } },
  { id: 'remote-administration', script: 'test-remote-administration.ts', floors: { win32: 36 } },
  { id: 'remote-workspaces', script: 'test-remote-workspaces.ts', floors: { win32: 54 } },
  { id: 'remote-workbench', script: 'test-remote-workbench.ts', floors: { win32: 46 } },
  { id: 'remote-terminal', script: 'test-remote-terminal.ts', floors: { win32: 36 } },
  { id: 'terminal-display', script: 'test-terminal-display.ts', floors: { win32: 30 } },
  { id: 'wsl-root-probe', script: 'test-wsl-root-probe.ts', floors: { win32: 16 } },
  { id: 'home-workspace', script: 'test-home-workspace.ts', floors: { win32: 22 } },
  { id: 'session-launch', script: 'test-session-launch.ts', floors: { win32: 32 } },
  { id: 'interactive-program', script: 'test-interactive-program.ts', floors: { win32: 17 } },
  { id: 'remote-profiles', script: 'test-remote-profiles.ts', floors: { win32: 22 } },
  { id: 'mobile-access', script: 'test-mobile-access.ts', floors: { win32: 71 } },
  // win32 runs two groups fewer than Linux: the root-swap test, which the
  // verified-path host honestly cannot pass, and the descriptor-anchored
  // profile-lock check. Everything else, including the whole apply
  // transaction, is exercised on both.
  { id: 'workspace-bundle', script: 'test-workspace-bundle.ts', floors: { win32: 200 } },
  { id: 'workspace-fs', script: 'test-workspace-fs.ts', floors: { win32: 14 } },
  { id: 'security', script: 'test-security.ts', floors: { win32: 218 } },
];

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const RECORD = process.argv.includes('--record');
const PLATFORM = process.platform;

/** Every driver ends with "<n> passed, <m> failed"; the last one wins. */
const SUMMARY = /(\d+) passed, (\d+) failed/g;

interface Outcome {
  suite: Suite;
  code: number | null;
  passed: number | null;
  failed: number | null;
  /** Why this suite is not green, or null when it is. */
  problem: string | null;
}

function parseSummary(output: string): { passed: number; failed: number } | null {
  let last: RegExpExecArray | null = null;
  SUMMARY.lastIndex = 0;
  for (let match = SUMMARY.exec(output); match; match = SUMMARY.exec(output)) last = match;
  if (!last) return null;
  return { passed: Number(last[1]), failed: Number(last[2]) };
}

async function runSuite(suite: Suite): Promise<Outcome> {
  const started = Date.now();
  // `node --import tsx` avoids depending on how the tsx shim resolves on the
  // host; this is the same interpreter that runs this file.
  const child = spawn(process.execPath, ['--import', 'tsx', join(SCRIPT_DIR, suite.script)], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
  });
  let output = '';
  child.stdout.on('data', (chunk: Buffer) => {
    output += chunk.toString();
    process.stdout.write(chunk);
  });
  child.stderr.on('data', (chunk: Buffer) => {
    output += chunk.toString();
    process.stderr.write(chunk);
  });
  const code = await new Promise<number | null>((resolve) => {
    child.on('error', (error) => {
      process.stderr.write(`  could not start ${suite.script}: ${String(error)}\n`);
      resolve(null);
    });
    child.on('close', (exitCode) => resolve(exitCode));
  });
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  const summary = parseSummary(output);
  const floor = suite.floors[PLATFORM];

  let problem: string | null = null;
  if (code !== 0) {
    problem = `exited with code ${code === null ? 'unknown' : code}`;
  } else if (!summary) {
    problem = 'printed no "<n> passed, <m> failed" summary';
  } else if (summary.failed > 0) {
    problem = `${summary.failed} failed`;
  } else if (floor !== undefined && summary.passed < floor) {
    problem = `only ${summary.passed} checks, floor for ${PLATFORM} is ${floor}`;
  }

  console.log(`  -> ${suite.id}: ${summary?.passed ?? '?'} passed in ${seconds}s`
    + (problem ? `  [${problem}]` : ''));
  return { suite, code, passed: summary?.passed ?? null, failed: summary?.failed ?? null, problem };
}

async function main(): Promise<void> {
  const outcomes: Outcome[] = [];
  for (const suite of SUITES) {
    console.log(`\n=== ${suite.id} (${suite.script}) ===`);
    // Deliberately no early exit: one broken suite must not hide the rest.
    outcomes.push(await runSuite(suite));
  }

  if (RECORD) {
    console.log(`\nMeasured floors for ${PLATFORM}:`);
    for (const outcome of outcomes) {
      const floors = { ...outcome.suite.floors, [PLATFORM]: outcome.passed ?? 0 };
      const rendered = Object.entries(floors).map(([key, value]) => `${key}: ${value}`).join(', ');
      console.log(`  { id: '${outcome.suite.id}', script: '${outcome.suite.script}',`
        + ` floors: { ${rendered} } },`);
    }
  }

  const totalPassed = outcomes.reduce((sum, item) => sum + (item.passed ?? 0), 0);
  const broken = outcomes.filter((item) => item.problem !== null);
  const unmeasured = outcomes.filter((item) => item.suite.floors[PLATFORM] === undefined);
  const grown = outcomes.filter((item) => {
    const floor = item.suite.floors[PLATFORM];
    return floor !== undefined && item.passed !== null && item.passed > floor;
  });

  console.log(`\n${'-'.repeat(64)}`);
  console.log(`${SUITES.length} suites, ${totalPassed} checks passed on ${PLATFORM}`);

  if (unmeasured.length > 0) {
    // Stated, never silent: an unenforced floor is a gap in the evidence.
    console.log(`\n${unmeasured.length} suite(s) have no measured floor for ${PLATFORM};`
      + ' their check count is not enforced here.');
    console.log(`  ${unmeasured.map((item) => item.suite.id).join(', ')}`);
    console.log('  Record them from a green run: pnpm test -- --record');
  }
  if (grown.length > 0) {
    console.log(`\n${grown.length} suite(s) now report more checks than their floor.`
      + ' Raise the floors in scripts/run-suites.ts so the gain is protected:');
    for (const item of grown) {
      console.log(`  ${item.suite.id}: ${item.suite.floors[PLATFORM]} -> ${item.passed}`);
    }
  }

  if (broken.length > 0) {
    console.log(`\nFAILED - ${broken.length} of ${SUITES.length} suites:`);
    for (const item of broken) console.log(`  ${item.suite.id}: ${item.problem}`);
    process.exit(1);
  }
  console.log('\nPASSED - every suite met its floor');
}

void main();
