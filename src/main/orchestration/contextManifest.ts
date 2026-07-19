/**
 * Run context manifest + task context packets (P0a).
 *
 * The manifest is a deterministic, machine-built repository/run brief that is
 * journaled as a run artifact and referenced (by hash) from every managed
 * task's provenance. It is deliberately PATH-FREE: repositories are identified
 * by catalog id/name/branch/base SHA, instruction files by repo-relative name
 * plus content digest. That keeps the manifest safe for prompts today and for
 * the sanitized mobile DTOs of Goal 7 without a second projection.
 *
 * Building reads the orchestrator's leased worktree strictly read-only and
 * with hard bounds; the leased worktree is never mutated.
 */

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { RunTask, TaskProvenance } from '../../shared/types';
import { PROMPT_VERSIONS, RESULT_SCHEMA_VERSION } from './prompts';

export const CONTEXT_BUILDER_VERSION = 2;
export const RUN_CONTEXT_MANIFEST_PATH = 'context/run-manifest.json';

const INSTRUCTION_FILE_NAMES = ['CLAUDE.md', 'AGENTS.md'] as const;
const SCRIPT_WHITELIST = ['test', 'typecheck', 'build', 'lint', 'verify', 'dev', 'start'] as const;
const MAX_INSTRUCTION_EXCERPT_CHARS = 1_500;
const MAX_INSTRUCTION_FILE_BYTES = 512 * 1024;
const MAX_SCRIPT_CHARS = 240;
const MAX_TOP_LEVEL_ENTRIES = 40;
const MAX_BRIEF_CHARS = 6_000;
const MAX_DEPENDENCY_ENTRIES = 16;
// Matches the validated result.summary cap: a dependent task is promised the
// upstream report, so forwarding must not silently cut it (observed on F5v2:
// a 2k cut destroyed the embedded file blocks D3 depended on).
const MAX_DEPENDENCY_SUMMARY_CHARS = 12_000;
const MAX_DEPENDENCY_FILES = 200;
const MAX_DEPENDENCY_TESTS = 20;
const MAX_DEPENDENCY_RISKS = 10;
const MAX_DEPENDENCY_RISK_CHARS = 2_000;

/** Any cut is visible to the reader instead of silently corrupting content. */
function clipped(text: string, max: number): string {
  if (text.length <= max) return text;
  const marker = ` … [ADE: truncated, ${text.length} chars total]`;
  return `${text.slice(0, Math.max(0, max - marker.length))}${marker}`;
}

export interface ManifestInstructionFile {
  /** Repo-relative file name; never an absolute host path. */
  path: string;
  sha256: string;
  chars: number;
  excerpt: string;
}

export interface ManifestParticipant {
  participantId: string;
  agentName: string;
  role: string;
  teamName?: string;
  runtime: string;
  permissionMode: string;
  modelId?: string;
  reasoningEffort?: string;
  adapterId: string;
  reportsTokens: boolean;
  reportsCost: boolean;
}

export interface RunContextManifest {
  version: 1;
  contextBuilderVersion: number;
  runId: string;
  runName: string;
  goal: string;
  repository: {
    repositoryId: string | null;
    name: string | null;
    isRepo: boolean;
    branch: string;
    baseSha: string;
  } | null;
  instructionFiles: ManifestInstructionFile[];
  packageScripts: Record<string, string>;
  topLevelEntries: string[];
  participants: ManifestParticipant[];
  versions: {
    prompts: typeof PROMPT_VERSIONS;
    resultSchema: number;
    contextBuilder: number;
  };
}

export interface BuildManifestInput {
  run: { id: string; name: string; goal: string };
  repository: RunContextManifest['repository'];
  participants: ManifestParticipant[];
  /** Orchestrator's leased workspace root; scanned read-only. */
  scanRoot?: string;
}

export function buildRunContextManifest(input: BuildManifestInput): RunContextManifest {
  return {
    version: 1,
    contextBuilderVersion: CONTEXT_BUILDER_VERSION,
    runId: input.run.id,
    runName: input.run.name,
    goal: input.run.goal,
    repository: input.repository,
    instructionFiles: input.scanRoot ? scanInstructionFiles(input.scanRoot) : [],
    packageScripts: input.scanRoot ? scanPackageScripts(input.scanRoot) : {},
    topLevelEntries: input.scanRoot ? scanTopLevel(input.scanRoot) : [],
    participants: input.participants,
    versions: {
      prompts: PROMPT_VERSIONS,
      resultSchema: RESULT_SCHEMA_VERSION,
      contextBuilder: CONTEXT_BUILDER_VERSION,
    },
  };
}

export function manifestHash(manifest: RunContextManifest): string {
  return sha256(stableStringify(manifest));
}

/**
 * Parse a journaled manifest without trusting persisted JSON blindly. Invalid
 * or incompatible artifacts degrade to no restored context at the caller.
 */
export function parseRunContextManifest(content: string, expectedRunId: string): RunContextManifest | null {
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    return null;
  }
  if (!isRecord(value) ||
      value.version !== 1 ||
      value.contextBuilderVersion !== CONTEXT_BUILDER_VERSION ||
      value.runId !== expectedRunId ||
      typeof value.runName !== 'string' ||
      typeof value.goal !== 'string' ||
      !isRepository(value.repository) ||
      !Array.isArray(value.instructionFiles) ||
      !value.instructionFiles.every(isInstructionFile) ||
      !isStringRecord(value.packageScripts) ||
      !Array.isArray(value.topLevelEntries) ||
      !value.topLevelEntries.every((entry) => typeof entry === 'string' && !entry.includes('/') && !entry.includes('\\')) ||
      !Array.isArray(value.participants) ||
      !value.participants.every(isManifestParticipant) ||
      !isManifestVersions(value.versions)) {
    return null;
  }
  return value as unknown as RunContextManifest;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRepository(value: unknown): boolean {
  return value === null || (isRecord(value) &&
    (typeof value.repositoryId === 'string' || value.repositoryId === null) &&
    (typeof value.name === 'string' || value.name === null) &&
    typeof value.isRepo === 'boolean' &&
    typeof value.branch === 'string' &&
    typeof value.baseSha === 'string');
}

function isInstructionFile(value: unknown): boolean {
  return isRecord(value) &&
    (value.path === 'CLAUDE.md' || value.path === 'AGENTS.md') &&
    typeof value.sha256 === 'string' && /^[0-9a-f]{64}$/.test(value.sha256) &&
    Number.isInteger(value.chars) && Number(value.chars) >= 0 &&
    typeof value.excerpt === 'string';
}

function isManifestParticipant(value: unknown): boolean {
  return isRecord(value) &&
    typeof value.participantId === 'string' &&
    typeof value.agentName === 'string' &&
    typeof value.role === 'string' &&
    (value.teamName === undefined || typeof value.teamName === 'string') &&
    typeof value.runtime === 'string' &&
    typeof value.permissionMode === 'string' &&
    (value.modelId === undefined || typeof value.modelId === 'string') &&
    (value.reasoningEffort === undefined || typeof value.reasoningEffort === 'string') &&
    typeof value.adapterId === 'string' &&
    typeof value.reportsTokens === 'boolean' &&
    typeof value.reportsCost === 'boolean';
}

function isStringRecord(value: unknown): boolean {
  return isRecord(value) && Object.values(value).every((item) => typeof item === 'string');
}

function isManifestVersions(value: unknown): boolean {
  if (!isRecord(value) || !isRecord(value.prompts)) return false;
  const prompts = value.prompts;
  return value.contextBuilder === CONTEXT_BUILDER_VERSION &&
    value.resultSchema === RESULT_SCHEMA_VERSION &&
    Object.keys(prompts).length === Object.keys(PROMPT_VERSIONS).length &&
    Object.entries(PROMPT_VERSIONS).every(([phase, version]) => prompts[phase] === version);
}

/** JSON with recursively sorted object keys, so equal content hashes equally. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value), null, 2);
}

/**
 * Prompt-safe rendering of the manifest. Contains repo-relative names and
 * digests only — asserting "no absolute host paths" is part of the prompt
 * snapshot tests.
 */
export function renderManifestBrief(manifest: RunContextManifest, hash: string): string {
  const lines: string[] = [
    `Run context (manifest ${hash.slice(0, 16)}, context builder v${manifest.contextBuilderVersion}):`,
  ];
  if (manifest.repository?.isRepo) {
    lines.push(
      `- Repository: ${manifest.repository.name ?? 'unnamed'} | branch ${manifest.repository.branch} | ` +
      `base ${manifest.repository.baseSha.slice(0, 12)}`,
    );
  } else {
    lines.push('- Repository: none (plain workspaces; no git integration for this run)');
  }
  lines.push(manifest.instructionFiles.length > 0
    ? `- Instruction files (authoritative, read them first): ${manifest.instructionFiles
        .map((file) => `${file.path} (sha256 ${file.sha256.slice(0, 12)}, ${file.chars} chars)`)
        .join(', ')}`
    : '- Instruction files: none found at the workspace root');
  const scripts = Object.entries(manifest.packageScripts);
  lines.push(scripts.length > 0
    ? `- Package scripts: ${scripts.map(([name, command]) => `${name}: "${command}"`).join('; ')}`
    : '- Package scripts: none detected');
  if (manifest.topLevelEntries.length > 0) {
    lines.push(`- Top-level entries: ${manifest.topLevelEntries.join(', ')}`);
  }
  lines.push('- Participants:');
  for (const participant of manifest.participants) {
    lines.push(
      `  - ${participant.participantId} | ${participant.agentName} | ${participant.role}` +
      `${participant.teamName ? ` | team ${participant.teamName}` : ''} | ${participant.runtime} | ` +
      `${participant.modelId ? `model ${participant.modelId} | ` : ''}` +
      `${participant.reasoningEffort ? `reasoning ${participant.reasoningEffort} | ` : ''}` +
      `adapter ${participant.adapterId} | tokens ${participant.reportsTokens ? 'yes' : 'no'} | ` +
      `cost ${participant.reportsCost ? 'yes' : 'no'}`,
    );
  }
  return lines.join('\n').slice(0, MAX_BRIEF_CHARS);
}

/* ------------------------------------------------------ task packets */

export interface TaskDependencyResult {
  participantId: string;
  taskId: string;
  summary: string;
  filesChanged: string[];
  commitSha: string | null;
  tests: Array<{ command: string; status: string }>;
  risks: string[];
}

export interface TaskContextPacket {
  version: 1;
  runId: string;
  taskId: string;
  phase: string;
  title: string;
  dependsOn: string[];
  manifestHash: string | null;
  provenance: TaskProvenance;
  /** Structured results of upstream dependsOn tasks (information transfer). */
  dependencies: TaskDependencyResult[];
  /** Read-only, role-aware AGENTS.md copied outside the leased repository. */
  agentInstructions?: { file: 'AGENTS.md'; sha256: string; chars: number };
  memorySnapshot?: { file: string; sha256: string; chars: number };
}

export interface BuildPacketInput {
  task: Pick<RunTask, 'id' | 'runId' | 'phase' | 'title' | 'dependsOn'>;
  manifestHash: string | null;
  provenance: TaskProvenance;
  dependencyResults: Array<{
    participantId: string;
    taskId: string;
    summary: string;
    filesChanged: string[];
    commitSha: string | null;
    tests: Array<{ command: string; status: string }>;
    risks: string[];
  }>;
  agentInstructions?: { file: 'AGENTS.md'; sha256: string; chars: number };
  memorySnapshot?: { file: string; sha256: string; chars: number };
}

export function buildTaskContextPacket(input: BuildPacketInput): TaskContextPacket {
  return {
    version: 1,
    runId: input.task.runId,
    taskId: input.task.id,
    phase: input.task.phase,
    title: input.task.title,
    dependsOn: [...input.task.dependsOn],
    manifestHash: input.manifestHash,
    provenance: input.provenance,
    dependencies: input.dependencyResults.slice(0, MAX_DEPENDENCY_ENTRIES).map((result) => ({
      participantId: result.participantId,
      taskId: result.taskId,
      summary: clipped(result.summary, MAX_DEPENDENCY_SUMMARY_CHARS),
      filesChanged: result.filesChanged.slice(0, MAX_DEPENDENCY_FILES),
      commitSha: result.commitSha,
      tests: result.tests.slice(0, MAX_DEPENDENCY_TESTS).map((test) => ({
        command: test.command.slice(0, 240),
        status: test.status,
      })),
      risks: result.risks.slice(0, MAX_DEPENDENCY_RISKS)
        .map((risk) => clipped(risk, MAX_DEPENDENCY_RISK_CHARS)),
    })),
    ...(input.agentInstructions ? { agentInstructions: input.agentInstructions } : {}),
    ...(input.memorySnapshot ? { memorySnapshot: input.memorySnapshot } : {}),
  };
}

export function sha256(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

/* ------------------------------------------------------ read-only scans */

function scanInstructionFiles(root: string): ManifestInstructionFile[] {
  const files: ManifestInstructionFile[] = [];
  for (const name of INSTRUCTION_FILE_NAMES) {
    try {
      const raw = readFileSync(join(root, name));
      if (raw.byteLength > MAX_INSTRUCTION_FILE_BYTES) continue;
      const content = raw.toString('utf8');
      files.push({
        path: name,
        sha256: sha256(content),
        chars: content.length,
        excerpt: content.slice(0, MAX_INSTRUCTION_EXCERPT_CHARS),
      });
    } catch {
      // Missing instruction file is a normal state, not an error.
    }
  }
  return files;
}

function scanPackageScripts(root: string): Record<string, string> {
  try {
    const parsed = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
      scripts?: Record<string, unknown>;
    };
    const scripts: Record<string, string> = {};
    for (const name of SCRIPT_WHITELIST) {
      const command = parsed.scripts?.[name];
      if (typeof command === 'string' && command.trim()) {
        scripts[name] = command.slice(0, MAX_SCRIPT_CHARS);
      }
    }
    return scripts;
  } catch {
    return {};
  }
}

function scanTopLevel(root: string): string[] {
  try {
    return readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.name !== 'node_modules' && entry.name !== '.git')
      .sort((left, right) => left.name.localeCompare(right.name))
      .slice(0, MAX_TOP_LEVEL_ENTRIES)
      .map((entry) => (entry.isDirectory() ? `${entry.name}/` : entry.name));
  } catch {
    return [];
  }
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right));
    return Object.fromEntries(entries.map(([key, item]) => [key, sortValue(item)]));
  }
  return value;
}
