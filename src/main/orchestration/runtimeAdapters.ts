import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import type {
  Agent,
  RunTask,
  RunTaskTestResult,
  StructuredTaskResult,
  TaskUsage,
} from '../../shared/types';
import { resolveCodexExecCommand } from '../../shared/runtimes';

const RESULT_CAP_BYTES = 1024 * 1024;

export interface ManagedTaskFiles {
  taskDir: string;
  resultPath: string;
  schemaPath: string;
  inboxPath: string;
  outboxPath: string;
}

export interface ManagedTaskLaunch {
  adapterId: string;
  prompt: string;
  files: ManagedTaskFiles;
  env: Record<string, string>;
  /** Runtime-specific shell command. Undefined keeps PtyManager's generic transport. */
  command?: string;
  transport?: 'argument' | 'stdin';
  reportsTokens: boolean;
  reportsCost: boolean;
}

export interface RuntimeTaskAdapter {
  readonly id: string;
  supports(agent: Agent): boolean;
  capabilities(agent: Agent): { reportsTokens: boolean; reportsCost: boolean };
  prepare(
    agent: Agent,
    task: RunTask,
    prompt: string,
    files: ManagedTaskFiles,
    platform: 'win32' | 'posix',
  ): ManagedTaskLaunch;
  readResult(launch: ManagedTaskLaunch, terminalOutput: string): StructuredTaskResult;
}

export class RuntimeAdapterRegistry {
  private readonly adapters: RuntimeTaskAdapter[];

  constructor(adapters: RuntimeTaskAdapter[] = [new CodexJsonAdapter(), new FileResultAdapter()]) {
    this.adapters = adapters;
  }

  capabilities(agent: Agent): { adapterId: string; reportsTokens: boolean; reportsCost: boolean } {
    const adapter = this.adapters.find((candidate) => candidate.supports(agent));
    if (!adapter) throw new Error(`ade: no managed-task adapter for runtime "${agent.runtime}"`);
    return { adapterId: adapter.id, ...adapter.capabilities(agent) };
  }

  prepare(
    agent: Agent,
    task: RunTask,
    prompt: string,
    files: ManagedTaskFiles,
    platform: 'win32' | 'posix',
  ): ManagedTaskLaunch {
    const adapter = this.adapters.find((candidate) => candidate.supports(agent));
    if (!adapter) throw new Error(`ade: no managed-task adapter for runtime "${agent.runtime}"`);
    return adapter.prepare(agent, task, prompt, files, platform);
  }

  readResult(launch: ManagedTaskLaunch, terminalOutput: string): StructuredTaskResult {
    const adapter = this.adapters.find((candidate) => candidate.id === launch.adapterId);
    if (!adapter) throw new Error(`ade: runtime adapter disappeared "${launch.adapterId}"`);
    const result = adapter.readResult(launch, terminalOutput);
    if (!launch.reportsTokens) {
      result.usage.inputTokens = null;
      result.usage.outputTokens = null;
    }
    if (!launch.reportsCost) result.usage.costUsd = null;
    return result;
  }
}

/** Codex owns the result file and validates it against JSON Schema. */
export class CodexJsonAdapter implements RuntimeTaskAdapter {
  readonly id = 'codex-jsonl-v1';

  supports(agent: Agent): boolean {
    return agent.runtime === 'codex' && !agent.customCommand?.trim();
  }

  capabilities(): { reportsTokens: boolean; reportsCost: boolean } {
    return { reportsTokens: true, reportsCost: false };
  }

  prepare(
    agent: Agent,
    _task: RunTask,
    prompt: string,
    files: ManagedTaskFiles,
    platform: 'win32' | 'posix',
  ): ManagedTaskLaunch {
    prepareFiles(files);
    const base = resolveCodexExecCommand(agent.permissionMode);
    const envRef = (name: string): string => platform === 'win32' ? `"$env:${name}"` : `"$${name}"`;
    const command = [
      base,
      '--skip-git-repo-check',
      '--json',
      '--output-schema', envRef('ADE_TASK_SCHEMA_PATH'),
      '--output-last-message', envRef('ADE_TASK_RESULT_PATH'),
      '--add-dir', envRef('ADE_TASK_DIR'),
      '--', envRef('ADE_TASK_PROMPT'),
    ].join(' ');
    return {
      adapterId: this.id,
      prompt: appendResultContract(prompt, files, true),
      files,
      env: taskEnv(files),
      command,
      transport: 'argument',
      reportsTokens: true,
      reportsCost: false,
    };
  }

  readResult(launch: ManagedTaskLaunch, terminalOutput: string): StructuredTaskResult {
    const result = readStructuredResult(launch.files.resultPath);
    const usage = parseCodexUsage(terminalOutput);
    result.usage.inputTokens = null;
    result.usage.outputTokens = null;
    if (usage) {
      result.usage.inputTokens = usage.inputTokens;
      result.usage.outputTokens = usage.outputTokens;
    }
    // Codex CLI currently reports tokens, not monetary cost. Preserve unknown.
    result.usage.costUsd = null;
    return result;
  }
}

/** CLI-agnostic fallback: the agent/wrapper writes one schema-valid JSON file. */
export class FileResultAdapter implements RuntimeTaskAdapter {
  readonly id = 'file-mailbox-v1';

  supports(agent: Agent): boolean {
    return agent.runtime !== 'shell';
  }

  capabilities(agent: Agent): { reportsTokens: boolean; reportsCost: boolean } {
    const wrapperTelemetry = agent.runtime === 'custom';
    return { reportsTokens: wrapperTelemetry, reportsCost: wrapperTelemetry };
  }

  prepare(
    agent: Agent,
    _task: RunTask,
    prompt: string,
    files: ManagedTaskFiles,
  ): ManagedTaskLaunch {
    prepareFiles(files);
    return {
      adapterId: this.id,
      prompt: appendResultContract(prompt, files, false),
      files,
      env: taskEnv(files),
      reportsTokens: agent.runtime === 'custom',
      reportsCost: agent.runtime === 'custom',
    };
  }

  readResult(launch: ManagedTaskLaunch): StructuredTaskResult {
    return readStructuredResult(launch.files.resultPath);
  }
}

export const STRUCTURED_RESULT_SCHEMA = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  type: 'object',
  additionalProperties: false,
  required: ['version', 'outcome', 'summary', 'assignments', 'filesChanged', 'tests', 'commitSha', 'risks', 'usage'],
  properties: {
    version: { type: 'integer', enum: [1] },
    outcome: { type: 'string', enum: ['succeeded', 'failed', 'blocked'] },
    summary: { type: 'string' },
    assignments: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['participantId', 'title', 'prompt', 'acceptanceCriteria', 'dependsOn'],
        properties: {
          participantId: { type: 'string' },
          title: { type: 'string' },
          prompt: { type: 'string' },
          acceptanceCriteria: { type: 'array', items: { type: 'string' } },
          dependsOn: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    filesChanged: { type: 'array', items: { type: 'string' } },
    tests: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['command', 'status', 'output'],
        properties: {
          command: { type: 'string' },
          status: { type: 'string', enum: ['passed', 'failed', 'skipped'] },
          output: { type: 'string' },
        },
      },
    },
    commitSha: { type: ['string', 'null'] },
    risks: { type: 'array', items: { type: 'string' } },
    usage: {
      type: 'object',
      additionalProperties: false,
      required: ['inputTokens', 'outputTokens', 'costUsd'],
      properties: {
        inputTokens: { type: ['integer', 'null'], minimum: 0 },
        outputTokens: { type: ['integer', 'null'], minimum: 0 },
        costUsd: { type: ['number', 'null'], minimum: 0 },
      },
    },
  },
} as const;

function prepareFiles(files: ManagedTaskFiles): void {
  mkdirSync(files.taskDir, { recursive: true });
  writeFileSync(files.schemaPath, `${JSON.stringify(STRUCTURED_RESULT_SCHEMA, null, 2)}\n`, 'utf8');
}

function taskEnv(files: ManagedTaskFiles): Record<string, string> {
  return {
    ADE_TASK_DIR: files.taskDir,
    ADE_TASK_RESULT_PATH: files.resultPath,
    ADE_TASK_SCHEMA_PATH: files.schemaPath,
    ADE_MAILBOX_INBOX: files.inboxPath,
    ADE_MAILBOX_OUTBOX: files.outboxPath,
  };
}

function appendResultContract(prompt: string, files: ManagedTaskFiles, nativeOutput: boolean): string {
  return `${prompt}\n\n` +
    'ADE structured-result contract (required):\n' +
    `- Read task context from ${files.inboxPath}.\n` +
    `- The JSON Schema is ${files.schemaPath}.\n` +
    (nativeOutput
      ? '- Return only the final JSON object; ADE/Codex writes and validates the result file.\n'
      : `- Before exiting, write exactly one JSON object (no Markdown fences) to ${files.resultPath}.\n`) +
    '- Use empty arrays when a field has no entries and null when usage/cost or commitSha is unavailable.\n' +
    '- Do not report success unless the requested work and stated verification really completed.';
}

function readStructuredResult(path: string): StructuredTaskResult {
  if (!existsSync(path)) throw new Error(`ade: managed task did not produce result file ${path}`);
  const raw = readFileSync(path);
  if (raw.byteLength > RESULT_CAP_BYTES) throw new Error('ade: structured task result exceeds 1 MiB');
  let value: unknown;
  try {
    value = JSON.parse(raw.toString('utf8'));
  } catch (error) {
    throw new Error(`ade: structured task result is not valid JSON: ${errorMessage(error)}`);
  }
  return validateStructuredResult(value);
}

export function validateStructuredResult(value: unknown): StructuredTaskResult {
  const object = asObject(value, 'result');
  exactKeys(object, ['version', 'outcome', 'summary', 'assignments', 'filesChanged', 'tests', 'commitSha', 'risks', 'usage'], 'result');
  if (object.version !== 1) throw new Error('ade: result.version must be 1');
  if (object.outcome !== 'succeeded' && object.outcome !== 'failed' && object.outcome !== 'blocked') {
    throw new Error('ade: result.outcome is invalid');
  }
  const summary = boundedString(object.summary, 'result.summary', 12_000, false);
  const assignments = boundedArray(object.assignments, 'result.assignments', 128).map((item, index) => {
    const assignment = asObject(item, `result.assignments[${index}]`);
    exactKeys(assignment, ['participantId', 'title', 'prompt', 'acceptanceCriteria', 'dependsOn'], `result.assignments[${index}]`);
    const acceptanceCriteria = stringArray(
      assignment.acceptanceCriteria,
      `assignment[${index}].acceptanceCriteria`,
      16,
      500,
    );
    if (acceptanceCriteria.length === 0) {
      throw new Error(`ade: assignment[${index}] needs at least one acceptance criterion`);
    }
    return {
      participantId: boundedString(assignment.participantId, `assignment[${index}].participantId`, 512, false),
      title: boundedString(assignment.title, `assignment[${index}].title`, 160, false),
      prompt: boundedString(assignment.prompt, `assignment[${index}].prompt`, 8_000, false),
      acceptanceCriteria,
      dependsOn: stringArray(assignment.dependsOn, `assignment[${index}].dependsOn`, 128, 512),
    };
  });
  const filesChanged = stringArray(object.filesChanged, 'result.filesChanged', 2_000, 4_096);
  const tests = boundedArray(object.tests, 'result.tests', 100).map((item, index): RunTaskTestResult => {
    const test = asObject(item, `result.tests[${index}]`);
    exactKeys(test, ['command', 'status', 'output'], `result.tests[${index}]`);
    const status = test.status;
    if (status !== 'passed' && status !== 'failed' && status !== 'skipped') {
      throw new Error(`ade: result.tests[${index}].status is invalid`);
    }
    return {
      command: boundedString(test.command, `result.tests[${index}].command`, 4_096, false),
      status,
      output: boundedString(test.output, `result.tests[${index}].output`, 16_000, true),
    };
  });
  if (object.outcome === 'succeeded' && tests.some((test) => test.status === 'failed')) {
    throw new Error('ade: a succeeded result cannot contain failed tests');
  }
  let commitSha: string | null = null;
  if (object.commitSha !== null) {
    commitSha = boundedString(object.commitSha, 'result.commitSha', 64, false);
    if (!/^[a-fA-F0-9]{7,64}$/.test(commitSha)) throw new Error('ade: result.commitSha must be a hexadecimal commit id');
  }
  const risks = stringArray(object.risks, 'result.risks', 100, 2_000);
  const usageObject = asObject(object.usage, 'result.usage');
  exactKeys(usageObject, ['inputTokens', 'outputTokens', 'costUsd'], 'result.usage');
  const usage: TaskUsage = {
    inputTokens: nullableInteger(usageObject.inputTokens, 'result.usage.inputTokens'),
    outputTokens: nullableInteger(usageObject.outputTokens, 'result.usage.outputTokens'),
    costUsd: nullableNumber(usageObject.costUsd, 'result.usage.costUsd'),
  };
  return {
    version: 1,
    outcome: object.outcome,
    summary,
    assignments,
    filesChanged,
    tests,
    commitSha,
    risks,
    usage,
  };
}

function parseCodexUsage(output: string): { inputTokens: number; outputTokens: number } | null {
  const clean = output.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '');
  let found: { inputTokens: number; outputTokens: number } | null = null;
  for (const line of clean.split(/\r?\n/)) {
    if (!line.trim().startsWith('{')) continue;
    try {
      const event = JSON.parse(line) as {
        type?: string;
        usage?: { input_tokens?: unknown; output_tokens?: unknown };
      };
      if (event.type !== 'turn.completed' || !event.usage) continue;
      const inputTokens = event.usage.input_tokens;
      const outputTokens = event.usage.output_tokens;
      if (Number.isInteger(inputTokens) && Number.isInteger(outputTokens)) {
        found = { inputTokens: inputTokens as number, outputTokens: outputTokens as number };
      }
    } catch {
      // PTY output may contain ordinary log lines around JSONL events.
    }
  }
  if (found) return found;

  // ConPTY may visually wrap a long JSONL event, so the event is no longer a
  // parseable single line even though its bounded fields are intact. Search
  // only inside the final turn.completed event and require exact usage keys.
  const markers = [...clean.matchAll(/"type"\s*:\s*"turn\.completed"/g)];
  for (let index = markers.length - 1; index >= 0; index -= 1) {
    const offset = markers[index]?.index;
    if (offset === undefined) continue;
    const event = clean.slice(offset, offset + 4_096);
    const input = event.match(/"input_tokens"\s*:\s*(\d+)/)?.[1];
    const outputTokens = event.match(/"output_tokens"\s*:\s*(\d+)/)?.[1];
    if (input !== undefined && outputTokens !== undefined) {
      return { inputTokens: Number(input), outputTokens: Number(outputTokens) };
    }
  }
  return null;
}

function asObject(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`ade: ${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, keys: string[], label: string): void {
  const expected = new Set(keys);
  const extra = Object.keys(value).find((key) => !expected.has(key));
  const missing = keys.find((key) => !(key in value));
  if (extra) throw new Error(`ade: ${label} contains unknown field "${extra}"`);
  if (missing) throw new Error(`ade: ${label} is missing field "${missing}"`);
}

function boundedString(value: unknown, label: string, max: number, allowEmpty: boolean): string {
  if (typeof value !== 'string') throw new Error(`ade: ${label} must be a string`);
  if (value.includes('\0')) throw new Error(`ade: ${label} contains a null character`);
  if (!allowEmpty && !value.trim()) throw new Error(`ade: ${label} is required`);
  if (value.length > max) throw new Error(`ade: ${label} exceeds ${max} characters`);
  return value;
}

function boundedArray(value: unknown, label: string, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) throw new Error(`ade: ${label} must be an array of at most ${max} items`);
  return value;
}

function stringArray(value: unknown, label: string, maxItems: number, maxChars: number): string[] {
  return boundedArray(value, label, maxItems).map((item, index) =>
    boundedString(item, `${label}[${index}]`, maxChars, false));
}

function nullableInteger(value: unknown, label: string): number | null {
  if (value === null) return null;
  if (!Number.isInteger(value) || (value as number) < 0) throw new Error(`ade: ${label} must be null or a non-negative integer`);
  return value as number;
}

function nullableNumber(value: unknown, label: string): number | null {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`ade: ${label} must be null or a non-negative number`);
  }
  return value;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
