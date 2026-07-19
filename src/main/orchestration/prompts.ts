/**
 * Versioned phase-prompt builders for managed runs (P0a prompt/context
 * observability). Extracted verbatim from RunCoordinator; every content change
 * must bump the phase version in PROMPT_VERSIONS so run/task provenance can
 * attribute behavior to an exact prompt release. Builders are pure functions:
 * no filesystem access, no absolute host paths in any rendered prompt.
 */

import type { Run, RunParticipant, StructuredTaskResult } from '../../shared/types';

/** Bump the phase entry whenever that prompt's rendered content changes. */
export const PROMPT_VERSIONS = {
  plan: 1,
  work: 1,
  integrate: 2,
  verify: 1,
} as const;

/** StructuredTaskResult contract version the prompts are written against. */
export const RESULT_SCHEMA_VERSION = 1;

export interface PlanningPromptContext {
  /** Rendered run-context brief (renderManifestBrief); no absolute paths. */
  brief?: string;
}

export interface WorkerPromptContext {
  brief?: string;
  /** True when the assignment declares dependsOn participants. */
  hasDependencies?: boolean;
}

export interface IntegrationPromptContext {
  brief?: string;
  manifestHash?: string;
}

export interface VerificationPromptContext {
  brief?: string;
}

export function planningPrompt(
  run: Run,
  participants: RunParticipant[],
  context: PlanningPromptContext = {},
): string {
  const eligible = participants.filter((participant) => participant.role !== 'orchestrator');
  return [
    'You are the ADE run orchestrator. Plan only; do not edit files, run destructive commands, or commit.',
    `Run goal: ${run.goal}`,
    ...(context.brief ? [context.brief] : []),
    'Create worker-specific, non-overlapping assignments using only the participant IDs below.',
    'Use dependsOn only for genuine sequencing. Every assignment needs concrete acceptance criteria and verification.',
    'Dependent workers do NOT inherit upstream code: every worker starts from the same base commit in its own ' +
    'isolated worktree. dependsOn only orders execution and forwards the upstream structured result as ' +
    'information, so a dependent assignment must not assume upstream file changes exist in its worktree.',
    'Return one assignment per selected participant; do not assign the orchestrator.',
    'Eligible participants:',
    ...eligible.map((participant) =>
      `- ${participant.id} | ${participant.agentName.slice(0, 80)} | ${participant.role} | ` +
      `${(participant.teamName ?? 'unassigned').slice(0, 80)}`),
  ].join('\n');
}

export function workerPrompt(
  run: Run,
  assignment: StructuredTaskResult['assignments'][number],
  context: WorkerPromptContext = {},
): string {
  return [
    `Run goal: ${run.goal}`,
    ...(context.brief ? [context.brief] : []),
    `Your owned assignment: ${assignment.title}`,
    assignment.prompt,
    'Acceptance criteria:',
    ...assignment.acceptanceCriteria.map((criterion) => `- ${criterion}`),
    ...(context.hasDependencies
      ? [
          'Your assignment depends on other tasks. Their validated structured results are in TASK_CONTEXT.json ' +
          'inside your ADE task directory (ADE_TASK_DIR). You do NOT inherit their code changes: your worktree ' +
          'starts from the run base commit, so rely only on the reported results, not on their files.',
        ]
      : []),
    'Work only in your leased workspace. Inspect existing conventions before editing.',
    'Run focused verification and report the exact repository-relative paths you changed.',
    'Do not run git add, git commit, reset, checkout, rebase, merge, or push. Return commitSha=null; ADE validates the exact diff and creates the task commit.',
    'Do not claim tests passed unless you actually ran them. Report blockers as outcome=blocked.',
  ].join('\n');
}

export function integrationPrompt(
  run: Run,
  results: Array<StructuredTaskResult & { participantId?: string }>,
  applied: number,
  repoBacked: boolean,
  context: IntegrationPromptContext = {},
): string {
  const reports = results
    .map((result) => `- ${result.summary.slice(0, 500)} (commit ${result.commitSha ?? 'none'}; ` +
      `risks ${result.risks.join('; ').slice(0, 300) || 'none'}; ` +
      `tests ${result.tests.map((test) => test.status).join(', ') || 'none'})`)
    .join('\n')
    .slice(0, 18_000);
  return [
    `Run goal: ${run.goal}`,
    ...(context.brief ? [context.brief] : []),
    ...(context.manifestHash
      ? [`Run context manifest: ${context.manifestHash.slice(0, 16)} (full manifest in your TASK_CONTEXT.json).`]
      : []),
    repoBacked
      ? `ADE already cherry-picked ${applied} validated worker commit(s) into this integration worktree.`
      : 'This is a plain-workspace run; reconcile the worker reports without claiming git integration.',
    'Review the combined result for conflicts, missing behavior, security regressions, and consistency.',
    'Run relevant focused tests. Fix integration-only issues if needed.',
    'The worker commits are already part of HEAD before this task starts. In filesChanged, report ONLY the ' +
      'currently uncommitted paths created or modified by this integration review (the exact final git status path set). ' +
      'Do not repeat files that arrived in worker commits unless you modify them again during this task; use [] when the worktree stays clean.',
    'Do not run git add, git commit, reset, checkout, rebase, merge, or push.',
    'Return commitSha=null; ADE validates and commits any integration-only diff after you exit.',
    'Worker reports:',
    reports,
  ].join('\n');
}

export function verificationPrompt(
  run: Run,
  integration: StructuredTaskResult,
  context: VerificationPromptContext = {},
): string {
  return [
    `Run goal: ${run.goal}`,
    ...(context.brief ? [context.brief] : []),
    `Integration summary: ${integration.summary}`,
    'Verify the final integrated workspace. This phase is strictly read-only: do not edit or commit.',
    'Run the repository test/typecheck/build commands appropriate to the changed scope.',
    'Report every command and its real status. outcome must be failed if any required check fails.',
  ].join('\n');
}
