import { randomUUID } from 'node:crypto';
import type { SessionMeta } from '../../shared/types';
import type { MobileTerminalCommand, MobileTerminalInput, MobileTerminalQuery, MobileTerminalState, MobileTerminalSummary, SessionLaunchChoice, SessionLaunchOptions, MobileTerminalSelection } from '../../shared/remote';
import { validProjectLaunch, validSessionChoice, validTerminalSelection } from '../../shared/sessionLaunch';
import type { TerminalControlState } from '../../shared/ipc';
import { isValidIdempotencyKey } from '../remote/authorization';
import type { DeviceAuditEntry } from '../remote/RemoteDeviceStore';
import { redactForWire } from '../errors';
import { RemoteApiError, type RemoteCommandContext } from './AdeApplicationService';
import { workbenchDigest, type RemoteWorkbenchService, type WorkbenchScope } from './RemoteWorkbenchService';
import { remoteTerminalScreen } from './RemoteTerminalScreen';
import type { MobileSessionInventory } from '../../shared/remote';
import type { MobileTerminalPrompt, MobileDictationTarget } from '../../shared/remote';
import { terminalPromptBytes, validTerminalPrompt, type TerminalPromptCapability, type TerminalPromptRequest, type TerminalPromptReceipt } from '../../shared/terminalPrompt';
import { validPromptText } from '../../shared/dictation';
import type { SpeechUsageAttribution } from '../usage/SpeechUsageService';
import type { TerminalImageStore } from './TerminalImageStore';
import { TERMINAL_IMAGE_MAX_BASE64, validTerminalImageId } from '../../shared/terminalImages';
import type { MobileTerminalImageUpload } from '../../shared/remote';

type RecordingAuthorization = (() => void) & { usage: Readonly<SpeechUsageAttribution> };
const recordingAuthorization = (authorize: () => void, session: SessionMeta): RecordingAuthorization => Object.assign(authorize, {
  usage: Object.freeze({ terminalSessionId: session.id, repositoryId: session.repositoryId ?? undefined, agentId: session.agentId ?? undefined }),
});

export interface RemoteTerminalPort {
  promptCapability?(sessionId: string, requirePaste?: boolean): TerminalPromptCapability;
  deliverPrompt?(request: TerminalPromptRequest, authorize: () => void | Promise<void>): TerminalPromptReceipt | Promise<TerminalPromptReceipt>;
  writePrompt?(sessionId: string, text: string | readonly string[], authorize: () => void | Promise<void>): void | Promise<void>;
  profileContext?(sessionId: string): string | null;
  usage?(sessionId: string): Promise<import('../../shared/remote').SubscriptionUsage>;
  display?(sessionId: string): Promise<Pick<MobileTerminalState, 'screen' | 'frame'>>;
  list(): SessionMeta[];
  create(agentId: string, repositoryId: string | null, bindingId: string | undefined, mode: SessionLaunchChoice['mode'], model?: string, authorize?: () => void): Promise<SessionMeta>;
  createProject?(workspaceId: string, branch: string, choice: SessionLaunchChoice, profileId: string | undefined, authorize: () => void): Promise<SessionMeta>;
  createHome?(choice: SessionLaunchChoice, authorize: () => void): Promise<SessionMeta>;
  options?(selection: MobileTerminalSelection): Promise<SessionLaunchOptions>;
  attach(sessionId: string): { replayBase64: string; sequence: number };
  write(sessionId: string, data: Buffer): void;
  resize(sessionId: string, cols: number, rows: number): void;
  kill(sessionId: string): void;
}
interface Control {
  deviceId: string; leaseId: string; expiresAt: number; sequence: number;
  receipts: Map<number, { key: string; fingerprint: string; accepted: boolean }>;
}
interface TerminalEntry { id: string; sessionId: string; cols: number; rows: number; workspaceVersion: string; control?: Control }
const failure = (message: string): never => { throw new RemoteApiError(409, 'command_rejected', message); };
const ID = /^[A-Za-z0-9_.:-]{1,128}$/;

export function validateTerminal(value: unknown, kind: 'query' | 'command' | 'input'): MobileTerminalQuery | MobileTerminalCommand | MobileTerminalInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new RemoteApiError(400, 'invalid_payload');
  const input = value as Record<string, unknown>;
  const allowed = ['terminalHome', 'agentId', 'repositoryId', 'projectWorkspaceId', ...(kind === 'query' ? ['terminalId', 'options', 'usage', 'profileContext', 'prompt', 'knownDisplayRevision'] : kind === 'command' ? ['operation', ...(input.operation === 'open' ? ['mode', 'model', ...(input.projectWorkspaceId ? ['expectedBranch', 'profileId'] : [])] : ['terminalId'])]
    : ['terminalId', 'leaseId', 'sequence', 'data', 'cols', 'rows'])];
  if (Object.keys(input).some((key) => !allowed.includes(key)) || !validTerminalSelection(input)
    || (input.terminalId !== undefined && (typeof input.terminalId !== 'string' || !ID.test(input.terminalId)))) throw new RemoteApiError(400, 'invalid_payload');
  if (kind === 'command' && (!['open', 'claim', 'release', 'close'].includes(String(input.operation))
    || (input.operation === 'open' ? !validSessionChoice(input) : typeof input.terminalId !== 'string'))) throw new RemoteApiError(400, 'invalid_payload');
  if (kind === 'command' && input.operation === 'open' && input.projectWorkspaceId && !validProjectLaunch(input)) throw new RemoteApiError(400, 'invalid_payload');
  if (kind === 'query' && input.options !== undefined && input.options !== true) throw new RemoteApiError(400, 'invalid_payload');
  if (kind === 'query' && input.usage !== undefined && (input.usage !== true || typeof input.terminalId !== 'string')) throw new RemoteApiError(400, 'invalid_payload');
  if (kind === 'query' && input.profileContext !== undefined && (input.profileContext !== true || typeof input.terminalId !== 'string')) throw new RemoteApiError(400, 'invalid_payload');
  if (kind === 'query' && input.prompt !== undefined && (input.prompt !== true || typeof input.terminalId !== 'string')) throw new RemoteApiError(400, 'invalid_payload');
  if (kind === 'query' && input.knownDisplayRevision !== undefined && (typeof input.terminalId !== 'string'
    || typeof input.knownDisplayRevision !== 'string' || !/^[a-f0-9]{64}$/.test(input.knownDisplayRevision))) throw new RemoteApiError(400, 'invalid_payload');
  if (kind === 'input' && (typeof input.terminalId !== 'string' || typeof input.leaseId !== 'string' || !ID.test(input.leaseId)
    || !Number.isSafeInteger(input.sequence) || (input.sequence as number) < 1 || typeof input.data !== 'string' || Buffer.byteLength(input.data) > 2048 || input.data.includes('\0')
    || !Number.isInteger(input.cols) || (input.cols as number) < 20 || (input.cols as number) > 240
    || !Number.isInteger(input.rows) || (input.rows as number) < 5 || (input.rows as number) > 100)) throw new RemoteApiError(400, 'invalid_payload');
  return input as unknown as MobileTerminalQuery | MobileTerminalCommand | MobileTerminalInput;
}

export function validateTerminalPrompt(value: unknown): MobileTerminalPrompt {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new RemoteApiError(400, 'invalid_payload');
  const { text, mode, imageIds, ...selection } = value as Record<string, unknown>;
  if (imageIds !== undefined && (!Array.isArray(imageIds) || imageIds.length < 1 || imageIds.length > 4 || !imageIds.every(validTerminalImageId) || new Set(imageIds).size !== imageIds.length)) throw new RemoteApiError(400, 'invalid_payload');
  if (Object.hasOwn(selection, 'data') || !validPromptText(text) || (mode !== 'insert' && mode !== 'submit')) throw new RemoteApiError(400, 'invalid_payload');
  validateTerminal({ ...selection, data: '' }, 'input');
  return value as MobileTerminalPrompt;
}

export function validateTerminalImageUpload(value: unknown): MobileTerminalImageUpload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new RemoteApiError(400, 'invalid_payload');
  const { pngBase64, ...target } = value as Record<string, unknown>;
  if (typeof pngBase64 !== 'string' || pngBase64.length < 44 || pngBase64.length > TERMINAL_IMAGE_MAX_BASE64
    || pngBase64.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(pngBase64)
    || ['data', 'sequence', 'cols', 'rows'].some(key => Object.hasOwn(target, key))) throw new RemoteApiError(400, 'invalid_payload');
  validateTerminal({ ...target, data: '', sequence: 1, cols: 80, rows: 24 }, 'input');
  return value as MobileTerminalImageUpload;
}

/** Remote identities map to live interactive PTYs only inside main. No raw PTY ids on the wire. */
export class RemoteTerminalService {
  private readonly entries = new Map<string, TerminalEntry>();
  private readonly timer: ReturnType<typeof setInterval>;
  constructor(private readonly workbench: RemoteWorkbenchService, private readonly port: RemoteTerminalPort,
    private readonly allowed: (deviceId: string) => boolean, private readonly audit: (entry: DeviceAuditEntry) => void,
    private readonly changed: (state: TerminalControlState) => void = () => undefined, private readonly now = () => Date.now(),
    private readonly authorizeSelection: (deviceId: string, selection: Partial<MobileTerminalSelection> & { profileId?: string }) => void = () => undefined,
    private readonly images?: TerminalImageStore) {
    this.timer = setInterval(() => this.expire(), 1000); this.timer.unref();
  }
  dispose(): void { clearInterval(this.timer); this.entries.clear(); }
  revoke(deviceId: string | null): void {
    for (const entry of this.entries.values()) if (entry.control && (deviceId === null || entry.control.deviceId === deviceId)) this.release(entry);
  }
  desktopState(sessionId: string): TerminalControlState {
    this.expire(); const entry = [...this.entries.values()].find((item) => item.sessionId === sessionId);
    return { sessionId, remote: !!entry?.control };
  }
  reclaim(sessionId: string): TerminalControlState {
    const entry = [...this.entries.values()].find((item) => item.sessionId === sessionId); if (entry) this.release(entry);
    return { sessionId, remote: false };
  }
  desktopMayWrite(sessionId: string): boolean { return !this.desktopState(sessionId).remote; }

  desktopPromptCapability(sessionId: string): TerminalPromptCapability {
    return this.desktopMayWrite(sessionId) ? this.port.promptCapability?.(sessionId) ?? { available: false, reason: 'Promptübergabe ist nicht verfügbar.' }
      : { available: false, reason: 'Dieses Terminal wird von einem anderen Gerät gesteuert. Eingabe am Desktop übernehmen.' };
  }

  async desktopPrompt(request: TerminalPromptRequest): Promise<TerminalPromptReceipt> {
    if (!validTerminalPrompt(request) || !this.port.deliverPrompt) throw new Error('Ungültiger Promptauftrag.');
    const authorize = await this.desktopRecordingTarget(request.sessionId);
    return this.port.deliverPrompt(request, async () => {
      // Repeat filesystem/link validation after a delayed paste as well as before
      // it. The original closure also binds this command to its captured target.
      await this.desktopRecordingTarget(request.sessionId); authorize();
    });
  }

  async desktopRecordingTarget(sessionId: string): Promise<RecordingAuthorization> {
    const session = this.port.list().find(item => item.id === sessionId);
    if (!session) throw new Error('Sitzung ist nicht mehr verfügbar.');
    const selection: MobileTerminalSelection = session.projectWorkspaceId ? { projectWorkspaceId: session.projectWorkspaceId }
      : session.agentId ? { agentId: session.agentId, repositoryId: session.repositoryId ?? null } : { terminalHome: true };
    const binding = await this.workbench.resolveTerminal(selection);
    if (!binding) throw new Error('Workspace ist nicht mehr verfügbar.');
    await this.workbench.revalidate(binding);
    const authorize = () => {
      const current = this.port.list().find(item => item.id === sessionId);
      if (!current || !this.workbench.sessionMatches(binding, current) || this.workbench.managed(binding) || !this.desktopMayWrite(sessionId)) {
        throw new Error('Sitzungsziel, Workspace oder Eingabebesitz wurde geändert.');
      }
      const capability = this.port.promptCapability?.(sessionId, false);
      if (!capability?.available) throw new Error(capability && !capability.available ? capability.reason : 'Promptübergabe ist nicht verfügbar.');
    };
    authorize(); return recordingAuthorization(authorize, session);
  }

  async query(deviceId: string, input: MobileTerminalQuery): Promise<MobileTerminalState> {
    this.requireGrant(deviceId, input); this.expire();
    const binding = await this.workbench.resolveTerminal(input, true);
    const launchOptions = input.options ? await this.port.options?.(input) : undefined;
    const options = () => launchOptions ? { ...launchOptions, profiles: launchOptions.profiles?.filter((profile) => {
      try { this.authorizeSelection(deviceId, { profileId: profile.id }); return true; } catch { return false; }
    }) } : undefined;
    this.requireGrant(deviceId, input);
    if (!binding) return { terminals: [], launchOptions: options() };
    const sessions = this.port.list().filter((session) => session.kind === 'interactive' && !session.runTaskId && !session.remoteAccessBlocked
      && this.workbench.sessionMatches(binding, session) && this.visible(deviceId, session));
    const terminals = sessions.slice(-32).filter((session) => this.entry(session, binding).workspaceVersion === this.workbench.version(binding))
      .map((session) => this.summary(this.entry(session, binding), session, deviceId, binding));
    const current = () => ({ terminals: terminals.filter((item) => this.visible(deviceId, sessions.find((session) => session.id === this.entries.get(item.id)?.sessionId)!)), launchOptions: options() });
    this.requireGrant(deviceId, input);
    if (!input.terminalId) {
      await this.workbench.revalidate(binding); this.requireGrant(deviceId, input);
      return current();
    }
    // The selected display is read-only. Revalidate once AFTER the awaited
    // display/usage read, immediately before returning anything to the device.
    const entry = this.entries.get(input.terminalId); const session = sessions.find((item) => item.id === entry?.sessionId);
    if (!entry || !session || entry.workspaceVersion !== this.workbench.version(binding)) failure('Terminal ist nicht mehr verfügbar. Sitzungsliste aktualisieren.');
    const subscriptionUsage = input.usage ? await this.port.usage?.(entry!.sessionId) : undefined;
    if (subscriptionUsage?.consumption) subscriptionUsage.consumption = { ...subscriptionUsage.consumption,
      models: subscriptionUsage.consumption.models.map(model => redactForWire(model, 128)),
      notice: redactForWire(subscriptionUsage.consumption.notice, 1000) };
    const display = this.port.display ? await this.port.display(entry!.sessionId)
      : { screen: await remoteTerminalScreen(Buffer.from(this.port.attach(entry!.sessionId).replayBase64, 'base64'), entry!.cols, entry!.rows) };
    this.requireGrant(deviceId, input); await this.workbench.revalidate(binding); this.requireGrant(deviceId, input); this.expire();
    if (!this.visible(deviceId, session!)) throw new RemoteApiError(403, 'scope_not_granted');
    const own = entry!.control?.deviceId === deviceId ? entry!.control : undefined;
    const profileText = input.profileContext ? this.port.profileContext?.(entry!.sessionId) : undefined;
    const displayRevision = workbenchDigest(JSON.stringify([entry!.id, display.frame?.revision, display.screen]));
    const promptCapability: TerminalPromptCapability | undefined = !input.prompt ? undefined : own ? this.port.promptCapability?.(entry!.sessionId)
      ?? { available: false, reason: 'Promptübergabe ist nicht verfügbar.' } : { available: false, reason: 'Zuerst die Terminal-Eingabe übernehmen.' };
    return { ...current(), subscriptionUsage, displayRevision, imageCapability: this.imageCapability(session!),
      ...(promptCapability ? { promptCapability: promptCapability.available ? promptCapability : { available: false as const, reason: redactForWire(promptCapability.reason, 1000) } } : {}),
      ...(input.profileContext ? { profileContextText: typeof profileText === 'string' ? redactForWire(profileText, 32_000) : null } : {}),
      selected: this.summary(entry!, session!, deviceId, binding), ...(input.knownDisplayRevision === displayRevision ? { displayUnchanged: true as const } : display),
      cols: display.frame?.cols ?? entry!.cols, rows: display.frame?.rows ?? entry!.rows,
      ...(own ? { leaseId: own.leaseId, lastSequence: own.sequence, inputUncertain: own.sequence > 0 && own.receipts.get(own.sequence)?.accepted !== true } : {}) };
  }

  async inventory(deviceId: string): Promise<MobileSessionInventory> {
    this.requireGrant(deviceId); this.expire();
    const candidates = this.port.list().filter((session) => session.kind === 'interactive' && !session.runTaskId && !session.remoteAccessBlocked && this.visible(deviceId, session))
      .sort((a, b) => b.createdAt - a.createdAt);
    const result: MobileSessionInventory = { sessions: [], omitted: Math.max(0, candidates.length - 32) };
    for (const session of candidates.slice(0, 32)) {
      this.requireGrant(deviceId);
      try {
        if (!session.projectWorkspaceId && !session.agentId && session.scopeSource !== 'terminal-home') { result.omitted++; continue; }
        const selection: MobileTerminalSelection = session.scopeSource === 'terminal-home' ? { terminalHome: true } : session.projectWorkspaceId ? { projectWorkspaceId: session.projectWorkspaceId }
          : { agentId: session.agentId!, repositoryId: session.repositoryId ?? null };
        this.requireGrant(deviceId, selection);
        const binding = await this.workbench.resolveTerminal(selection, true);
        if (!binding || !this.workbench.sessionMatches(binding, session)) { result.omitted++; continue; }
        await this.workbench.revalidate(binding);
        const entry = this.entry(session, binding);
        if (entry.workspaceVersion !== this.workbench.version(binding)) { result.omitted++; continue; }
        if (!this.port.list().some((item) => item.id === session.id)) { result.omitted++; continue; }
        if (!this.visible(deviceId, session)) continue;
        result.sessions.push({ ...this.summary(entry, session, deviceId, binding), ...selection, createdAt: session.createdAt });
      } catch { result.omitted++; }
    }
    this.requireGrant(deviceId);
    result.sessions = result.sessions.filter((item) => { try { this.requireGrant(deviceId, { ...item, profileId: item.launchProfileId }); return true; } catch { return false; } });
    return result;
  }

  /** Main-only identity bridge over the same authorized, revalidated inventory.
   * No new PTY control path and no raw session IDs in the returned wire DTO. */
  async supervisionSessions(deviceId: string) {
    const inventory = await this.inventory(deviceId);
    return inventory.sessions.flatMap(wire => {
      const entry = this.entries.get(wire.id); const session = this.port.list().find(item => item.id === entry?.sessionId);
      return session && this.visible(deviceId, session) ? [{ wire, session }] : [];
    });
  }

  async command(deviceId: string, input: MobileTerminalCommand): Promise<{ terminalId: string }> {
    this.requireGrant(deviceId, input); this.expire();
    const binding = await this.workbench.resolveTerminal(input, false, input.operation === 'open'); this.requireGrant(deviceId, input); let entry: TerminalEntry;
    if (this.workbench.managed(binding!) && input.operation !== 'release' && input.operation !== 'close') failure('Workspace ist durch einen verwalteten Auftrag belegt.');
    if (input.operation === 'open') {
      if (this.port.list().filter((session) => session.status === 'running').length >= 32) failure('Maximal 32 laufende Sitzungen. Zuerst eine Sitzung beenden.');
      this.requireGrant(deviceId, input);
      if (input.projectWorkspaceId && !this.port.createProject) failure('Projekt-Terminals sind nicht verfügbar.');
      if (input.terminalHome && !this.port.createHome) failure('Freie Terminals sind nicht verfügbar.');
      const session = input.terminalHome
        ? await this.port.createHome!(input.mode === 'ollama' ? { mode: input.mode, model: input.model } : { mode: input.mode }, () => this.requireGrant(deviceId, input))
        : input.projectWorkspaceId
        ? await this.port.createProject!(input.projectWorkspaceId, input.expectedBranch!, input.mode === 'ollama' ? { mode: input.mode, model: input.model } : { mode: input.mode }, input.profileId, () => this.requireGrant(deviceId, input))
        : await this.port.create(input.agentId!, input.repositoryId!, binding!.id, input.mode, input.mode === 'ollama' ? input.model : undefined, () => this.requireGrant(deviceId, input));
      try { await this.workbench.revalidate(binding!); this.requireGrant(deviceId, input); if (!this.workbench.sessionMatches(binding!, session)) failure('Workspace-Zuordnung hat sich geändert.'); }
      catch (error) { this.port.kill(session.id); throw error; }
      entry = this.entry(session, binding!);
      if (!this.allowed(deviceId)) { this.port.kill(session.id); failure('Terminalfreigabe wurde zurückgezogen.'); }
    } else {
      entry = this.requireEntry(input.terminalId, binding!);
      if (!this.visible(deviceId, this.port.list().find((session) => session.id === entry.sessionId)!)) throw new RemoteApiError(403, 'scope_not_granted');
      if (input.operation === 'release') {
        if (entry.control?.deviceId === deviceId) this.release(entry); return { terminalId: entry.id };
      }
      if (input.operation === 'close') {
        if (entry.control?.deviceId !== deviceId) failure('Vor dem Beenden die Terminal-Eingabe übernehmen.');
        this.port.kill(entry.sessionId); this.release(entry); return { terminalId: entry.id };
      }
      if (entry.control && entry.control.deviceId !== deviceId) failure('Ein anderes Gerät steuert dieses Terminal. Am Desktop freigeben.');
    }
    entry.control = { deviceId, leaseId: randomUUID(), expiresAt: this.now() + 30_000, sequence: 0, receipts: new Map() };
    this.changed({ sessionId: entry.sessionId, remote: true });
    return { terminalId: entry.id };
  }

  async prompt(context: RemoteCommandContext, input: MobileTerminalPrompt): Promise<{ sequence: number; replayed: boolean }> {
    if (!this.port.writePrompt) failure('Promptübergabe ist nicht verfügbar.');
    const { text, mode, imageIds, ...selection } = input;
    let parts: string[] | undefined; let revalidateImages: (() => Promise<void>) | undefined;
    if (imageIds?.length) {
      const target = await this.imageTarget(context.principal.id, input);
      const paths = await Promise.all(imageIds.map(id => this.images!.path(context.principal.id, input.terminalId, target.backend, id)));
      revalidateImages = async () => {
        await target.authorize();
        await Promise.all(imageIds.map(id => this.images!.path(context.principal.id, input.terminalId, target.backend, id)));
      };
      parts = [...paths.map(path => `\x1b[200~${path}\x1b[201~`), terminalPromptBytes(text, mode)];
    }
    // Bind the receipt to the original text/mode as well as to the generated bytes.
    return this.input(context, { ...selection, data: terminalPromptBytes(text, mode) }, { text, mode, imageIds, parts, revalidateImages });
  }

  private imageCapability(session: SessionMeta): TerminalPromptCapability {
    if (!this.images || session.runtime !== 'codex') return { available: false, reason: 'Bildanhänge sind für native Codex-Sitzungen verfügbar.' };
    return this.port.promptCapability?.(session.id, false) ?? { available: false, reason: 'Bildübergabe ist nicht verfügbar.' };
  }

  async imageTarget(deviceId: string, target: MobileDictationTarget) {
    // Drop no fields from an untrusted request here: its caller validates the DTO.
    const authorizeRecording = await this.recordingTarget(deviceId, target);
    const binding = await this.workbench.resolveTerminal(target);
    const entry = this.requireEntry(target.terminalId, binding!);
    const authorize = async () => {
      await this.workbench.revalidate(binding!); authorizeRecording();
      const capability = this.imageCapability(this.port.list().find(session => session.id === entry.sessionId)!);
      if (!capability.available) failure(capability.reason);
    };
    await authorize(); return { backend: binding!.executionBackend, authorize };
  }

  async uploadImage(deviceId: string, input: MobileTerminalImageUpload) {
    const { pngBase64, ...target } = input;
    const { backend, authorize } = await this.imageTarget(deviceId, target);
    return this.images!.put(deviceId, input.terminalId, backend, Buffer.from(pngBase64, 'base64'), authorize);
  }

  async recordingTarget(deviceId: string, target: MobileDictationTarget): Promise<RecordingAuthorization> {
    this.requireGrant(deviceId, target); this.expire();
    const binding = await this.workbench.resolveTerminal(target);
    if (!binding) failure('Workspace ist nicht mehr verfügbar.');
    const entry = this.requireEntry(target.terminalId, binding!); const control = entry.control;
    await this.workbench.revalidate(binding!);
    const authorize = () => {
      this.requireGrant(deviceId, target); this.expire();
      const current = this.requireEntry(target.terminalId, binding!);
      if (current !== entry || !control || entry.control !== control || control.deviceId !== deviceId || control.leaseId !== target.leaseId
        || this.workbench.managed(binding!)) failure('Aufnahmeziel oder Eingabebesitz hat sich geändert.');
      const session = this.port.list().find(item => item.id === entry.sessionId)!;
      if (!this.visible(deviceId, session)) throw new RemoteApiError(403, 'scope_not_granted');
      const capability = this.port.promptCapability?.(entry.sessionId, false);
      if (!capability?.available) failure(capability && !capability.available ? capability.reason : 'Promptübergabe ist nicht verfügbar.');
    };
    authorize(); return recordingAuthorization(authorize, this.port.list().find(item => item.id === entry.sessionId)!);
  }

  /** Read permission for speech is independent of keyboard ownership/paste support. */
  async readingTarget(deviceId: string, target: MobileTerminalSelection & { terminalId: string }): Promise<RecordingAuthorization> {
    validateTerminal(target, 'query'); this.requireGrant(deviceId, target);
    const binding = await this.workbench.resolveTerminal(target);
    if (!binding) failure('Workspace ist nicht mehr verfügbar.');
    const entry = this.requireEntry(target.terminalId, binding!);
    await this.workbench.revalidate(binding!);
    const authorize = () => {
      this.requireGrant(deviceId, target);
      if (this.requireEntry(target.terminalId, binding!) !== entry
        || !this.visible(deviceId, this.port.list().find(item => item.id === entry.sessionId)!)) throw new RemoteApiError(403, 'scope_not_granted');
    };
    authorize(); return recordingAuthorization(authorize, this.port.list().find(item => item.id === entry.sessionId)!);
  }

  async input(context: RemoteCommandContext, input: MobileTerminalInput, prompt?: Pick<MobileTerminalPrompt, 'text' | 'mode' | 'imageIds'> & { parts?: readonly string[]; revalidateImages?: () => Promise<void> }): Promise<{ sequence: number; replayed: boolean }> {
    const deviceId = context.principal.id; this.requireGrant(deviceId, input); this.expire();
    const binding = await this.workbench.resolveTerminal(input); this.requireGrant(deviceId, input); const entry = this.requireEntry(input.terminalId, binding!);
      if (!this.visible(deviceId, this.port.list().find((session) => session.id === entry.sessionId)!)) throw new RemoteApiError(403, 'scope_not_granted');
    if (this.workbench.managed(binding!)) failure('Workspace ist durch einen verwalteten Auftrag belegt.');
    const control = entry.control;
    if (!control || control.deviceId !== deviceId || control.leaseId !== input.leaseId) failure('Eingabe wurde freigegeben oder übernommen. Erneut übernehmen.');
    const key = context.idempotencyKey;
    if (!key) throw new RemoteApiError(400, 'idempotency_key_required');
    if (!isValidIdempotencyKey(key)) throw new RemoteApiError(400, 'idempotency_key_invalid');
    const fingerprint = workbenchDigest(JSON.stringify(prompt ? [input, prompt] : input)); const previous = control!.receipts.get(input.sequence);
    if (previous) {
      if (previous.key !== key || previous.fingerprint !== fingerprint) throw new RemoteApiError(409, 'idempotency_key_reused');
      if (!previous.accepted) throw new RemoteApiError(409, 'command_uncertain');
      return { sequence: input.sequence, replayed: true };
    }
    if (input.sequence !== control!.sequence + 1 || [...control!.receipts.values()].some((receipt) => receipt.key === key)) failure('Eingabereihenfolge ist unklar. Status prüfen; Eingabe wird nicht wiederholt.');
    await this.workbench.revalidate(binding!);
    this.requireGrant(deviceId, input); this.expire();
    if (entry.control !== control) failure('Eingabe wurde inzwischen übernommen.');
    if (this.workbench.managed(binding!)) failure('Workspace wurde inzwischen durch einen verwalteten Auftrag belegt.');
    const raced = control!.receipts.get(input.sequence);
    if (raced) {
      if (raced.key !== key || raced.fingerprint !== fingerprint) throw new RemoteApiError(409, 'idempotency_key_reused');
      if (!raced.accepted) throw new RemoteApiError(409, 'command_uncertain');
      return { sequence: input.sequence, replayed: true };
    }
    if (input.sequence !== control!.sequence + 1) failure('Eingabereihenfolge hat sich geändert.');
    if (prompt) {
      const capability = this.port.promptCapability?.(entry.sessionId);
      if (!capability?.available) failure(capability && !capability.available ? redactForWire(capability.reason, 1000) : 'Promptübergabe ist nicht verfügbar.');
    }
    // Reserve before write; a pending receipt blocks subsequent input while the
    // protected writer separates paste and Enter. Audit never contains input.
    const audit: DeviceAuditEntry = { at: this.now(), principalId: deviceId, principalKind: 'device', requestId: context.requestId,
      channel: prompt ? 'terminal:prompt' : 'terminal:input', target: entry.id, outcome: 'requested' };
    this.audit(audit);
    if (control!.sequence > 0 && control!.receipts.get(control!.sequence)?.accepted !== true) throw new RemoteApiError(409, 'command_uncertain');
    const receipt = { key, fingerprint, accepted: false };
    control!.sequence = input.sequence; control!.receipts.set(input.sequence, receipt);
    if (control!.receipts.size > 128) control!.receipts.delete(control!.receipts.keys().next().value!);
    entry.cols = input.cols; entry.rows = input.rows;
    this.port.resize(entry.sessionId, input.cols, input.rows);
    if (prompt) await this.port.writePrompt!(entry.sessionId, prompt.parts ?? input.data, async () => {
      await this.workbench.revalidate(binding!);
      this.requireGrant(deviceId, input); this.expire();
      if (entry.control !== control || this.requireEntry(input.terminalId, binding!) !== entry || this.workbench.managed(binding!)) failure('Promptziel oder Eingabebesitz hat sich geändert.');
      if (!this.visible(deviceId, this.port.list().find(item => item.id === entry.sessionId)!)) throw new RemoteApiError(403, 'scope_not_granted');
      await prompt.revalidateImages?.();
    });
    else this.port.write(entry.sessionId, Buffer.from(input.data, 'utf8'));
    receipt.accepted = true;
    control!.expiresAt = this.now() + 30_000;
    this.audit({ ...audit, outcome: 'executed' });
    return { sequence: input.sequence, replayed: false };
  }

  private requireEntry(id: string, binding: WorkbenchScope): TerminalEntry {
    const entry = this.entries.get(id); const session = this.port.list().find((item) => item.id === entry?.sessionId);
    if (!entry || !session || session.status !== 'running' || session.kind !== 'interactive' || session.runTaskId || session.remoteAccessBlocked
      || !this.workbench.sessionMatches(binding, session) || entry.workspaceVersion !== this.workbench.version(binding)) failure('Diese interaktive Sitzung ist nicht verfügbar.');
    return entry!;
  }
  private entry(session: SessionMeta, binding: WorkbenchScope): TerminalEntry {
    const found = [...this.entries.values()].find((item) => item.sessionId === session.id); if (found) return found;
    if (this.entries.size >= 128) failure('Zu viele Terminal-Verbindungen. Alte Sitzungen am PC schliessen.');
    const entry: TerminalEntry = { id: randomUUID(), sessionId: session.id, cols: 120, rows: 32, workspaceVersion: this.workbench.version(binding) }; this.entries.set(entry.id, entry); return entry;
  }
  private summary(entry: TerminalEntry, session: SessionMeta, deviceId: string, binding: WorkbenchScope): MobileTerminalSummary {
    return { id: entry.id, title: redactForWire(session.title, 100), status: session.status,
      ...(binding.projectName ? { projectName: redactForWire(binding.projectName, 200) } : {}),
      ...(binding.repositoryId ? { projectRepositoryId: binding.repositoryId } : {}),
      profileContext: session.profileContext ? { profileId: session.profileContext.profileId,
        profileName: redactForWire(session.profileContext.profileName, 200), digest: session.profileContext.digest,
        profileDigest: session.profileContext.profileDigest,
        capturedAt: session.profileContext.capturedAt, delivery: session.profileContext.delivery,
        sources: session.profileContext.sources.map(source => ({ kind: source.kind, id: source.id,
          name: redactForWire(source.name, 200), sha256: source.sha256, chars: source.chars })) } : undefined,
      program: session.program ? { ...session.program } : undefined,
      launchMode: session.launchChoice?.mode ?? 'agent',
      launchProfileId: session.launchProfileId,
      launchProfileName: session.launchProfileName ? redactForWire(session.launchProfileName, 200) : undefined,
      branch: session.branch ? redactForWire(session.branch, 200) : undefined,
      owner: !entry.control ? 'desktop' : entry.control.deviceId === deviceId ? 'self' : 'other' };
  }
  private visible(deviceId: string, session: SessionMeta): boolean {
    if (!session) return false;
    try {
      this.requireGrant(deviceId, session.scopeSource === 'terminal-home' ? { terminalHome: true } : session.projectWorkspaceId
        ? { projectWorkspaceId: session.projectWorkspaceId, profileId: session.launchProfileId }
        : { agentId: session.agentId, repositoryId: session.repositoryId ?? null });
      return true;
    } catch { return false; }
  }
  private requireGrant(id: string, selection?: Partial<MobileTerminalSelection> & { profileId?: string }): void {
    if (!this.allowed(id)) throw new RemoteApiError(403, 'scope_not_granted');
    if (selection) this.authorizeSelection(id, selection);
  }
  private release(entry: TerminalEntry): void { if (!entry.control) return; entry.control = undefined; this.changed({ sessionId: entry.sessionId, remote: false }); }
  private expire(): void {
    const sessions = this.port.list();
    for (const [id, entry] of this.entries) {
      if (entry.control && (entry.control.expiresAt <= this.now() || !this.allowed(entry.control.deviceId))) this.release(entry);
      if (!sessions.some((session) => session.id === entry.sessionId)) { this.release(entry); this.entries.delete(id); }
    }
  }
}
