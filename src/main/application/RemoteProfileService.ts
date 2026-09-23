import { t as translate } from "../../shared/i18n";
import { closeSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DEFAULT_CODEX_MODEL, DEFAULT_CODEX_REASONING_EFFORT, type AdeConfig, type Agent, type CodexReasoningEffort, type PermissionMode } from '../../shared/types';
import type { MobileAgentProfile, MobileAgentSummary, MobileProfileQuery, MobileProfileUpdate } from '../../shared/remote';
import { CLAUDE_MODEL_PATTERN, CODEX_MODEL_PATTERN, LAUNCH_PROFILES } from '../../shared/runtimes';
import type { RuntimeModelCatalog } from '../../shared/runtimeModels';
import { assertNoLinks } from '../repositories/pathDiscipline';
import { redactForWire } from '../errors';
import { RemoteApiError } from './AdeApplicationService';
import { workbenchDigest } from './RemoteWorkbenchService';
import { syncAgentInstructions } from '../memory/agentInstructions';

const PHOTO_BYTES = 32 * 1024;
const fail = (message: string): never => { throw new RemoteApiError(422, 'command_rejected', message); };
const invalid = (): never => { throw new RemoteApiError(400, 'invalid_payload'); };
const REASONING_EFFORTS: ReadonlySet<string> = new Set(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra']);
const PERMISSION_MODES: readonly PermissionMode[] = ['default', 'accept-edits', 'bypass'];
/** Tablet profile read: the agent id plus an optional request for the PC's model catalog. */
export function validateProfileRequest(value: unknown): MobileProfileQuery {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some((key) => key !== 'agentId' && key !== 'models')) invalid();
  const input = value as Record<string, unknown>; const agentId = validateProfileQuery({ agentId: input.agentId });
  if (input.models !== undefined && input.models !== true) invalid();
  return input.models === true ? { agentId, models: true } : { agentId };
}
export function validateProfileQuery(value: unknown): string {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some((key) => key !== 'agentId')) invalid();
  const id = (value as { agentId: unknown }).agentId;
  if (typeof id !== 'string' || !/^[A-Za-z0-9_.:-]{1,128}$/.test(id)) invalid(); return id as string;
}
export function validateProfileUpdate(value: unknown): MobileProfileUpdate {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  const input = value as Record<string, unknown>;
  validateProfileQuery({ agentId: input.agentId });
  if (Object.keys(input).some((key) => !['agentId', 'revision', 'name', 'role', 'photo', 'codexModel', 'codexReasoningEffort', 'claudeModel', 'permissionMode'].includes(key))
    || typeof input.revision !== 'string' || !/^[a-f0-9]{64}$/.test(input.revision)
    || typeof input.name !== 'string' || !input.name.trim() || input.name.length > 80 || typeof input.role !== 'string' || input.role.length > 160
    || [input.name, input.role].some((text) => /[\x00-\x1f\x7f]/.test(text as string) || redactForWire(text as string, 200) !== text)) invalid();
  if (input.photo !== undefined && input.photo !== null) {
    const photo = input.photo as Record<string, unknown>;
    if (typeof photo !== 'object' || Array.isArray(photo) || Object.keys(photo).some((key) => key !== 'bytesBase64')
      || typeof photo.bytesBase64 !== 'string' || photo.bytesBase64.length > 44 * 1024 || !/^[A-Za-z0-9+/]+={0,2}$/.test(photo.bytesBase64)) invalid();
    const bytes = Buffer.from(photo.bytesBase64 as string, 'base64');
    if (bytes.toString('base64') !== photo.bytesBase64) invalid(); validateAvatarPng(bytes);
  }
  if (input.codexModel !== undefined && (typeof input.codexModel !== 'string' || !CODEX_MODEL_PATTERN.test(input.codexModel) || redactForWire(input.codexModel, 120) !== input.codexModel)) invalid();
  if (input.codexReasoningEffort !== undefined && (typeof input.codexReasoningEffort !== 'string' || !REASONING_EFFORTS.has(input.codexReasoningEffort))) invalid();
  if (input.claudeModel !== undefined && (typeof input.claudeModel !== 'string' || input.claudeModel !== '' && (!CLAUDE_MODEL_PATTERN.test(input.claudeModel) || redactForWire(input.claudeModel, 120) !== input.claudeModel))) invalid();
  if (input.permissionMode !== undefined && !(PERMISSION_MODES as readonly unknown[]).includes(input.permissionMode)) invalid();
  return input as unknown as MobileProfileUpdate;
}

/** Bound PNG dimensions and decompression before handing bytes to the native image decoder. */
export function validateAvatarPng(bytes: Buffer): void {
  if (bytes.length < 45 || bytes.length > PHOTO_BYTES || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') fail(translate("Profile picture must be a PNG up to 32 KiB."));
  if (bytes.readUInt32BE(8) !== 13 || bytes.toString('ascii', 12, 16) !== 'IHDR') fail(translate("Invalid PNG header."));
  const width = bytes.readUInt32BE(16); const height = bytes.readUInt32BE(20); const color = bytes[25];
  if (!width || !height || width > 256 || height > 256 || bytes[24] !== 8 || ![2, 6].includes(color!) || bytes[26] !== 0 || bytes[27] !== 0 || bytes[28] !== 0) fail(translate("Profile picture must be a simple PNG up to 256 × 256 pixels."));
  const compressed: Buffer[] = []; let offset = 8; let ended = false; let chunks = 0;
  while (offset + 12 <= bytes.length && ++chunks <= 64) {
    const length = bytes.readUInt32BE(offset); if (offset + length + 12 > bytes.length) fail(translate("Invalid PNG length."));
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    const content = bytes.subarray(offset + 4, offset + 8 + length); let crc = 0xffffffff;
    for (const byte of content) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); }
    if (((crc ^ 0xffffffff) >>> 0) !== bytes.readUInt32BE(offset + 8 + length)) fail(translate("PNG checksum is not correct."));
    if (type === 'IDAT') compressed.push(bytes.subarray(offset + 8, offset + 8 + length));
    if (type === 'IEND') { ended = length === 0 && offset + 12 === bytes.length; break; }
    if (!['IHDR', 'IDAT', 'sRGB', 'gAMA', 'pHYs', 'cHRM'].includes(type) || type === 'IHDR' && offset !== 8) fail(translate("Unsupported PNG data."));
    offset += length + 12;
  }
  if (!ended || !compressed.length) fail(translate("Incomplete PNG."));
  const expected = height * (1 + width * (color === 6 ? 4 : 3));
  let raw: Buffer;
  try { raw = inflateSync(Buffer.concat(compressed), { maxOutputLength: expected }); }
  catch { fail(translate("Invalid compressed image data.")); }
  if (raw!.length !== expected) fail(translate("Invalid image data length."));
}

export class RemoteProfileService {
  constructor(private readonly store: { get(): AdeConfig; save(partial: Partial<AdeConfig>): AdeConfig }, private readonly directory: string,
    private readonly normalize: (bytes: Buffer) => Buffer, private readonly changed: () => void = () => undefined,
    /** The PC's model catalog for an agent's runtime and backend; absent when this host cannot probe CLIs. */
    private readonly models?: (agent: Agent) => Promise<RuntimeModelCatalog>) {}
  /** Native Codex profiles without a custom command carry the model the desktop picker edits. */
  private modelEditable(agent: Agent): boolean { return agent.runtime === 'codex' && !agent.customCommand?.trim(); }
  /** Native Claude Code profiles without a custom command carry the model the desktop editor sets; '' means the CLI default. */
  private claudeEditable(agent: Agent): boolean { return agent.runtime === 'claude' && !agent.customCommand?.trim(); }
  /** The launch modes the runtime distinguishes (`LAUNCH_PROFILES`); a custom command always wins, so it offers none. */
  private permissionModes(agent: Agent): PermissionMode[] {
    if (agent.customCommand?.trim()) return [];
    const modes = PERMISSION_MODES.filter((mode) => LAUNCH_PROFILES[agent.runtime]?.commands[mode] !== null && LAUNCH_PROFILES[agent.runtime]?.commands[mode] !== undefined);
    return modes.length > 1 ? modes : [];
  }
  private agent(id: string): Agent { const agent = this.store.get().agents.find((item) => item.id === id); if (!agent) fail(translate("Agent no longer exists.")); return agent!; }
  revision(agent: Agent): string { return workbenchDigest(JSON.stringify([agent.id, agent.name, agent.role ?? '', agent.photo ?? '', agent.codexModel ?? '', agent.codexReasoningEffort ?? '', agent.claudeModel ?? '', agent.permissionMode])); }
  summary(agent: Agent): MobileAgentSummary {
    return { id: agent.id, name: redactForWire(agent.name, 160), role: agent.role ? redactForWire(agent.role, 200) : undefined, runtime: agent.runtime,
      ...(agent.photo ? { photoVersion: workbenchDigest(agent.photo) } : {}),
      ...(this.modelEditable(agent) ? { codexModel: redactForWire(agent.codexModel ?? DEFAULT_CODEX_MODEL, 120), codexReasoningEffort: (agent.codexReasoningEffort ?? DEFAULT_CODEX_REASONING_EFFORT) as CodexReasoningEffort } : {}),
      ...(this.claudeEditable(agent) ? { claudeModel: redactForWire(agent.claudeModel ?? '', 120) } : {}),
      ...(this.permissionModes(agent).length ? { permissionMode: agent.permissionMode, permissionModes: this.permissionModes(agent) } : {}) };
  }
  async query(id: string, options: { models?: boolean } = {}): Promise<MobileAgentProfile> {
    const agent = this.agent(id); const profile: MobileAgentProfile = { agent: this.summary(agent), revision: this.revision(agent) };
    if (options.models && (this.modelEditable(agent) || this.claudeEditable(agent)) && this.models) {
      const catalog = await this.models(agent);
      profile.models = { ...catalog, message: redactForWire(catalog.message ?? '', 300),
        models: catalog.models.slice(0, 200).map((model) => ({ ...model, id: redactForWire(model.id, 120), name: redactForWire(model.name, 160), ...(model.description === undefined ? {} : { description: redactForWire(model.description, 300) }),
          ...(model.resolvedModel === undefined ? {} : { resolvedModel: redactForWire(model.resolvedModel, 120) }) })) };
    }
    if (agent.photo) {
      try {
      if (!/^[A-Za-z0-9_-]+\.(?:png|jpe?g|webp)$/i.test(agent.photo)) fail(translate("Saved profile picture is not available."));
      const path = join(this.directory, agent.photo); assertNoLinks(path); const stat = lstatSync(path);
      if (!stat.isFile() || stat.nlink > 1 || stat.size > 10 * 1024 * 1024) fail(translate("Saved profile picture is not available."));
      const bytes = this.normalize(readFileSync(path)); validateAvatarPng(bytes);
      profile.photo = { mime: 'image/png', bytesBase64: bytes.toString('base64') };
      } catch { profile.photoError = translate("The saved image cannot be displayed. Choose a new image or remove it."); }
    }
    return profile;
  }
  update(input: MobileProfileUpdate): { revision: string } {
    const agent = this.agent(input.agentId);
    if (this.store.get().runWorkspaceLeases.some((lease) => lease.agentId === agent.id && lease.status === 'active')) fail(translate("A managed job is using this agent. Edit the profile after the job finishes."));
    if (this.revision(agent) !== input.revision) throw new RemoteApiError(409, 'command_rejected', translate("Agent profile has since been changed. Reload and review changes."));
    // Match desktop identity updates: keep the durable role block current,
    // outside leased workspaces, without following linked instruction storage.
    const instructions = join(agent.memoryDir, 'AGENTS.md'); assertNoLinks(instructions);
    try {
      const stat = lstatSync(instructions);
      if (!stat.isFile() || stat.nlink > 1 || stat.size > 256 * 1024) fail(translate("Agent instructions must first be checked on the PC."));
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    let photo = agent.photo;
    if (input.photo === null) photo = undefined;
    else if (input.photo) {
      const bytes = this.normalize(Buffer.from(input.photo.bytesBase64, 'base64')); validateAvatarPng(bytes);
      assertNoLinks(this.directory); mkdirSync(this.directory, { recursive: true, mode: 0o700 });
      photo = `${randomUUID()}.png`; const path = join(this.directory, photo); assertNoLinks(path);
      const fd = openSync(path, 'wx', 0o600); try { writeFileSync(fd, bytes); fsyncSync(fd); } finally { closeSync(fd); }
    }
    if ((input.codexModel !== undefined || input.codexReasoningEffort !== undefined) && !this.modelEditable(agent)) fail(translate("Model and reasoning apply to native Codex profiles without a custom command."));
    if (input.claudeModel !== undefined && !this.claudeEditable(agent)) fail(translate("The Claude model applies to native Claude Code profiles without a custom command."));
    if (input.permissionMode !== undefined && !this.permissionModes(agent).includes(input.permissionMode)) fail(translate("This agent's launch command does not distinguish that permission mode."));
    const updated: Agent = { ...agent, name: input.name.trim(), role: input.role.trim() || undefined, photo,
      ...(input.codexModel !== undefined ? { codexModel: input.codexModel } : {}), ...(input.codexReasoningEffort !== undefined ? { codexReasoningEffort: input.codexReasoningEffort } : {}),
      ...(input.claudeModel !== undefined ? { claudeModel: input.claudeModel.trim() || undefined } : {}), ...(input.permissionMode !== undefined ? { permissionMode: input.permissionMode } : {}) };
    syncAgentInstructions(updated);
    this.store.save({ agents: this.store.get().agents.map((item) => item.id === agent.id ? updated : item) });
    this.changed(); return { revision: this.revision(updated) };
  }
}
