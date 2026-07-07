/**
 * Memory injection — wire CLI agents to their Hermes-style memory.
 *
 * Claude Code auto-reads CLAUDE.md; Codex/OpenCode/Grok/Gemini read AGENTS.md.
 * On each session launch we regenerate a managed block, fenced by
 *   <!-- ADE:MEMORY:start --> … <!-- ADE:MEMORY:end -->
 * inside the agent's workspaceDir file(s). The block holds the rendered MEMORY
 * and USER blocks (capacity-aware headers) plus save-rules adapted for direct
 * file editing. Content outside the markers is preserved; the file is created
 * if missing. The v1 write path is the agent editing the two files directly —
 * so the block gives absolute paths and the § separator rule.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Agent, MemorySettings, RuntimeId } from '../../shared/types';
import { MemoryStore } from './MemoryStore';
import { createMemoryScaffold } from './scaffold';

const START_MARKER = '<!-- ADE:MEMORY:start -->';
const END_MARKER = '<!-- ADE:MEMORY:end -->';

const DEFAULT_SETTINGS: MemorySettings = {
  enabled: true,
  userProfileEnabled: true,
  memoryCharLimit: 2200,
  userCharLimit: 1375,
};

/**
 * Which agent-instruction file(s) each runtime reads. Claude → CLAUDE.md,
 * the AGENTS.md family for codex/opencode/grok/gemini, and both for the
 * generic runtimes (shell/ollama/custom) so memory shows up whatever CLI runs.
 */
function targetFiles(runtime: RuntimeId): string[] {
  switch (runtime) {
    case 'claude':
      return ['CLAUDE.md'];
    case 'codex':
    case 'opencode':
    case 'grok':
    case 'gemini':
      return ['AGENTS.md'];
    case 'shell':
    case 'ollama':
    case 'custom':
    default:
      return ['CLAUDE.md', 'AGENTS.md'];
  }
}

/** Regenerate the managed memory block in the agent's instruction file(s). */
export function injectMemoryBlock(agent: Agent, settings?: MemorySettings): void {
  const cfg = settings ?? DEFAULT_SETTINGS;
  if (!cfg.enabled) return;

  // Make sure the two memory files exist so the store renders a valid block.
  createMemoryScaffold(agent.memoryDir, { enabled: true });

  const store = new MemoryStore(agent.memoryDir, {
    memoryLimit: cfg.memoryCharLimit,
    userLimit: cfg.userCharLimit,
  });

  const block = buildBlock(agent, store, cfg);

  mkdirSync(agent.workspaceDir, { recursive: true });
  for (const file of targetFiles(agent.runtime)) {
    writeManagedBlock(join(agent.workspaceDir, file), block);
  }
}

/* --------------------------------------------------------------- block */

function buildBlock(agent: Agent, store: MemoryStore, cfg: MemorySettings): string {
  const memoryPath = store.filePath('memory');
  const userPath = store.filePath('user');

  const parts: string[] = [store.renderBlock('memory')];
  if (cfg.userProfileEnabled) {
    parts.push('', store.renderBlock('user'));
  }

  const instructions = cfg.userProfileEnabled
    ? [
        '',
        '--- How to maintain your memory ---',
        'You have a persistent, cross-session memory kept in two files. It is injected',
        'into every session (the blocks above), so keep entries compact and high-signal.',
        '',
        'EDIT DIRECTLY: maintain your memory by editing these files yourself —',
        `  MEMORY.md -> ${memoryPath}`,
        `  USER.md   -> ${userPath}`,
        'Entries are separated by a line containing only §. Keep each entry short.',
        '',
        'TARGETS: USER.md = who the user is (name, role, preferences, style).',
        "         MEMORY.md = your own notes (environment, conventions, tool quirks, lessons).",
        'USER.md is about the user; MEMORY.md is your own notes — do not mix them.',
        '',
        'WHEN: save proactively when the user states a preference, correction, or personal',
        'detail, or you learn a stable fact about their environment, conventions, or',
        'workflow. Priority: user preferences & corrections > environment facts >',
        'procedures. The best memory stops the user repeating themselves.',
        '',
        `HARD CAPS: MEMORY.md ${cfg.memoryCharLimit} chars, USER.md ${cfg.userCharLimit} chars.`,
        'If over the cap, consolidate: remove/shorten stale entries first, then add the new one.',
        '',
        'SKIP: trivial/obvious info, easily re-discovered facts, raw data dumps, task',
        'progress, completed-work logs, temporary TODO state. Reusable procedures belong',
        'in a skill, not memory.',
      ]
    : [
        '',
        '--- How to maintain your memory ---',
        'You have a persistent, cross-session memory kept in a file. It is injected into',
        'every session (the block above), so keep entries compact and high-signal.',
        '',
        'EDIT DIRECTLY: maintain your memory by editing this file yourself —',
        `  MEMORY.md -> ${memoryPath}`,
        'Entries are separated by a line containing only §. Keep each entry short.',
        '',
        'MEMORY.md = your own notes (environment, conventions, tool quirks, lessons).',
        '',
        'WHEN: save proactively when you learn a stable fact about the user, their',
        'environment, conventions, or workflow. Priority: user preferences & corrections >',
        'environment facts > procedures. The best memory stops the user repeating themselves.',
        '',
        `HARD CAP: MEMORY.md ${cfg.memoryCharLimit} chars.`,
        'If over the cap, consolidate: remove/shorten stale entries first, then add the new one.',
        '',
        'SKIP: trivial/obvious info, easily re-discovered facts, raw data dumps, task',
        'progress, completed-work logs, temporary TODO state. Reusable procedures belong',
        'in a skill, not memory.',
      ];

  // agent referenced for future per-agent tailoring; keeps the signature honest.
  void agent;

  return [START_MARKER, ...parts, ...instructions, END_MARKER].join('\n');
}

/* ------------------------------------------------------ file splicing */

/**
 * Replace the fenced block in `file` with `block`, preserving everything
 * outside the markers. Appends the block (with a separating blank line) when
 * the file has no markers yet; creates the file when missing.
 */
function writeManagedBlock(file: string, block: string): void {
  let existing = '';
  if (existsSync(file)) {
    try {
      existing = readFileSync(file, 'utf8');
    } catch {
      existing = '';
    }
  }

  const start = existing.indexOf(START_MARKER);
  const end = existing.indexOf(END_MARKER);

  let next: string;
  if (start !== -1 && end !== -1 && end > start) {
    const before = existing.slice(0, start);
    const after = existing.slice(end + END_MARKER.length);
    next = `${before}${block}${after}`;
  } else if (existing.trim().length === 0) {
    next = `${block}\n`;
  } else {
    const sep = existing.endsWith('\n') ? '\n' : '\n\n';
    next = `${existing}${sep}${block}\n`;
  }

  atomicWrite(file, next);
}

function atomicWrite(file: string, content: string): void {
  const dir = dirname(file);
  mkdirSync(dir, { recursive: true });
  const tmp = join(dir, `.${basename(file)}.${process.pid}.${Date.now()}.tmp`);
  writeFileSync(tmp, content, 'utf8');
  renameSync(tmp, file);
}

function basename(file: string): string {
  return file.split(/[\\/]/).pop() ?? 'file';
}
