import { randomUUID } from 'node:crypto';
import type { SessionMeta } from '../../shared/types';
import type { MobileTerminalCommand, MobileTerminalInput, MobileTerminalQuery, MobileTerminalState, MobileTerminalSummary, SessionLaunchChoice, SessionLaunchOptions, MobileWorkspaceSelection } from '../../shared/remote';
import { validSessionChoice } from '../../shared/sessionLaunch';
import type { TerminalControlState } from '../../shared/ipc';
import { isValidIdempotencyKey } from '../remote/authorization';
import type { DeviceAuditEntry } from '../remote/RemoteDeviceStore';
import { redactForWire } from '../errors';
import { RemoteApiError, type RemoteCommandContext } from './AdeApplicationService';
import { validWorkspaceSelection, workbenchDigest, type RemoteWorkbenchService, type WorkbenchScope } from './RemoteWorkbenchService';
import { remoteTerminalScreen } from './RemoteTerminalScreen';

export interface RemoteTerminalPort {
  list(): SessionMeta[];
  create(agentId: string, repositoryId: string | null, bindingId: string | undefined, mode: SessionLaunchChoice['mode'], model?: string): Promise<SessionMeta>;
  options?(selection: MobileWorkspaceSelection): Promise<SessionLaunchOptions>;
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
  const allowed = ['agentId', 'repositoryId', ...(kind === 'query' ? ['terminalId', 'options'] : kind === 'command' ? ['operation', ...(input.operation === 'open' ? ['mode', 'model'] : ['terminalId'])]
    : ['terminalId', 'leaseId', 'sequence', 'data', 'cols', 'rows'])];
  if (Object.keys(input).some((key) => !allowed.includes(key)) || !validWorkspaceSelection(input)
    || (input.terminalId !== undefined && (typeof input.terminalId !== 'string' || !ID.test(input.terminalId)))) throw new RemoteApiError(400, 'invalid_payload');
  if (kind === 'command' && (!['open', 'claim', 'release', 'close'].includes(String(input.operation))
    || (input.operation === 'open' ? !validSessionChoice(input) : typeof input.terminalId !== 'string'))) throw new RemoteApiError(400, 'invalid_payload');
  if (kind === 'query' && input.options !== undefined && input.options !== true) throw new RemoteApiError(400, 'invalid_payload');
  if (kind === 'input' && (typeof input.terminalId !== 'string' || typeof input.leaseId !== 'string' || !ID.test(input.leaseId)
    || !Number.isSafeInteger(input.sequence) || (input.sequence as number) < 1 || typeof input.data !== 'string' || Buffer.byteLength(input.data) > 2048 || input.data.includes('\0')
    || !Number.isInteger(input.cols) || (input.cols as number) < 20 || (input.cols as number) > 240
    || !Number.isInteger(input.rows) || (input.rows as number) < 5 || (input.rows as number) > 100)) throw new RemoteApiError(400, 'invalid_payload');
  return input as unknown as MobileTerminalQuery | MobileTerminalCommand | MobileTerminalInput;
}

/** Remote identities map to live interactive PTYs only inside main. No raw PTY ids on the wire. */
export class RemoteTerminalService {
  private readonly entries = new Map<string, TerminalEntry>();
  private readonly timer: ReturnType<typeof setInterval>;
  constructor(private readonly workbench: RemoteWorkbenchService, private readonly port: RemoteTerminalPort,
    private readonly allowed: (deviceId: string) => boolean, private readonly audit: (entry: DeviceAuditEntry) => void,
    private readonly changed: (state: TerminalControlState) => void = () => undefined, private readonly now = () => Date.now()) {
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

  async query(deviceId: string, input: MobileTerminalQuery): Promise<MobileTerminalState> {
    this.requireGrant(deviceId); this.expire();
    const binding = await this.workbench.resolve(input, true);
    const launchOptions = input.options ? await this.port.options?.(input) : undefined;
    this.requireGrant(deviceId);
    if (!binding) return { terminals: [], launchOptions };
    const sessions = this.port.list().filter((session) => session.kind === 'interactive' && !session.runTaskId && !session.remoteAccessBlocked
      && this.workbench.sessionMatches(binding, session));
    const terminals = sessions.slice(-32).filter((session) => this.entry(session, binding).workspaceVersion === this.workbench.version(binding))
      .map((session) => this.summary(this.entry(session, binding), session, deviceId));
    this.requireGrant(deviceId); await this.workbench.revalidate(binding);
    if (!input.terminalId) return { terminals, launchOptions };
    const entry = this.entries.get(input.terminalId); const session = sessions.find((item) => item.id === entry?.sessionId);
    if (!entry || !session || entry.workspaceVersion !== this.workbench.version(binding)) failure('Terminal ist nicht mehr verfügbar. Sitzungsliste aktualisieren.');
    const replay = this.port.attach(entry!.sessionId);
    const screen = await remoteTerminalScreen(Buffer.from(replay.replayBase64, 'base64'), entry!.cols, entry!.rows);
    this.requireGrant(deviceId); await this.workbench.revalidate(binding); this.expire();
    const own = entry!.control?.deviceId === deviceId ? entry!.control : undefined;
    return { terminals, launchOptions, selected: this.summary(entry!, session!, deviceId), screen, cols: entry!.cols, rows: entry!.rows,
      ...(own ? { leaseId: own.leaseId, lastSequence: own.sequence, inputUncertain: own.sequence > 0 && own.receipts.get(own.sequence)?.accepted !== true } : {}) };
  }

  async command(deviceId: string, input: MobileTerminalCommand): Promise<{ terminalId: string }> {
    this.requireGrant(deviceId); this.expire();
    const binding = await this.workbench.resolve(input, false, input.operation === 'open'); this.requireGrant(deviceId); let entry: TerminalEntry;
    if (this.workbench.managed(binding!) && input.operation !== 'release' && input.operation !== 'close') failure('Workspace ist durch einen verwalteten Auftrag belegt.');
    if (input.operation === 'open') {
      if (this.port.list().filter((session) => session.status === 'running').length >= 32) failure('Maximal 32 laufende Sitzungen. Zuerst eine Sitzung beenden.');
      this.requireGrant(deviceId);
      const session = await this.port.create(input.agentId, input.repositoryId, binding!.id, input.mode, input.mode === 'ollama' ? input.model : undefined);
      try { await this.workbench.revalidate(binding!); if (!this.workbench.sessionMatches(binding!, session)) failure('Workspace-Zuordnung hat sich geändert.'); }
      catch (error) { this.port.kill(session.id); throw error; }
      entry = this.entry(session, binding!);
      if (!this.allowed(deviceId)) { this.port.kill(session.id); failure('Terminalfreigabe wurde zurückgezogen.'); }
    } else {
      entry = this.requireEntry(input.terminalId, binding!);
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

  async input(context: RemoteCommandContext, input: MobileTerminalInput): Promise<{ sequence: number; replayed: boolean }> {
    const deviceId = context.principal.id; this.requireGrant(deviceId); this.expire();
    const binding = await this.workbench.resolve(input); const entry = this.requireEntry(input.terminalId, binding!);
    if (this.workbench.managed(binding!)) failure('Workspace ist durch einen verwalteten Auftrag belegt.');
    const control = entry.control;
    if (!control || control.deviceId !== deviceId || control.leaseId !== input.leaseId) failure('Eingabe wurde freigegeben oder übernommen. Erneut übernehmen.');
    const key = context.idempotencyKey;
    if (!key) throw new RemoteApiError(400, 'idempotency_key_required');
    if (!isValidIdempotencyKey(key)) throw new RemoteApiError(400, 'idempotency_key_invalid');
    const fingerprint = workbenchDigest(JSON.stringify(input)); const previous = control!.receipts.get(input.sequence);
    if (previous) {
      if (previous.key !== key || previous.fingerprint !== fingerprint) throw new RemoteApiError(409, 'idempotency_key_reused');
      if (!previous.accepted) throw new RemoteApiError(409, 'command_uncertain');
      return { sequence: input.sequence, replayed: true };
    }
    if (input.sequence !== control!.sequence + 1 || [...control!.receipts.values()].some((receipt) => receipt.key === key)) failure('Eingabereihenfolge ist unklar. Status prüfen; Eingabe wird nicht wiederholt.');
    await this.workbench.revalidate(binding!);
    this.requireGrant(deviceId); this.expire();
    if (entry.control !== control) failure('Eingabe wurde inzwischen übernommen.');
    if (this.workbench.managed(binding!)) failure('Workspace wurde inzwischen durch einen verwalteten Auftrag belegt.');
    const raced = control!.receipts.get(input.sequence);
    if (raced) {
      if (raced.key !== key || raced.fingerprint !== fingerprint) throw new RemoteApiError(409, 'idempotency_key_reused');
      if (!raced.accepted) throw new RemoteApiError(409, 'command_uncertain');
      return { sequence: input.sequence, replayed: true };
    }
    if (input.sequence !== control!.sequence + 1) failure('Eingabereihenfolge hat sich geändert.');
    // No await from receipt reservation through write. A crash loses this live lease,
    // so old input cannot be replayed into a new process. Audit never contains input.
    const audit: DeviceAuditEntry = { at: this.now(), principalId: deviceId, principalKind: 'device', requestId: context.requestId,
      channel: 'terminal:input', target: entry.id, outcome: 'requested' };
    this.audit(audit);
    if (control!.sequence > 0 && control!.receipts.get(control!.sequence)?.accepted !== true) throw new RemoteApiError(409, 'command_uncertain');
    const receipt = { key, fingerprint, accepted: false };
    control!.sequence = input.sequence; control!.receipts.set(input.sequence, receipt);
    if (control!.receipts.size > 128) control!.receipts.delete(control!.receipts.keys().next().value!);
    entry.cols = input.cols; entry.rows = input.rows;
    this.port.resize(entry.sessionId, input.cols, input.rows);
    this.port.write(entry.sessionId, Buffer.from(input.data, 'utf8'));
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
  private summary(entry: TerminalEntry, session: SessionMeta, deviceId: string): MobileTerminalSummary {
    return { id: entry.id, title: redactForWire(session.title, 100), status: session.status,
      owner: !entry.control ? 'desktop' : entry.control.deviceId === deviceId ? 'self' : 'other' };
  }
  private requireGrant(id: string): void { if (!this.allowed(id)) throw new RemoteApiError(403, 'scope_not_granted'); }
  private release(entry: TerminalEntry): void { if (!entry.control) return; entry.control = undefined; this.changed({ sessionId: entry.sessionId, remote: false }); }
  private expire(): void {
    const sessions = this.port.list();
    for (const [id, entry] of this.entries) {
      if (entry.control && (entry.control.expiresAt <= this.now() || !this.allowed(entry.control.deviceId))) this.release(entry);
      if (!sessions.some((session) => session.id === entry.sessionId)) { this.release(entry); this.entries.delete(id); }
    }
  }
}
