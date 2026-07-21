/**
 * Prompt/context observability checks (P0a):
 * - snapshot tests for every managed-phase prompt (plan/work/integrate/verify),
 * - run-context manifest determinism (stable hash, content-sensitive digests),
 * - path-free guarantees (no absolute host paths in prompts or manifest JSON),
 * - task-context packet bounds.
 *
 * Regenerate snapshots deliberately with:
 *   UPDATE_PROMPT_SNAPSHOTS=1 pnpm run test:prompts
 * and bump the affected PROMPT_VERSIONS entry when a prompt's content changes.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { DEFAULT_RUN_BUDGET, type Run, type RunParticipant, type StructuredTaskResult } from '../src/shared/types';
import {
  buildRunContextManifest,
  buildTaskContextPacket,
  manifestHash,
  renderManifestBrief,
  stableStringify,
  type ManifestParticipant,
} from '../src/main/orchestration/contextManifest';
import {
  PROMPT_VERSIONS,
  integrationPrompt,
  planningPrompt,
  verificationPrompt,
  workerPrompt,
} from '../src/main/orchestration/prompts';

let passed = 0;
let failed = 0;

function check(label: string, condition: unknown): void {
  if (condition) {
    passed += 1;
    console.log(`  ok  ${label}`);
  } else {
    failed += 1;
    console.error(`FAIL  ${label}`);
  }
}

const UPDATE = process.env.UPDATE_PROMPT_SNAPSHOTS === '1';
const SNAPSHOT_DIR = join(__dirname, 'fixtures', 'prompts');
const ABSOLUTE_PATH_PATTERN = /[A-Za-z]:[\\/]|\/home\/|\/tmp\//;

function normalize(text: string): string {
  return text.replace(/\r\n/g, '\n');
}

function checkSnapshot(name: string, rendered: string): void {
  const file = join(SNAPSHOT_DIR, `${name}.snapshot.txt`);
  if (UPDATE || !existsSync(file)) {
    mkdirSync(SNAPSHOT_DIR, { recursive: true });
    writeFileSync(file, rendered, 'utf8');
    console.log(`  wrote snapshot ${basename(file)}`);
  }
  const expected = normalize(readFileSync(file, 'utf8'));
  const matches = normalize(rendered) === expected;
  if (!matches) {
    console.error(`--- expected (${name}) ---\n${expected}\n--- actual ---\n${rendered}\n---`);
  }
  check(`${name} prompt matches its committed snapshot`, matches);
}

/* ------------------------------------------------- deterministic fixtures */

// The fixture workspace is generated with exact byte content so instruction
// digests, chars, and therefore the manifest hash are machine-independent.
const workspaceRoot = mkdtempSync(join(tmpdir(), 'ade-prompt-fixture-'));
writeFileSync(join(workspaceRoot, 'CLAUDE.md'), 'Fixture repo rules: keep modules small.\n', 'utf8');
writeFileSync(join(workspaceRoot, 'AGENTS.md'), 'Fixture agent instructions: run the focused suite.\n', 'utf8');
writeFileSync(
  join(workspaceRoot, 'package.json'),
  `${JSON.stringify({
    name: 'fixture',
    scripts: { test: 'tsx scripts/test.ts', typecheck: 'tsc --noEmit', build: 'vite build' },
  }, null, 2)}\n`,
  'utf8',
);
mkdirSync(join(workspaceRoot, 'src'), { recursive: true });
writeFileSync(join(workspaceRoot, 'src', 'index.ts'), 'export const answer = 42;\n', 'utf8');

const run: Run = {
  id: 'run-fixture-1',
  name: 'Fixture Run',
  goal: 'Improve the sample feature end to end',
  status: 'running',
  mode: 'managed',
  phase: 'planning',
  budget: DEFAULT_RUN_BUDGET,
  createdAt: 0,
  updatedAt: 0,
  repositoryId: 'repo-fixture-1',
};

const participants: RunParticipant[] = [
  {
    id: 'p-orchestrator', runId: run.id, agentId: 'agent-1', agentName: 'Conductor',
    runtime: 'codex', role: 'orchestrator', createdAt: 0,
  },
  {
    id: 'p-worker-1', runId: run.id, agentId: 'agent-2', agentName: 'Builder One',
    runtime: 'codex', role: 'worker', teamId: 'team-a', teamName: 'Core', createdAt: 0,
  },
  {
    id: 'p-worker-2', runId: run.id, agentId: 'agent-3', agentName: 'Builder Two',
    runtime: 'claude', role: 'worker', teamId: 'team-a', teamName: 'Core', createdAt: 0,
  },
];

const manifestParticipants: ManifestParticipant[] = [
  {
    participantId: 'p-orchestrator', agentName: 'Conductor', role: 'orchestrator',
    runtime: 'codex', permissionMode: 'default', adapterId: 'codex-jsonl-v1',
    modelId: 'gpt-5.6-sol', reasoningEffort: 'xhigh',
    reportsTokens: true, reportsCost: false,
  },
  {
    participantId: 'p-worker-1', agentName: 'Builder One', role: 'worker', teamName: 'Core',
    runtime: 'codex', permissionMode: 'default', adapterId: 'codex-jsonl-v1',
    modelId: 'gpt-5.6-sol', reasoningEffort: 'high',
    reportsTokens: true, reportsCost: false,
  },
  {
    participantId: 'p-worker-2', agentName: 'Builder Two', role: 'worker', teamName: 'Core',
    runtime: 'claude', permissionMode: 'default', adapterId: 'file-mailbox-v1',
    reportsTokens: false, reportsCost: false,
  },
];

const manifestInput = {
  run: { id: run.id, name: run.name, goal: run.goal },
  repository: {
    repositoryId: 'repo-fixture-1',
    name: 'fixture-repo',
    isRepo: true,
    branch: 'ade/fixture',
    baseSha: '0123456789abcdef0123456789abcdef01234567',
  },
  participants: manifestParticipants,
  scanRoot: workspaceRoot,
};

const manifest = buildRunContextManifest(manifestInput);
const hash = manifestHash(manifest);
const brief = renderManifestBrief(manifest, hash);

/* --------------------------------------------------------- manifest checks */

console.log('manifest determinism');
check('manifest hash is stable for identical input', manifestHash(buildRunContextManifest(manifestInput)) === hash);
check('manifest records both instruction files with digests', manifest.instructionFiles.length === 2 &&
  manifest.instructionFiles.every((file) => /^[0-9a-f]{64}$/.test(file.sha256)));
check('manifest whitelists package scripts', Object.keys(manifest.packageScripts).sort().join(',') === 'build,test,typecheck');
check('manifest lists top-level entries with dir markers', manifest.topLevelEntries.includes('src/') &&
  manifest.topLevelEntries.includes('CLAUDE.md'));
check('manifest versions carry prompt/schema/builder versions',
  manifest.versions.prompts.plan === PROMPT_VERSIONS.plan && manifest.versions.resultSchema === 1 &&
  manifest.versions.contextBuilder >= 1);

const manifestJson = stableStringify(manifest);
const tempMarker = basename(workspaceRoot);
check('manifest JSON is path-free (no scan root leak)', !manifestJson.includes(tempMarker));
check('manifest JSON contains no absolute host path', !ABSOLUTE_PATH_PATTERN.test(manifestJson));
check('stableStringify sorts keys recursively',
  stableStringify({ b: 1, a: { d: 2, c: 3 } }) === stableStringify({ a: { c: 3, d: 2 }, b: 1 }));

appendFileSync(join(workspaceRoot, 'CLAUDE.md'), 'One more rule.\n', 'utf8');
const changed = buildRunContextManifest(manifestInput);
check('changing an instruction file changes its digest and the manifest hash',
  manifestHash(changed) !== hash &&
  changed.instructionFiles[0]!.sha256 !== manifest.instructionFiles[0]!.sha256);

/* ----------------------------------------------------------- prompt checks */

console.log('prompt snapshots');
const assignment: StructuredTaskResult['assignments'][number] = {
  participantId: 'p-worker-2',
  title: 'Implement the feature slice',
  prompt: 'Implement the sample feature in src/feature.ts and cover it with a focused test.',
  acceptanceCriteria: ['Focused test passes', 'No unrelated files change'],
  dependsOn: ['p-worker-1'],
};

const workerResults: Array<StructuredTaskResult & { participantId?: string }> = [
  {
    version: 1, outcome: 'succeeded', summary: 'Prepared the shared contract module.',
    assignments: [], filesChanged: ['src/contract.ts'], commitSha: 'abc1234',
    tests: [{ command: 'pnpm run test:contract', status: 'passed', output: 'ok' }],
    risks: [], usage: { inputTokens: 100, outputTokens: 50, costUsd: null },
    participantId: 'p-worker-1',
  },
  {
    version: 1, outcome: 'succeeded', summary: 'Implemented the feature slice.',
    assignments: [], filesChanged: ['src/feature.ts', 'src/feature.test.ts'], commitSha: 'def5678',
    tests: [{ command: 'pnpm run test:feature', status: 'passed', output: 'ok' }],
    risks: ['Feature flag remains off by default'], usage: { inputTokens: 200, outputTokens: 80, costUsd: null },
    participantId: 'p-worker-2',
  },
];

const integrationResult: StructuredTaskResult = {
  version: 1, outcome: 'succeeded', summary: 'Integrated both worker commits; suite green.',
  assignments: [], filesChanged: [], commitSha: null, tests: [
    { command: 'pnpm test', status: 'passed', output: 'ok' },
  ],
  risks: [], usage: { inputTokens: null, outputTokens: null, costUsd: null },
};

const planRendered = planningPrompt(run, participants, { brief });
const workRendered = workerPrompt(run, assignment, { brief, hasDependencies: true });
const integrateRendered = integrationPrompt(run, workerResults, 2, true, { brief, manifestHash: hash });
const verifyRendered = verificationPrompt(run, integrationResult, { brief });

checkSnapshot('plan', planRendered);
checkSnapshot('work', workRendered);
checkSnapshot('integrate', integrateRendered);
checkSnapshot('verify', verifyRendered);

console.log('prompt invariants');
check('planning prompt states that dependent workers inherit prepared upstream code',
  planRendered.includes('DO inherit upstream code')
    && planRendered.includes('fails the run closed'));
check('dependent worker prompt points at TASK_CONTEXT.json and the prepared base',
  workRendered.includes('TASK_CONTEXT.json')
    && workRendered.includes('ALREADY CONTAINS their validated'));
check('independent worker prompt omits the dependency note',
  !workerPrompt(run, { ...assignment, dependsOn: [] }, { brief, hasDependencies: false }).includes('TASK_CONTEXT.json'));
check('integration prompt references the manifest hash', integrateRendered.includes(hash.slice(0, 16)));
check('integration prompt distinguishes review edits from already integrated worker files',
  integrateRendered.includes('ONLY the currently uncommitted paths')
    && integrateRendered.includes('Do not repeat files that arrived in worker commits'));
for (const [name, rendered] of [
  ['plan', planRendered], ['work', workRendered], ['integrate', integrateRendered], ['verify', verifyRendered],
] as const) {
  check(`${name} prompt contains no absolute host path`, !ABSOLUTE_PATH_PATTERN.test(rendered));
}
check('brief lists instruction files with digests', brief.includes('CLAUDE.md (sha256'));
check('brief makes Codex model and reasoning provenance visible',
  brief.includes('model gpt-5.6-sol | reasoning xhigh'));

/* ----------------------------------------------------------- packet bounds */

console.log('task context packet');
const packet = buildTaskContextPacket({
  task: { id: 'task-1', runId: run.id, phase: 'work', title: 'Implement the feature slice', dependsOn: ['p-worker-1'] },
  manifestHash: hash,
  provenance: {
    promptVersion: PROMPT_VERSIONS.work,
    resultSchemaVersion: 1,
    adapterId: 'codex-jsonl-v1',
    contextBuilderVersion: manifest.contextBuilderVersion,
    contextManifestHash: hash,
    modelId: 'gpt-5.6-sol',
    reasoningEffort: 'high',
  },
  dependencyResults: Array.from({ length: 20 }, (_, index) => ({
    participantId: `p-${index}`,
    taskId: `t-${index}`,
    summary: 'x'.repeat(index === 0 ? 13_000 : 5_000),
    filesChanged: Array.from({ length: 300 }, (_f, fileIndex) => `src/file-${fileIndex}.ts`),
    commitSha: null,
    tests: Array.from({ length: 40 }, () => ({ command: 'pnpm test', status: 'passed' })),
    risks: Array.from({ length: 20 }, () => 'risk'),
  })),
  agentInstructions: { file: 'AGENTS.md', sha256: 'b'.repeat(64), chars: 1_234 },
  memorySnapshot: { file: 'MEMORY_SNAPSHOT.md', sha256: 'a'.repeat(64), chars: 42 },
});
check('packet caps dependency entries at 16', packet.dependencies.length === 16);
check('packet marks dependency summary cuts at the 12k result cap',
  packet.dependencies[0]!.summary.length === 12_000
  && packet.dependencies[0]!.summary.includes('[ADE: truncated, 13000 chars total]'));
check('packet forwards dependency summaries intact below the result cap',
  packet.dependencies[1]!.summary.length === 5_000
  && !packet.dependencies[1]!.summary.includes('[ADE: truncated'));
check('packet caps changed files per dependency at 200', packet.dependencies[0]!.filesChanged.length === 200);
check('packet caps tests per dependency at 20', packet.dependencies[0]!.tests.length === 20);
check('packet keeps provenance and manifest linkage',
  packet.provenance.adapterId === 'codex-jsonl-v1' && packet.manifestHash === hash &&
  packet.provenance.modelId === 'gpt-5.6-sol' && packet.provenance.reasoningEffort === 'high' &&
  packet.agentInstructions?.file === 'AGENTS.md' &&
  packet.memorySnapshot?.file === 'MEMORY_SNAPSHOT.md');
const packetChars = stableStringify(packet).length;
check('packet JSON stays within the 256 KiB artifact cap', packetChars < 256 * 1_024, packetChars);

rmSync(workspaceRoot, { recursive: true, force: true });

console.log(`\nprompt/context checks: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
