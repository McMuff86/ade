import { closeSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AdeConfig, Agent } from '../../shared/types';
import type { MobileAgentProfile, MobileAgentSummary, MobileProfileUpdate } from '../../shared/remote';
import { assertNoLinks } from '../repositories/pathDiscipline';
import { redactForWire } from '../errors';
import { RemoteApiError } from './AdeApplicationService';
import { workbenchDigest } from './RemoteWorkbenchService';
import { syncAgentInstructions } from '../memory/agentInstructions';

const PHOTO_BYTES = 32 * 1024;
const fail = (message: string): never => { throw new RemoteApiError(422, 'command_rejected', message); };
const invalid = (): never => { throw new RemoteApiError(400, 'invalid_payload'); };
export function validateProfileQuery(value: unknown): string {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some((key) => key !== 'agentId')) invalid();
  const id = (value as { agentId: unknown }).agentId;
  if (typeof id !== 'string' || !/^[A-Za-z0-9_.:-]{1,128}$/.test(id)) invalid(); return id as string;
}
export function validateProfileUpdate(value: unknown): MobileProfileUpdate {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  const input = value as Record<string, unknown>;
  validateProfileQuery({ agentId: input.agentId });
  if (Object.keys(input).some((key) => !['agentId', 'revision', 'name', 'role', 'photo'].includes(key))
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
  return input as unknown as MobileProfileUpdate;
}

/** Bound PNG dimensions and decompression before handing bytes to the native image decoder. */
export function validateAvatarPng(bytes: Buffer): void {
  if (bytes.length < 45 || bytes.length > PHOTO_BYTES || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') fail('Profilbild muss ein PNG bis 32 KiB sein.');
  if (bytes.readUInt32BE(8) !== 13 || bytes.toString('ascii', 12, 16) !== 'IHDR') fail('Ungültiger PNG-Kopf.');
  const width = bytes.readUInt32BE(16); const height = bytes.readUInt32BE(20); const color = bytes[25];
  if (!width || !height || width > 256 || height > 256 || bytes[24] !== 8 || ![2, 6].includes(color!) || bytes[26] !== 0 || bytes[27] !== 0 || bytes[28] !== 0) fail('Profilbild muss ein einfaches PNG bis 256 × 256 Pixel sein.');
  const compressed: Buffer[] = []; let offset = 8; let ended = false; let chunks = 0;
  while (offset + 12 <= bytes.length && ++chunks <= 64) {
    const length = bytes.readUInt32BE(offset); if (offset + length + 12 > bytes.length) fail('Ungültige PNG-Länge.');
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    const content = bytes.subarray(offset + 4, offset + 8 + length); let crc = 0xffffffff;
    for (const byte of content) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); }
    if (((crc ^ 0xffffffff) >>> 0) !== bytes.readUInt32BE(offset + 8 + length)) fail('PNG-Prüfsumme stimmt nicht.');
    if (type === 'IDAT') compressed.push(bytes.subarray(offset + 8, offset + 8 + length));
    if (type === 'IEND') { ended = length === 0 && offset + 12 === bytes.length; break; }
    if (!['IHDR', 'IDAT', 'sRGB', 'gAMA', 'pHYs', 'cHRM'].includes(type) || type === 'IHDR' && offset !== 8) fail('Nicht unterstützte PNG-Daten.');
    offset += length + 12;
  }
  if (!ended || !compressed.length) fail('Unvollständiges PNG.');
  const expected = height * (1 + width * (color === 6 ? 4 : 3));
  let raw: Buffer;
  try { raw = inflateSync(Buffer.concat(compressed), { maxOutputLength: expected }); }
  catch { fail('Ungültige komprimierte Bilddaten.'); }
  if (raw!.length !== expected) fail('Ungültige Bilddatenlänge.');
}

export class RemoteProfileService {
  constructor(private readonly store: { get(): AdeConfig; save(partial: Partial<AdeConfig>): AdeConfig }, private readonly directory: string,
    private readonly normalize: (bytes: Buffer) => Buffer, private readonly changed: () => void = () => undefined) {}
  private agent(id: string): Agent { const agent = this.store.get().agents.find((item) => item.id === id); if (!agent) fail('Agent ist nicht mehr vorhanden.'); return agent!; }
  revision(agent: Agent): string { return workbenchDigest(JSON.stringify([agent.id, agent.name, agent.role ?? '', agent.photo ?? ''])); }
  summary(agent: Agent): MobileAgentSummary {
    return { id: agent.id, name: redactForWire(agent.name, 160), role: agent.role ? redactForWire(agent.role, 200) : undefined, runtime: agent.runtime,
      ...(agent.photo ? { photoVersion: workbenchDigest(agent.photo) } : {}) };
  }
  query(id: string): MobileAgentProfile {
    const agent = this.agent(id); const profile: MobileAgentProfile = { agent: this.summary(agent), revision: this.revision(agent) };
    if (agent.photo) {
      try {
      if (!/^[A-Za-z0-9_-]+\.(?:png|jpe?g|webp)$/i.test(agent.photo)) fail('Gespeichertes Profilbild ist nicht verfügbar.');
      const path = join(this.directory, agent.photo); assertNoLinks(path); const stat = lstatSync(path);
      if (!stat.isFile() || stat.nlink > 1 || stat.size > 10 * 1024 * 1024) fail('Gespeichertes Profilbild ist nicht verfügbar.');
      const bytes = this.normalize(readFileSync(path)); validateAvatarPng(bytes);
      profile.photo = { mime: 'image/png', bytesBase64: bytes.toString('base64') };
      } catch { profile.photoError = 'Gespeichertes Bild kann nicht angezeigt werden. Ein neues Bild wählen oder das Bild entfernen.'; }
    }
    return profile;
  }
  update(input: MobileProfileUpdate): { revision: string } {
    const agent = this.agent(input.agentId);
    if (this.store.get().runWorkspaceLeases.some((lease) => lease.agentId === agent.id && lease.status === 'active')) fail('Agent wird durch einen verwalteten Auftrag verwendet. Profil nach dessen Abschluss bearbeiten.');
    if (this.revision(agent) !== input.revision) throw new RemoteApiError(409, 'command_rejected', 'Agent-Profil wurde inzwischen geändert. Neu laden und Änderungen prüfen.');
    // Match desktop identity updates: keep the durable role block current,
    // outside leased workspaces, without following linked instruction storage.
    const instructions = join(agent.memoryDir, 'AGENTS.md'); assertNoLinks(instructions);
    try {
      const stat = lstatSync(instructions);
      if (!stat.isFile() || stat.nlink > 1 || stat.size > 256 * 1024) fail('Agent-Anweisungen müssen zuerst am PC geprüft werden.');
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    let photo = agent.photo;
    if (input.photo === null) photo = undefined;
    else if (input.photo) {
      const bytes = this.normalize(Buffer.from(input.photo.bytesBase64, 'base64')); validateAvatarPng(bytes);
      assertNoLinks(this.directory); mkdirSync(this.directory, { recursive: true, mode: 0o700 });
      photo = `${randomUUID()}.png`; const path = join(this.directory, photo); assertNoLinks(path);
      const fd = openSync(path, 'wx', 0o600); try { writeFileSync(fd, bytes); fsyncSync(fd); } finally { closeSync(fd); }
    }
    const updated: Agent = { ...agent, name: input.name.trim(), role: input.role.trim() || undefined, photo };
    syncAgentInstructions(updated);
    this.store.save({ agents: this.store.get().agents.map((item) => item.id === agent.id ? updated : item) });
    this.changed(); return { revision: this.revision(updated) };
  }
}
