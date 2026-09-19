import { t as translate } from "../../shared/i18n";
/**
 * Durable, role-aware AGENTS.md contract for one ADE identity.
 *
 * The authoritative file lives beside MEMORY.md/USER.md so it does not dirty a
 * leased repository. Interactive sessions receive the same managed role block
 * through memory injection; managed tasks receive a bounded read-only copy in
 * their task directory and an explicit prompt instruction to read it.
 */

import { createHash, randomUUID } from 'node:crypto';
import { closeSync, fstatSync, lstatSync, mkdirSync, openSync, readSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import type { Agent, RunParticipantRole, TeamRole } from '../../shared/types';
import { validateAgentBehaviorProfile } from '../../shared/agentProfile';
import { assertNoLinks } from '../repositories/pathDiscipline';

export const AGENT_INSTRUCTIONS_FILE = 'AGENTS.md';
export const AGENT_ROLE_START_MARKER = '<!-- ADE:AGENT_ROLE:start -->';
export const AGENT_ROLE_END_MARKER = '<!-- ADE:AGENT_ROLE:end -->';

export const MAX_SNAPSHOT_CHARS = 32_000;
const MAX_INSTRUCTION_FILE_BYTES = 256 * 1024;

export interface AgentInstructionSource {
  kind: 'identity' | 'instructions' | 'document' | 'memory';
  name: string;
  sha256: string;
  chars: number;
  id?: string;
}

export interface AgentInstructionsSnapshot {
  file: typeof AGENT_INSTRUCTIONS_FILE;
  content: string;
  sha256: string;
  chars: number;
  profileRevision: string | null;
  sources: AgentInstructionSource[];
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
  return buildSnapshot(agent, persisted, runRole);
}

/** Explicit profile preview: reads the identity contract without creating or updating it. */
export function previewAgentInstructions(agent: Agent, runRole?: RunParticipantRole): AgentInstructionsSnapshot {
  return buildSnapshot(agent, readText(join(agent.memoryDir, AGENT_INSTRUCTIONS_FILE)), runRole);
}

function buildSnapshot(agent: Agent, persisted: string, runRole?: RunParticipantRole): AgentInstructionsSnapshot {
  const roleAware = spliceManagedRole(persisted, buildAgentRoleBlock(agent, runRole ?? agent.teamRole));
  const profile = agent.profile === undefined ? undefined : validateAgentBehaviorProfile(agent.profile);
  const digest = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
  const sources: AgentInstructionSource[] = [{ kind: 'identity', name: AGENT_INSTRUCTIONS_FILE,
    sha256: digest(roleAware), chars: roleAware.length }];
  const parts = [roleAware];
  if (profile?.instructions) {
    parts.push('# ADE profile instructions', profile.instructions);
    sources.push({ kind: 'instructions', name: 'Profile instructions', sha256: digest(profile.instructions), chars: profile.instructions.length });
  }
  for (const document of profile?.documents ?? []) {
    parts.push(`# ADE profile document: ${document.name}`, document.text);
    sources.push({ kind: 'document', id: document.id, name: document.name, sha256: digest(document.text), chars: document.text.length });
  }
  const content = parts.join('\n\n');
  if (content.length > MAX_SNAPSHOT_CHARS) throw new Error(translate("ade: Effective agent instructions exceed 32,000 characters. Shorten profile or identity instructions."));
  return {
    file: AGENT_INSTRUCTIONS_FILE,
    content,
    sha256: createHash('sha256').update(content, 'utf8').digest('hex'),
    chars: content.length,
    profileRevision: profile ? digest(JSON.stringify(profile)) : null,
    sources,
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
    : agent.runtime === 'grok'
      ? `grok | model ${agent.grokModel ?? 'inherited'} | reasoning ${agent.grokReasoningEffort ?? 'inherited'} | permissions ${agent.permissionMode}`
      : agent.runtime === 'claude' ? `claude | model ${agent.claudeModel ?? 'inherited'} | permissions ${agent.permissionMode}`
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

function inspectFile(path: string): ReturnType<typeof lstatSync> | undefined {
  assertNoLinks(path);
  try {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > MAX_INSTRUCTION_FILE_BYTES) {
      throw new Error(translate("ade: Identity statements must be a regular, unlinked file up to 256 KiB."));
    }
    return stat;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

function readText(path: string): string {
  const before = inspectFile(path);
  if (!before) return '';
  const fd = openSync(path, 'r');
  try {
    const opened = fstatSync(fd);
    if (!opened.isFile() || opened.nlink !== 1 || opened.size > MAX_INSTRUCTION_FILE_BYTES
      || opened.dev !== before.dev || opened.ino !== before.ino) throw new Error(translate("ade: Identity instructions have been changed while reading."));
    // Bound reads even if an external writer grows the file after fstat.
    const bytes = Buffer.alloc(MAX_INSTRUCTION_FILE_BYTES + 1);
    let length = 0;
    while (length < bytes.length) {
      const count = readSync(fd, bytes, length, bytes.length - length, null);
      if (!count) break;
      length += count;
    }
    if (length > MAX_INSTRUCTION_FILE_BYTES) throw new Error(translate("ade: Identity instructions exceed 256 KiB."));
    const content = bytes.subarray(0, length).toString('utf8');
    const after = inspectFile(path);
    if (!after || after.dev !== opened.dev || after.ino !== opened.ino || after.size !== opened.size
      || after.mtimeMs !== opened.mtimeMs || Buffer.byteLength(content, 'utf8') > MAX_INSTRUCTION_FILE_BYTES) {
      throw new Error(translate("ade: Identity instructions have been changed while reading."));
    }
    return content;
  } finally { closeSync(fd); }
}

function atomicWrite(path: string, content: string): void {
  if (Buffer.byteLength(content, 'utf8') > MAX_INSTRUCTION_FILE_BYTES) throw new Error(translate("ade: Identity instructions exceed 256 KiB."));
  inspectFile(path);
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true });
  assertNoLinks(dir);
  const tmp = join(dir, `.${basename(path)}.${randomUUID()}.tmp`);
  let created = false;
  try {
    const fd = openSync(tmp, 'wx', 0o600); created = true;
    try { writeFileSync(fd, content, 'utf8'); } finally { closeSync(fd); }
    inspectFile(path);
    renameSync(tmp, path); created = false;
  } finally { if (created) unlinkSync(tmp); }
}
