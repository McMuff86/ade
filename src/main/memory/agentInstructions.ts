/**
 * Durable, role-aware AGENTS.md contract for one ADE identity.
 *
 * The authoritative file lives beside MEMORY.md/USER.md so it does not dirty a
 * leased repository. Interactive sessions receive the same managed role block
 * through memory injection; managed tasks receive a bounded read-only copy in
 * their task directory and an explicit prompt instruction to read it.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import type { Agent, RunParticipantRole, TeamRole } from '../../shared/types';

export const AGENT_INSTRUCTIONS_FILE = 'AGENTS.md';
export const AGENT_ROLE_START_MARKER = '<!-- ADE:AGENT_ROLE:start -->';
export const AGENT_ROLE_END_MARKER = '<!-- ADE:AGENT_ROLE:end -->';

const MAX_SNAPSHOT_CHARS = 32_000;

export interface AgentInstructionsSnapshot {
  file: typeof AGENT_INSTRUCTIONS_FILE;
  content: string;
  sha256: string;
  chars: number;
}

/** Ensure the persistent AGENTS.md exists and its ADE-owned role block is current. */
export function syncAgentInstructions(agent: Agent): string {
  const path = join(agent.memoryDir, AGENT_INSTRUCTIONS_FILE);
  const existing = readText(path);
  const content = spliceManagedRole(existing, buildAgentRoleBlock(agent, agent.teamRole));
  if (content !== existing) atomicWrite(path, content);
  return content;
}

/**
 * Build the bounded task copy. The run participant role overrides the identity
 * default because the same saved identity can intentionally fill another role
 * in a particular run.
 */
export function snapshotAgentInstructions(
  agent: Agent,
  runRole?: RunParticipantRole,
): AgentInstructionsSnapshot {
  const persisted = syncAgentInstructions(agent);
  const roleAware = runRole
    ? spliceManagedRole(persisted, buildAgentRoleBlock(agent, runRole))
    : persisted;
  const content = clipSnapshot(roleAware);
  return {
    file: AGENT_INSTRUCTIONS_FILE,
    content,
    sha256: createHash('sha256').update(content, 'utf8').digest('hex'),
    chars: content.length,
  };
}

/** ADE-owned section injected into interactive instruction files too. */
export function buildAgentRoleBlock(
  agent: Agent,
  role: TeamRole | RunParticipantRole | undefined = agent.teamRole,
): string {
  const identityRole = inline(agent.role);
  const runtime = agent.runtime === 'codex'
    ? `codex | model ${agent.codexModel ?? 'inherited'} | reasoning ${agent.codexReasoningEffort ?? 'inherited'} | permissions ${agent.permissionMode}`
    : `${agent.runtime} | permissions ${agent.permissionMode}`;
  const responsibilities = roleResponsibilities(role);

  return [
    AGENT_ROLE_START_MARKER,
    '# ADE agent role contract',
    '',
    `- Identity: ${inline(agent.name)}`,
    `- Orchestration role: ${roleLabel(role)}`,
    ...(identityRole ? [`- Specialty: ${identityRole}`] : []),
    `- Runtime profile: ${runtime}`,
    '',
    '## Role responsibilities',
    '',
    ...responsibilities.map((line) => `- ${line}`),
    '',
    '## Engineering contract',
    '',
    '- Read the task contract and the repository’s nearest AGENTS.md before acting. Repository and task instructions take precedence over this identity profile.',
    '- Work only in the assigned workspace and scope. Do not touch unrelated user changes or broaden the task without authorization.',
    '- Keep implementation, tests, architecture notes, status, roadmap, and handoff documentation consistent whenever behavior or supported workflows change.',
    '- Run the narrowest useful checks while iterating, then every required unit, integration, security, build, and UI/browser check before claiming completion.',
    '- Report test evidence honestly. Expected-failure negative controls are evidence, not product failures; never hide a real failing check.',
    '- If the managed task says ADE owns Git metadata, do not add, commit, reset, checkout, rebase, merge, or push.',
    '- Return the exact structured result requested by ADE, including changed paths, commands, outcomes, risks, and blockers.',
    AGENT_ROLE_END_MARKER,
    '',
  ].join('\n');
}

function roleResponsibilities(role: TeamRole | RunParticipantRole | undefined): string[] {
  switch (role) {
    case 'orchestrator':
      return [
        'Own decomposition, dependency ordering, acceptance criteria, risk control, and the final evidence-backed verdict.',
        'Delegate bounded implementation and verification assignments; keep independent verification independent.',
        'Do not claim integration or completion until worker results, repository state, and required checks agree.',
      ];
    case 'lead':
      return [
        'Own the assigned team outcome and coordinate only the dependencies explicitly present in the run.',
        'Implement or review the assigned slice without duplicating another participant’s ownership.',
        'Return reproducible evidence that lets the orchestrator validate and integrate the result.',
      ];
    case 'worker':
      return [
        'Implement or verify only the owned assignment and its stated acceptance criteria.',
        'Inspect existing conventions before editing and preserve unrelated work.',
        'Escalate exact blockers and uncertainty instead of guessing or claiming partial work as complete.',
      ];
    default:
      return [
        'Own the requested task end to end within its stated scope.',
        'Inspect existing conventions before editing and preserve unrelated work.',
        'Escalate exact blockers and uncertainty instead of guessing.',
      ];
  }
}

function roleLabel(role: TeamRole | RunParticipantRole | undefined): string {
  switch (role) {
    case 'orchestrator': return 'main orchestrator';
    case 'lead': return 'team lead';
    case 'worker': return 'worker';
    default: return 'individual contributor';
  }
}

function inline(value: string | undefined): string {
  return (value ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
}

function spliceManagedRole(existing: string, block: string): string {
  const start = existing.indexOf(AGENT_ROLE_START_MARKER);
  const end = existing.indexOf(AGENT_ROLE_END_MARKER);
  if (start !== -1 && end !== -1 && end > start) {
    const after = end + AGENT_ROLE_END_MARKER.length;
    return `${existing.slice(0, start)}${block.trimEnd()}${existing.slice(after)}`;
  }
  if (!existing.trim()) return block;
  return `${block.trimEnd()}\n\n${existing.trimStart()}`;
}

function clipSnapshot(content: string): string {
  if (content.length <= MAX_SNAPSHOT_CHARS) return content;
  const marker = `\n\n[ADE: AGENTS.md snapshot truncated from ${content.length} characters]\n`;
  return `${content.slice(0, MAX_SNAPSHOT_CHARS - marker.length)}${marker}`;
}

function readText(path: string): string {
  if (!existsSync(path)) return '';
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
}

function atomicWrite(path: string, content: string): void {
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true });
  const tmp = join(dir, `.${basename(path)}.${process.pid}.${Date.now()}.tmp`);
  writeFileSync(tmp, content, 'utf8');
  renameSync(tmp, path);
}
