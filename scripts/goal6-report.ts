/**
 * Goal 6 measurement extractor (read-only).
 *
 * Reads an ADE config.json and prints per-run validation metrics for
 * docs/goal6/RESULTS.md: completion, phases reached, elapsed vs active time,
 * task outcomes, token/cost usage, integration attempts, conflict signals and
 * human interventions — all derived from the persisted run journal.
 *
 * Usage:
 *   pnpm goal6:report                        # list all runs
 *   pnpm goal6:report --run <id-or-text>     # detailed metrics for one run
 *   pnpm goal6:report --run <id> --md        # RESULTS.md table row
 *   pnpm goal6:report --run <id> --json      # raw metrics object
 *   pnpm goal6:report --config <path>        # non-default config location
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  AdeConfig,
  Run,
  RunApproval,
  RunEvent,
  RunTask,
} from '../src/shared/types';

interface RunMetrics {
  runId: string;
  name: string;
  goal: string;
  mode: Run['mode'];
  status: Run['status'];
  phase: Run['phase'];
  repository: string | null;
  participants: { role: string; runtime: string; name: string }[];
  createdAt: number;
  startedAt: number | null;
  endedAt: number | null;
  elapsedMs: number | null;
  approvalWaitMs: number;
  activeMs: number | null;
  phasesReached: string[];
  tasks: {
    total: number;
    completed: number;
    failed: number;
    cancelled: number;
    retries: number;
    byPhase: Record<string, number>;
  };
  usage: {
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    tasksWithoutCost: number;
    tasksWithoutTokens: number;
  };
  integrations: { count: number; commits: number };
  conflictSignals: string[];
  budgetExhaustions: string[];
  interventions: {
    manualApprovals: number;
    manualRejections: number;
    cancellations: number;
    pauses: number;
    resumes: number;
  };
  approvals: { requested: number; approved: number; rejected: number; autoRejected: number };
  leases: { branch: string; baseSha: string; status: string }[];
  messages: number;
  artifacts: number;
}

function defaultConfigPath(): string {
  const appData = process.env['APPDATA'];
  if (!appData) throw new Error('goal6-report: APPDATA is not set; pass --config <path>');
  return join(appData, 'ADE', 'ade', 'config.json');
}

function parseArgs(argv: string[]): { config: string; run: string | null; md: boolean; json: boolean } {
  let config = '';
  let run: string | null = null;
  let md = false;
  let json = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--config') config = argv[++i] ?? '';
    else if (arg === '--run') run = argv[++i] ?? null;
    else if (arg === '--md') md = true;
    else if (arg === '--json') json = true;
    else throw new Error(`goal6-report: unknown argument "${arg}"`);
  }
  return { config: config || defaultConfigPath(), run, md, json };
}

function loadConfig(path: string): AdeConfig {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (error) {
    throw new Error(`goal6-report: cannot read config at ${path} (${(error as Error).message})`);
  }
  return JSON.parse(raw) as AdeConfig;
}

function findRun(config: AdeConfig, query: string): Run {
  const exact = config.runs.find((run) => run.id === query);
  if (exact) return exact;
  const needle = query.toLowerCase();
  const matches = config.runs.filter((run) =>
    run.id.toLowerCase().includes(needle) ||
    run.name.toLowerCase().includes(needle) ||
    run.goal.toLowerCase().includes(needle));
  if (matches.length === 1) return matches[0];
  if (matches.length === 0) throw new Error(`goal6-report: no run matches "${query}"`);
  const listing = matches.map((run) => `  ${run.id}  ${run.name}`).join('\n');
  throw new Error(`goal6-report: "${query}" is ambiguous:\n${listing}`);
}

function formatDuration(ms: number | null): string {
  if (ms === null) return 'running';
  const totalSeconds = Math.round(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function collectMetrics(config: AdeConfig, run: Run): RunMetrics {
  const events: RunEvent[] = config.runEvents
    .filter((event) => event.runId === run.id)
    .sort((a, b) => a.seq - b.seq);
  const tasks: RunTask[] = config.runTasks.filter((task) => task.runId === run.id);
  const approvals: RunApproval[] = config.runApprovals.filter((approval) => approval.runId === run.id);
  const results = config.runTaskResults.filter((result) => result.runId === run.id);
  const participants = config.runParticipants.filter((participant) => participant.runId === run.id);
  const leases = config.runWorkspaceLeases.filter((lease) => lease.runId === run.id);

  const terminal = events.find((event) =>
    event.type === 'run.completed' || event.type === 'run.failed' || event.type === 'run.cancelled');
  const started = events.find((event) => event.type === 'run.started')
    ?? events.find((event) => event.type === 'run.phase_changed' && event.data?.['phase'] === 'planning');
  const startedAt = started?.createdAt ?? run.createdAt;
  const endedAt = terminal?.createdAt ?? null;
  const elapsedMs = endedAt === null && run.status === 'running' ? null : (endedAt ?? run.updatedAt) - startedAt;

  const now = Date.now();
  const approvalWaitMs = approvals.reduce((sum, approval) => {
    const resolved = approval.resolvedAt ?? endedAt ?? now;
    return sum + Math.max(0, resolved - approval.requestedAt);
  }, 0);

  const phasesReached: string[] = [];
  for (const event of events) {
    const phase = typeof event.data?.['phase'] === 'string' ? (event.data['phase'] as string) : null;
    if (phase && !phasesReached.includes(phase)) phasesReached.push(phase);
  }
  if (terminal) {
    const terminalPhase = terminal.type.replace('run.', '');
    if (!phasesReached.includes(terminalPhase)) phasesReached.push(terminalPhase);
  }

  const byPhase: Record<string, number> = {};
  let retries = 0;
  for (const task of tasks) {
    byPhase[task.phase] = (byPhase[task.phase] ?? 0) + 1;
    if (task.attempt > 1) retries += 1;
  }

  const usage = { inputTokens: 0, outputTokens: 0, costUsd: 0, tasksWithoutCost: 0, tasksWithoutTokens: 0 };
  for (const result of results) {
    if (result.usage.inputTokens === null && result.usage.outputTokens === null) usage.tasksWithoutTokens += 1;
    usage.inputTokens += result.usage.inputTokens ?? 0;
    usage.outputTokens += result.usage.outputTokens ?? 0;
    if (result.usage.costUsd === null) usage.tasksWithoutCost += 1;
    else usage.costUsd += result.usage.costUsd;
  }

  const integrationEvents = events.filter((event) => event.type === 'integration.applied');
  const commits = integrationEvents.reduce((sum, event) => {
    const count = event.data?.['commitCount'];
    return sum + (typeof count === 'number' ? count : 0);
  }, 0);

  const conflictSignals: string[] = [];
  for (const task of tasks) {
    if (task.status === 'failed' && (task.phase === 'integrate' || task.phase === 'verify')) {
      conflictSignals.push(`${task.phase} task failed: ${task.error ?? 'no error text'}`);
    }
  }
  for (const event of events) {
    if (event.type === 'run.failed' && typeof event.data?.['detail'] === 'string') {
      conflictSignals.push(`run.failed: ${event.data['detail'] as string}`);
    }
  }

  const budgetExhaustions = events
    .filter((event) => event.type === 'budget.exhausted')
    .map((event) => `${String(event.data?.['kind'] ?? 'unknown')} used=${String(event.data?.['used'] ?? '?')} limit=${String(event.data?.['limit'] ?? '?')}`);

  const interventions = { manualApprovals: 0, manualRejections: 0, cancellations: 0, pauses: 0, resumes: 0 };
  const approvalCounts = { requested: 0, approved: 0, rejected: 0, autoRejected: 0 };
  for (const event of events) {
    if (event.type === 'approval.requested') approvalCounts.requested += 1;
    if (event.type === 'approval.resolved') {
      const decision = event.data?.['decision'];
      const automatic = event.data?.['automatic'] === true;
      if (decision === 'approve') { approvalCounts.approved += 1; interventions.manualApprovals += 1; }
      else if (automatic) approvalCounts.autoRejected += 1;
      else { approvalCounts.rejected += 1; interventions.manualRejections += 1; }
    }
    if (event.type === 'run.cancelled') interventions.cancellations += 1;
    if (event.type === 'team.paused') interventions.pauses += 1;
    if (event.type === 'team.resumed') interventions.resumes += 1;
  }

  const repository = run.repositoryId
    ? config.repositories.find((repo) => repo.id === run.repositoryId)?.name ?? run.repositoryId
    : run.repositoryId === null ? 'plain workspace' : null;

  return {
    runId: run.id,
    name: run.name,
    goal: run.goal,
    mode: run.mode,
    status: run.status,
    phase: run.phase,
    repository,
    participants: participants.map((participant) => ({
      role: participant.role,
      runtime: participant.runtime,
      name: participant.agentName,
    })),
    createdAt: run.createdAt,
    startedAt,
    endedAt,
    elapsedMs,
    approvalWaitMs,
    activeMs: elapsedMs === null ? null : Math.max(0, elapsedMs - approvalWaitMs),
    phasesReached,
    tasks: {
      total: tasks.length,
      completed: tasks.filter((task) => task.status === 'completed').length,
      failed: tasks.filter((task) => task.status === 'failed').length,
      cancelled: tasks.filter((task) => task.status === 'cancelled').length,
      retries,
      byPhase,
    },
    usage,
    integrations: { count: integrationEvents.length, commits },
    conflictSignals,
    budgetExhaustions,
    interventions,
    approvals: approvalCounts,
    leases: leases.map((lease) => ({
      branch: lease.branch,
      baseSha: lease.baseSha.slice(0, 12),
      status: lease.status,
    })),
    messages: config.runMessages.filter((message) => message.runId === run.id).length,
    artifacts: config.runArtifacts.filter((artifact) => artifact.runId === run.id).length,
  };
}

function printRunList(config: AdeConfig): void {
  if (config.runs.length === 0) {
    console.log('No runs recorded in this config.');
    return;
  }
  const rows = [...config.runs]
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((run) => {
      const date = new Date(run.createdAt).toISOString().slice(0, 16).replace('T', ' ');
      return `${run.id}  ${date}  ${run.mode.padEnd(7)}  ${run.status.padEnd(9)}  ${run.phase.padEnd(11)}  ${run.name}`;
    });
  console.log(`run id${' '.repeat(30)}created (UTC)     mode     status     phase        name`);
  for (const row of rows) console.log(row);
}

function printMarkdownRow(m: RunMetrics): void {
  const tokens = m.usage.tasksWithoutTokens === m.tasks.total && m.tasks.total > 0
    ? 'unknown'
    : `${m.usage.inputTokens}/${m.usage.outputTokens}`;
  const cost = m.usage.tasksWithoutCost > 0
    ? `${m.usage.costUsd.toFixed(2)} (+${m.usage.tasksWithoutCost} unreported)`
    : m.usage.costUsd.toFixed(2);
  const conflicts = m.conflictSignals.length + m.budgetExhaustions.length;
  const interventionCount = m.interventions.manualApprovals + m.interventions.manualRejections
    + m.interventions.cancellations + m.interventions.pauses;
  const cells = [
    `\`${m.runId.slice(0, 8)}\` ${m.name}`,
    '_fixture_',
    '_arm_',
    new Date(m.createdAt).toISOString().slice(0, 10),
    `${m.status} (${m.phase})`,
    m.phasesReached.join('→') || '—',
    formatDuration(m.elapsedMs),
    formatDuration(m.activeMs),
    `${m.tasks.completed}/${m.tasks.failed}${m.tasks.retries ? ` (${m.tasks.retries} retries)` : ''}`,
    tokens,
    cost,
    `${m.integrations.count} (${m.integrations.commits})`,
    String(conflicts),
    String(interventionCount),
    '_gate_',
    '_notes_',
  ];
  console.log(`| ${cells.join(' | ')} |`);
}

function printDetails(m: RunMetrics): void {
  const lines = [
    `Run:            ${m.runId} — ${m.name}`,
    `Goal:           ${m.goal.length > 120 ? `${m.goal.slice(0, 120)}…` : m.goal}`,
    `Mode/status:    ${m.mode} · ${m.status} · phase ${m.phase}`,
    `Repository:     ${m.repository ?? 'legacy/default'}`,
    `Participants:   ${m.participants.map((p) => `${p.name} (${p.role}, ${p.runtime})`).join(', ') || '—'}`,
    `Phases reached: ${m.phasesReached.join(' → ') || '—'}`,
    `Elapsed:        ${formatDuration(m.elapsedMs)} (approval wait ${formatDuration(m.approvalWaitMs)}, active ${formatDuration(m.activeMs)})`,
    `Tasks:          ${m.tasks.total} total — ${m.tasks.completed} completed, ${m.tasks.failed} failed, ${m.tasks.cancelled} cancelled, ${m.tasks.retries} retries`,
    `  by phase:     ${Object.entries(m.tasks.byPhase).map(([phase, count]) => `${phase}=${count}`).join(' ') || '—'}`,
    `Usage:          in=${m.usage.inputTokens} out=${m.usage.outputTokens} cost=$${m.usage.costUsd.toFixed(2)}`
      + ` (no-cost tasks: ${m.usage.tasksWithoutCost}, no-token tasks: ${m.usage.tasksWithoutTokens})`,
    `Integrations:   ${m.integrations.count} applied, ${m.integrations.commits} commits`,
    `Approvals:      ${m.approvals.requested} requested — ${m.approvals.approved} approved, ${m.approvals.rejected} rejected, ${m.approvals.autoRejected} auto-rejected`,
    `Interventions:  approvals=${m.interventions.manualApprovals} rejections=${m.interventions.manualRejections}`
      + ` cancels=${m.interventions.cancellations} pauses=${m.interventions.pauses} resumes=${m.interventions.resumes}`,
    `Leases:         ${m.leases.map((lease) => `${lease.branch}@${lease.baseSha} (${lease.status})`).join(', ') || '—'}`,
    `Journal:        ${m.messages} messages, ${m.artifacts} artifacts`,
  ];
  if (m.conflictSignals.length) {
    lines.push('Conflict signals:');
    for (const signal of m.conflictSignals) lines.push(`  - ${signal}`);
  }
  if (m.budgetExhaustions.length) {
    lines.push('Budget exhaustions:');
    for (const item of m.budgetExhaustions) lines.push(`  - ${item}`);
  }
  console.log(lines.join('\n'));
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const config = loadConfig(args.config);
  if (!args.run) {
    printRunList(config);
    return;
  }
  const run = findRun(config, args.run);
  const metrics = collectMetrics(config, run);
  if (args.json) {
    console.log(JSON.stringify(metrics, null, 2));
    return;
  }
  if (args.md) {
    printMarkdownRow(metrics);
    return;
  }
  printDetails(metrics);
}

try {
  main();
} catch (error) {
  console.error((error as Error).message);
  process.exit(1);
}
