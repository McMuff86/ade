import { createHash } from 'node:crypto';
import { closeSync, fstatSync, lstatSync, openSync, readSync } from 'node:fs';
import { join } from 'node:path';
import type { Agent, MemorySettings } from '../../shared/types';
import { assertNoLinks } from '../repositories/pathDiscipline';
import { MAX_SNAPSHOT_CHARS, previewAgentInstructions, type AgentInstructionsSnapshot } from './agentInstructions';
import { buildMemoryBlock } from './inject';
import { DEFAULT_MEMORY_LIMIT, DEFAULT_USER_LIMIT, ENTRY_DELIMITER, MemoryStore, type MemoryTarget } from './MemoryStore';

const MAX_MEMORY_FILE_BYTES = 256 * 1024;
const hash = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');
const DEFAULT_SETTINGS: MemorySettings = { enabled: true, userProfileEnabled: true,
  memoryCharLimit: DEFAULT_MEMORY_LIMIT, userCharLimit: DEFAULT_USER_LIMIT };

export interface InteractiveProfileSnapshot extends AgentInstructionsSnapshot {
  /** Compare this with behaviorGet.revision; sha256 covers the complete launch
   * context including memory, which can change independently of the profile. */
  profileDigest: string;
}

/** Reuse MemoryStore's exact render/capacity format but never its filesystem read
 * path. All reads are completed and checked before constructing this renderer. */
class FrozenMemoryStore extends MemoryStore {
  constructor(directory: string, settings: MemorySettings, private readonly entries: Record<MemoryTarget, string[]>) {
    super(directory, { memoryLimit: settings.memoryCharLimit, userLimit: settings.userCharLimit });
  }
  override readEntries(target: MemoryTarget): string[] { return [...this.entries[target]]; }
}

function inspect(path: string): ReturnType<typeof lstatSync> | undefined {
  assertNoLinks(path);
  try {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > MAX_MEMORY_FILE_BYTES) {
      throw new Error('ade: Memory muss eine reguläre, unverknüpfte Datei bis 256 KiB sein.');
    }
    return stat;
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
}

/** Missing files are empty, never created. Read errors and races fail closed. */
function readMemory(path: string): string | null {
  const before = inspect(path);
  if (!before) return null;
  const fd = openSync(path, 'r');
  try {
    const opened = fstatSync(fd);
    if (!opened.isFile() || opened.nlink !== 1 || opened.size > MAX_MEMORY_FILE_BYTES
      || opened.dev !== before.dev || opened.ino !== before.ino) throw new Error('ade: Memory wurde beim Lesen geändert.');
    const bytes = Buffer.alloc(MAX_MEMORY_FILE_BYTES + 1); let length = 0;
    while (length < bytes.length) {
      const count = readSync(fd, bytes, length, bytes.length - length, null); if (!count) break; length += count;
    }
    if (length > MAX_MEMORY_FILE_BYTES) throw new Error('ade: Memory überschreitet 256 KiB.');
    const after = inspect(path);
    if (!after || after.dev !== opened.dev || after.ino !== opened.ino || after.size !== opened.size || after.mtimeMs !== opened.mtimeMs) {
      throw new Error('ade: Memory wurde beim Lesen geändert.');
    }
    try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, length)); }
    catch { throw new Error('ade: Memory enthält ungültige UTF-8-Zeichen.'); }
  } finally { closeSync(fd); }
}

function parseEntries(raw: string): string[] {
  return [...new Set(raw.split(ENTRY_DELIMITER).map((part) => part.trim()).filter(Boolean))];
}

/** Profile + optional MEMORY/USER + existing maintenance guidance, captured
 * outside repository files. This function performs no writes, even for new
 * identities; disabled sources are not opened or inspected. No silent clipping. */
export function buildInteractiveProfileSnapshot(agent: Agent, settings: MemorySettings = DEFAULT_SETTINGS): InteractiveProfileSnapshot {
  const profile = previewAgentInstructions(agent);
  if (!settings.enabled) return { ...profile, profileDigest: profile.sha256 };
  const entries: Record<MemoryTarget, string[]> = { memory: [], user: [] };
  const sources = [...profile.sources];
  for (const target of (settings.userProfileEnabled ? ['memory', 'user'] : ['memory']) as MemoryTarget[]) {
    const name = target === 'memory' ? 'MEMORY.md' : 'USER.md';
    const raw = readMemory(join(agent.memoryDir, name));
    if (raw === null) continue;
    entries[target] = parseEntries(raw);
    sources.push({ kind: 'memory', name, sha256: hash(raw), chars: raw.length });
  }
  const block = buildMemoryBlock(agent, new FrozenMemoryStore(agent.memoryDir, settings, entries), settings);
  const content = `${profile.content}\n\n${block}`;
  if (content.length > MAX_SNAPSHOT_CHARS) throw new Error('ade: Profil und Memory überschreiten zusammen 32000 Zeichen. Anweisungen oder Memory kürzen.');
  return { ...profile, profileDigest: profile.sha256, content, sha256: hash(content), chars: content.length, sources };
}
