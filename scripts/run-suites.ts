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
 *
 * Suites run in parallel processes (`--jobs N` or ADE_SUITE_JOBS; `--jobs 1`
 * restores the old sequential, streamed output). Each suite already works in
 * its own temp directories and its own process environment, so the only shared
 * resource is the machine. Output is printed per suite as one block when it
 * finishes, and the report keeps the declared order.
 */

import { spawn } from 'node:child_process';
import { availableParallelism } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

interface Suite {
  id: string;
  script: string;
  /** Lowest check count observed on a green run, per platform. */
  floors: Partial<Record<NodeJS.Platform, number>>;
}

const SUITES: Suite[] = [
  { id: 'host-boundary', script: 'test-host-boundary.ts', floors: { linux: 18, win32: 18 } },
  { id: 'host-handlers', script: 'test-host-handlers.ts', floors: { linux: 10 } },
  { id: 'host-secret-vault', script: 'test-host-secret-vault.ts', floors: { linux: 59 } },
  { id: 'linux-keyring-boundary', script: 'test-linux-keyring-boundary.ts', floors: { linux: 21 } },
  { id: 'profile-paths', script: 'test-profile-paths.ts', floors: { linux: 16 } },
  { id: 'desktop-clients', script: 'test-desktop-clients.ts', floors: { linux: 13, win32: 13 } },
  { id: 'web-push', script: 'test-web-push.ts', floors: { linux: 74 } },
  { id: 'organizer', script: 'test-organizer.ts', floors: { win32: 72 } },
  { id: 'remote-organizer', script: 'test-remote-organizer.ts', floors: { win32: 35 } },
  { id: 'remote-diagnostics', script: 'test-remote-diagnostics.ts', floors: { win32: 25 } },
  { id: 'remote-usage', script: 'test-remote-usage.ts', floors: { win32: 12 } },
  { id: 'usage-overview', script: 'test-usage-overview.ts', floors: { win32: 34 } },
  { id: 'organizer-cache', script: 'test-organizer-cache.ts', floors: { win32: 32 } },
  { id: 'sketch-input', script: 'test-sketch-input.ts', floors: { win32: 49 } },
  { id: 'usage-normalization', script: 'test-usage-normalization.ts', floors: { win32: 27 } },
  { id: 'usage-journal', script: 'test-usage-journal.ts', floors: { win32: 35 } },
  { id: 'usage-receiver', script: 'test-usage-receiver.ts', floors: { win32: 20 } },
  { id: 'native-usage-file', script: 'test-native-usage-file.ts', floors: { win32: 23 } },
  { id: 'native-usage-service', script: 'test-native-usage-service.ts', floors: { win32: 29 } },
  { id: 'speech-usage', script: 'test-speech-usage.ts', floors: { win32: 36 } },
  { id: 'dictation', script: 'test-dictation.ts', floors: { win32: 35 } },
  { id: 'live-dictation', script: 'test-live-dictation.ts', floors: { win32: 79 } },
  { id: 'remote-dictation', script: 'test-remote-dictation.ts', floors: { win32: 47 } },
  { id: 'dictation-jobs', script: 'test-dictation-jobs.ts', floors: { win32: 21 } },
  { id: 'terminal-prompt', script: 'test-terminal-prompt.ts', floors: { win32: 28, linux: 28 } },
  { id: 'terminal-media', script: 'test-terminal-media.ts', floors: { win32: 48 } },
  { id: 'microphone-access', script: 'test-microphone-access.ts', floors: { win32: 15 } },
  { id: 'prompt-drafts', script: 'test-prompt-drafts.ts', floors: { win32: 18 } },
  { id: 'speech', script: 'test-speech.ts', floors: { win32: 64 } },
  { id: 'eleven-dialogue', script: 'test-eleven-dialogue.ts', floors: { win32: 32 } },
  { id: 'reply-speech', script: 'test-reply-speech.ts', floors: { win32: 28 } },
  { id: 'remote-reply-speech', script: 'test-remote-reply-speech.ts', floors: { win32: 20 } },
  { id: 'speech-preferences', script: 'test-speech-preferences.ts', floors: { win32: 65 } },
  { id: 'integration-workflow', script: 'test-integration-workflow.ts', floors: { win32: 53 } },
  { id: 'run-deletion', script: 'test-run-deletion.ts', floors: { win32: 23 } },
  { id: 'category-navigation', script: 'test-category-navigation.ts', floors: { win32: 29 } },
  { id: 'config', script: 'test-config-store.ts', floors: { win32: 34 } },
  { id: 'device-drafts', script: 'test-device-drafts.ts', floors: { win32: 51 } },
  { id: 'workspace-assignment', script: 'test-workspace-assignment.ts', floors: { win32: 33 } },
  { id: 'setup-state', script: 'test-setup-state.ts', floors: { win32: 27 } },
  { id: 'runtime-models', script: 'test-runtime-models.ts', floors: { win32: 30 } },
  { id: 'ollama-coding', script: 'test-ollama-coding.ts', floors: { win32: 46 } },
  { id: 'main-log', script: 'test-main-log.ts', floors: { win32: 22 } },
  { id: 'memory', script: 'test-memory.ts', floors: { win32: 45 } },
  { id: 'agent-behavior', script: 'test-agent-behavior.ts', floors: { win32: 18 } },
  { id: 'profile-launch', script: 'test-profile-launch.ts', floors: { win32: 15, linux: 12 } },
  { id: 'codex-profile-config', script: 'test-codex-profile-config.ts', floors: { win32: 11, linux: 12 } },
  { id: 'interactive-profile-snapshot', script: 'test-interactive-profile-snapshot.ts', floors: { win32: 10 } },
  { id: 'dispatch', script: 'test-worker-dispatch.ts', floors: { win32: 12 } },
  { id: 'runtime', script: 'test-runtime-reliability.ts', floors: { win32: 47 } },
  { id: 'backends', script: 'test-execution-backends.ts', floors: { win32: 34 } },
  { id: 'orchestration', script: 'test-orchestration.ts', floors: { win32: 82 } },
  { id: 'orchestration-beta', script: 'test-orchestration-beta.ts', floors: { win32: 151 } },
  { id: 'run-questions', script: 'test-run-questions.ts', floors: { win32: 26 } },
  { id: 'task-reply', script: 'test-task-reply.ts', floors: { linux: 37 } },
  { id: 'codex-conversations', script: 'test-codex-conversations.ts', floors: { win32: 25 } },
  { id: 'coordinator-codex-policy', script: 'test-coordinator-codex-policy.ts', floors: { win32: 51, linux: 58 } },
  { id: 'codex-dynamic-tools', script: 'test-codex-dynamic-tools.ts', floors: { win32: 18 } },
  { id: 'supervision', script: 'test-supervision.ts', floors: { win32: 26 } },
  { id: 'conversation-service', script: 'test-conversation-service.ts', floors: { win32: 52 } },
  { id: 'remote-conversation', script: 'test-remote-conversation.ts', floors: { win32: 48 } },
  { id: 'conversation-drafts', script: 'test-conversation-drafts.ts', floors: { win32: 22 } },
  { id: 'conversation-recording', script: 'test-conversation-recording.ts', floors: { win32: 28 } },
  { id: 'coordinator-read-tools', script: 'test-coordinator-read-tools.ts', floors: { win32: 15 } },
  { id: 'coordinator-actions', script: 'test-coordinator-actions.ts', floors: { win32: 46 } },
  { id: 'conversation-projects', script: 'test-conversation-projects.ts', floors: { win32: 29 } },
  { id: 'remote-coordinator-actions', script: 'test-remote-coordinator-actions.ts', floors: { win32: 26 } },
  { id: 'handoffs', script: 'test-handoffs.ts', floors: { win32: 20 } },
  { id: 'remote-supervision', script: 'test-remote-supervision.ts', floors: { win32: 30 } },
  { id: 'publication', script: 'test-publication.ts', floors: { win32: 29 } },
  { id: 'prompts', script: 'test-prompts.ts', floors: { win32: 31 } },
  { id: 'repositories', script: 'test-repository-scopes.ts', floors: { win32: 62 } },
  { id: 'project-workspaces', script: 'test-project-workspaces.ts', floors: { win32: 48 } },
  { id: 'project-branches', script: 'test-project-branches.ts', floors: { win32: 40 } },
  { id: 'project-launch', script: 'test-project-launch.ts', floors: { win32: 50 } },
  { id: 'project-git', script: 'test-project-git.ts', floors: { win32: 54 } },
  { id: 'project-publish', script: 'test-project-publish.ts', floors: { win32: 41 } },
  { id: 'project-directory-api', script: 'test-project-directory-api.ts', floors: { win32: 36 } },
  { id: 'repository-inspector', script: 'test-repository-inspector.ts', floors: { win32: 27 } },
  { id: 'repository-sync', script: 'test-repository-sync.ts', floors: { win32: 38 } },
  { id: 'harness', script: 'test-harness-credentials.ts', floors: { win32: 21 } },
  { id: 'overview', script: 'test-overview.ts', floors: { win32: 34 } },
  { id: 'host-operation', script: 'test-host-operation.ts', floors: { linux: 54, win32: 35 } },
  { id: 'host-lifecycle', script: 'test-host-lifecycle.ts', floors: { linux: 24 } },
  { id: 'directory-identity', script: 'test-directory-identity.ts', floors: { linux: 18 } },
  { id: 'missing-projects', script: 'test-missing-projects.ts', floors: { linux: 36 } },
  { id: 'attention', script: 'test-attention.ts', floors: { linux: 49, win32: 49 } },
  { id: 'cli-work', script: 'test-cli-work.ts', floors: { win32: 25 } },
  { id: 'session-navigation', script: 'test-session-navigation.ts', floors: { win32: 14 } },
  { id: 'session-processes', script: 'test-session-processes.ts', floors: { linux: 32, win32: 19 } },
  { id: 'supervision-navigation', script: 'test-supervision-navigation.ts', floors: { win32: 8 } },
  { id: 'terminal-workspace-identity', script: 'test-terminal-workspace-identity.ts', floors: { win32: 17 } },
  { id: 'host-api', script: 'test-host-api.ts', floors: { win32: 184 } },
  { id: 'remote-devices', script: 'test-remote-devices.ts', floors: { win32: 52 } },
  { id: 'device-resources', script: 'test-device-resources.ts', floors: { win32: 43 } },
  { id: 'remote-administration', script: 'test-remote-administration.ts', floors: { win32: 36 } },
  { id: 'remote-workspaces', script: 'test-remote-workspaces.ts', floors: { win32: 55 } },
  { id: 'run-inspection', script: 'test-run-inspection.ts', floors: { win32: 57 } },
  { id: 'run-file-storage', script: 'test-run-file-storage.ts', floors: { win32: 20 } },
  { id: 'remote-workbench', script: 'test-remote-workbench.ts', floors: { win32: 46 } },
  { id: 'remote-commits', script: 'test-remote-commits.ts', floors: { win32: 29 } },
  { id: 'remote-terminal', script: 'test-remote-terminal.ts', floors: { win32: 74 } },
  { id: 'terminal-display', script: 'test-terminal-display.ts', floors: { win32: 54 } },
  { id: 'subscription-usage', script: 'test-subscription-usage.ts', floors: { win32: 14 } },
  { id: 'wsl-root-probe', script: 'test-wsl-root-probe.ts', floors: { win32: 16 } },
  { id: 'home-workspace', script: 'test-home-workspace.ts', floors: { win32: 22 } },
  { id: 'session-launch', script: 'test-session-launch.ts', floors: { win32: 39 } },
  { id: 'interactive-program', script: 'test-interactive-program.ts', floors: { win32: 17 } },
  { id: 'remote-profiles', script: 'test-remote-profiles.ts', floors: { win32: 42 } },
  { id: 'mobile-access', script: 'test-mobile-access.ts', floors: { win32: 88 } },
  // win32 runs two groups fewer than Linux: the root-swap test, which the
  // verified-path host honestly cannot pass, and the descriptor-anchored
  // profile-lock check. Everything else, including the whole apply
  // transaction, is exercised on both.
  { id: 'workspace-bundle', script: 'test-workspace-bundle.ts', floors: { win32: 200 } },
  { id: 'doctor', script: 'test-doctor.ts', floors: { win32: 20, linux: 20 } },
  { id: 'workspace-fs', script: 'test-workspace-fs.ts', floors: { win32: 14 } },
  { id: 'style-entries', script: 'test-style-entries.ts', floors: { win32: 18 } },
  { id: 'security', script: 'test-security.ts', floors: { win32: 291 } },
];

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const RECORD = process.argv.includes('--record');
const PLATFORM = process.platform;

function jobCount(): number {
  const index = process.argv.indexOf('--jobs');
  const requested = Number(index >= 0 ? process.argv[index + 1] : process.env.ADE_SUITE_JOBS);
  if (Number.isInteger(requested) && requested >= 1) return requested;
  return Math.min(8, Math.max(1, Math.floor(availableParallelism() / 4)));
}
const JOBS = jobCount();

/**
 * Measured at 40–100 s each on win32 (Git-heavy); everything else takes
 * seconds. Starting them first keeps a parallel run as short as its longest
 * suite instead of ending on a late slow one.
 */
const SLOW_FIRST = new Set(['integration-workflow', 'project-publish', 'project-git', 'orchestration-beta',
  'repository-sync', 'publication', 'project-branches']);

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

async function runSuite(suite: Suite, stream: boolean): Promise<Outcome> {
  const header = `\n=== ${suite.id} (${suite.script}) ===\n`;
  if (stream) process.stdout.write(header);
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
    if (stream) process.stdout.write(chunk);
  });
  child.stderr.on('data', (chunk: Buffer) => {
    output += chunk.toString();
    if (stream) process.stderr.write(chunk);
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

  if (!stream) process.stdout.write(header + output);
  console.log(`  -> ${suite.id}: ${summary?.passed ?? '?'} passed in ${seconds}s`
    + (problem ? `  [${problem}]` : ''));
  return { suite, code, passed: summary?.passed ?? null, failed: summary?.failed ?? null, problem };
}

async function main(): Promise<void> {
  const started = Date.now();
  const queue = JOBS === 1 ? [...SUITES]
    : [...SUITES.filter((suite) => SLOW_FIRST.has(suite.id)), ...SUITES.filter((suite) => !SLOW_FIRST.has(suite.id))];
  console.log(`Running ${SUITES.length} suites with ${JOBS} parallel job(s).`);
  const results = new Map<string, Outcome>();
  // Deliberately no early exit: one broken suite must not hide the rest.
  const worker = async (): Promise<void> => {
    for (let suite = queue.shift(); suite; suite = queue.shift()) results.set(suite.id, await runSuite(suite, JOBS === 1));
  };
  await Promise.all(Array.from({ length: Math.min(JOBS, SUITES.length) }, worker));
  const outcomes = SUITES.map((suite) => results.get(suite.id)!);

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
  console.log(`${SUITES.length} suites, ${totalPassed} checks passed on ${PLATFORM}`
    + ` in ${((Date.now() - started) / 1000).toFixed(1)}s with ${JOBS} job(s)`);

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
