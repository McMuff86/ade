import { chmodSync, closeSync, constants, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, opendirSync, readSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, join, relative } from 'node:path';
import type { AdeConfig, SessionMeta, WorkspaceBinding } from '../../shared/types';
import type { MobileWorkspaceEntry, MobileWorkspaceFile, MobileWorkspaceQuery, MobileWorkspaceResult, MobileWorkspaceSelection } from '../../shared/remote';
import { ExecutionBackendService } from '../execution/ExecutionBackendService';
import { assertNoLinks } from '../repositories/pathDiscipline';
import { workspaceOperations } from '../repositories/WorkspaceOperationGate';
import { redactForWire } from '../errors';
import { RemoteApiError } from './AdeApplicationService';
import type { MobileFileSaveInput } from '../../shared/remote';
import { agentHomeBackend, homeWorkspace } from '../repositories/RepositoryScopeService';
import type { ExecutionBackendId } from '../../shared/executionBackends';
import { remoteWslWorkspace } from './RemoteWslWorkspace';

export type WorkbenchScope = Pick<WorkspaceBinding, 'agentId' | 'workspaceDir' | 'executionBackend'>
  & Partial<Pick<WorkspaceBinding, 'id' | 'repositoryId' | 'status'>> & { rootIdentity?: string };
export const validWorkspaceSelection = (input: Record<string, unknown>): boolean =>
  typeof input.agentId === 'string' && /^[A-Za-z0-9_.:-]{1,128}$/.test(input.agentId)
  && (input.repositoryId === null || typeof input.repositoryId === 'string' && /^[A-Za-z0-9_.:-]{1,128}$/.test(input.repositoryId));

const TEXT_BYTES = 24 * 1024;
const DIFF_CHARS = 64 * 1024;
const EXCLUDED = /^(?:\.git|\.ssh|\.aws|\.azure|\.gnupg|\.env(?:\..*)?|\.npmrc|\.netrc|\.pypirc|node_modules|credentials(?:\..*)?|secrets?(?:\..*)?|id_rsa|id_ed25519)$/i;
const SECRET_EXTENSION = /\.(?:pem|key|p12|pfx|keystore)$/i;
export const workbenchDigest = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex');
const reject = (message: string): never => { throw new RemoteApiError(422, 'command_rejected', message); };

/** Strict portable relative paths. Secret/metadata entries are absent from discovery too. */
export function workbenchPath(value: unknown, allowRoot = false): string {
  if (value === '' && allowRoot) return '';
  if (typeof value !== 'string' || !value || value.length > 400 || /[\\:\x00-\x1f\x7f]/.test(value)
    || redactForWire(value, 500) !== value || value.split('/').some((part) => !part || part === '.' || part === '..'
      || /[. ]$/.test(part) || /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(part)
      || EXCLUDED.test(part) || SECRET_EXTENSION.test(part))) reject('Dieser Pfad ist für den Remote-Workspace nicht verfügbar.');
  return value as string;
}

export function validateWorkbenchQuery(value: unknown): MobileWorkspaceQuery {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new RemoteApiError(400, 'invalid_payload');
  const input = value as Record<string, unknown>;
  const extra = input.operation === 'tree' || input.operation === 'file' ? ['path']
    : input.operation === 'diff' ? ['path', 'staged'] : input.operation === 'search' ? ['search'] : [];
  if (!['overview', 'tree', 'file', 'diff', 'search'].includes(String(input.operation))
    || Object.keys(input).some((key) => !['operation', 'agentId', 'repositoryId', ...extra].includes(key))
    || !validWorkspaceSelection(input)) {
    throw new RemoteApiError(400, 'invalid_payload');
  }
  if (extra.includes('path')) workbenchPath(input.path, input.operation === 'tree');
  if (input.operation === 'diff' && typeof input.staged !== 'boolean') throw new RemoteApiError(400, 'invalid_payload');
  if (input.operation === 'search' && (typeof input.search !== 'string' || !input.search.trim() || input.search.length > 80
    || /[\x00-\x1f]/.test(input.search))) throw new RemoteApiError(400, 'invalid_payload');
  return input as unknown as MobileWorkspaceQuery;
}

export function validateFileSave(value: unknown): MobileFileSaveInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new RemoteApiError(400, 'invalid_payload');
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some((key) => !['agentId', 'repositoryId', 'path', 'workspaceVersion', 'revision', 'text'].includes(key))
    || !validWorkspaceSelection(input)
    || ![input.workspaceVersion, input.revision].every((id) => typeof id === 'string' && /^[a-f0-9]{64}$/.test(id))
    || typeof input.text !== 'string' || Buffer.byteLength(input.text) > TEXT_BYTES || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(input.text)
    || Buffer.from(input.text, 'utf8').toString('utf8') !== input.text) throw new RemoteApiError(400, 'invalid_payload');
  workbenchPath(input.path); return input as unknown as MobileFileSaveInput;
}

/** Explicit catalog binding or configured home; never follows agent-memory fallbacks. */
export class RemoteWorkbenchService {
  constructor(readonly store: { get(): AdeConfig }, readonly sessions: () => SessionMeta[],
    readonly execution = new ExecutionBackendService()) {}

  async save(input: MobileFileSaveInput, authorize: () => void): Promise<{ saved: boolean; revision: string }> {
    return workspaceOperations.mutate(async () => {
      const binding = (await this.resolve(input))!;
      if (this.version(binding) !== input.workspaceVersion) reject('Workspace-Zuordnung hat sich geändert. Datei neu öffnen.');
      if (this.busy(binding)) reject('Workspace wird von einem Agenten oder Terminal verwendet. Sitzung zuerst beenden.');
      await this.revalidate(binding);
      authorize();
      const current = await this.readScoped(binding, input.path);
      if (!current.editable) reject('Diese Datei ist nur lesbar.');
      if (current.revision !== input.revision) return { saved: false, revision: current.revision };
      const eol = current.text.includes('\r\n') ? '\r\n' : '\n';
      const bom = current.text.startsWith('\uFEFF') ? '\uFEFF' : '';
      const text = bom + input.text.replace(/^\uFEFF/, '').replace(/\r\n|\r|\n/g, eol);
      const bytes = Buffer.from(text, 'utf8'); if (bytes.length > TEXT_BYTES) reject('Datei darf nach dem Speichern höchstens 24 KiB gross sein.');
      if (binding.executionBackend !== 'native') {
        await this.revalidate(binding); authorize();
        if (this.busy(binding)) reject('Workspace wurde inzwischen belegt.');
        const result = await remoteWslWorkspace(this.execution, binding.executionBackend, binding.workspaceDir, 'save',
          { identity: binding.rootIdentity, path: input.path, revision: input.revision, bytes: bytes.toString('base64') });
        await this.revalidate(binding); authorize();
        return { saved: result.saved === true, revision: result.revision! };
      }
      const abs = this.path(binding, input.path); const stat = lstatSync(abs);
      const temp = join(dirname(abs), `.ade-edit-${randomUUID()}.tmp`);
      try {
        assertNoLinks(temp); const fd = openSync(temp, 'wx', stat.mode & 0o777);
        try { writeFileSync(fd, bytes); fsyncSync(fd); } finally { closeSync(fd); }
        chmodSync(temp, stat.mode & 0o777);
        // Synchronous final check through replace; ADE launches/Git updates are fenced.
        authorize(); this.path(binding, input.path); assertNoLinks(temp);
        if (this.busy(binding)) reject('Workspace wurde inzwischen belegt.');
        const latest = this.read(binding, input.path);
        if (latest.revision !== input.revision) return { saved: false, revision: latest.revision };
        renameSync(temp, abs);
        if (process.platform !== 'win32') { const parent = openSync(dirname(abs), 'r'); try { fsyncSync(parent); } finally { closeSync(parent); } }
        return { saved: true, revision: workbenchDigest(bytes) };
      } finally { try { unlinkSync(temp); } catch { /* Renamed or never created. */ } }
    });
  }

  async query(input: MobileWorkspaceQuery): Promise<MobileWorkspaceResult> {
    return workspaceOperations.use(async () => {
      const binding = await this.resolve(input, input.operation === 'overview');
      if (!binding) return { workspaceVersion: '', overview: { ready: false, workspaceVersion: '', branch: '', busy: false,
        changes: [], commits: [], notice: input.repositoryId === null ? 'Der eigene Ordner ist noch nicht vorhanden. Unter Terminal eine Sitzung öffnen, um ihn anzulegen.' : 'Noch kein Workspace für diesen Agent und dieses Projekt. Unter Verwalten → Projekte & Workspaces vorbereiten.' } };
      const workspaceVersion = this.version(binding);
      let result: MobileWorkspaceResult = { workspaceVersion };
      if (input.operation === 'overview' && !binding.repositoryId) {
        result.overview = { ready: true, workspaceVersion, branch: '', busy: this.busy(binding), changes: [], commits: [],
          notice: 'Eigener Workspace ohne Projekt · ' + (binding.executionBackend === 'native' ? 'Native Umgebung' : redactForWire(binding.executionBackend, 150)) };
      } else if (input.operation === 'overview') {
        const [status, branch, history] = await Promise.all([
          this.git(binding, ['status', '--porcelain=v1', '-z', '--untracked-files=all']),
          this.git(binding, ['rev-parse', '--abbrev-ref', 'HEAD']),
          this.git(binding, ['log', '-12', '--format=%H%x00%s']),
        ]);
        const records = status.split('\0'); const changes: NonNullable<MobileWorkspaceResult['overview']>['changes'] = [];
        let omitted = false;
        for (let index = 0; index < records.length; index++) {
          const record = records[index]!; if (!record) continue;
          const state = record.slice(0, 2); const path = record.slice(3);
          if (/[RC]/.test(state)) index++;
          try { workbenchPath(path); this.path(binding, path, true); }
          catch { omitted = true; continue; }
          if (changes.length === 500) { omitted = true; break; }
          changes.push({ path, state, staged: state[0] !== ' ' && state[0] !== '?', unstaged: state[1] !== ' ' });
        }
        const commits = history.trim().split('\n').filter(Boolean).map((line) => {
          const [sha, ...subject] = line.split('\0'); return { sha: sha!, subject: redactForWire(subject.join(' '), 200) };
        }).filter((commit) => /^[a-f0-9]{40,64}$/.test(commit.sha));
        result.overview = { ready: true, workspaceVersion, branch: redactForWire(branch.trim(), 200),
          busy: this.busy(binding), changes, commits, notice: omitted ? 'Einträge sind begrenzt; geschützte Dateien werden ausgelassen.' : null };
      } else if (input.operation === 'file') result.file = await this.readScoped(binding, input.path);
      else if (input.operation === 'diff') {
        if (!binding.repositoryId) reject('Git-Änderungen benötigen ein ausgewähltes Projekt.');
        this.path(binding, input.path, true);
        const raw = await this.git(binding, ['diff', '--no-ext-diff', '--no-textconv', '--no-color', ...(input.staged ? ['--cached'] : []), '--', input.path]);
        result.diff = redactForWire(raw, DIFF_CHARS);
        result.limited = raw.length > DIFF_CHARS;
        if (!raw && !input.staged) {
          const tracked = await this.git(binding, ['ls-files', '--', input.path]);
          if (!tracked) {
            const file = this.read(binding, input.path);
            result.diff = file.notice ?? file.text.split('\n').map((line) => `+${line}`).join('\n');
          }
        }
      } else if (binding.executionBackend !== 'native') {
        const listing = await remoteWslWorkspace(this.execution, binding.executionBackend, binding.workspaceDir, input.operation,
          { identity: binding.rootIdentity, ...(input.operation === 'tree' ? { path: input.path } : { search: input.search }) });
        result.entries = (listing.entries ?? []).filter((entry) => { try { workbenchPath(entry.path); return true; } catch { return false; } });
        result.entries.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'directory' ? -1 : 1) || a.path.localeCompare(b.path));
        result.limited = listing.limited;
      } else {
        const entries: MobileWorkspaceEntry[] = []; let visited = 0; let limited = false;
        const walk = (directory: string, depth: number): void => {
          if (depth > 12 || visited >= 2000) { limited = true; return; }
          const abs = this.path(binding, directory); const dir = opendirSync(abs);
          try {
            for (;;) {
              const entry = dir.readSync(); if (!entry) break;
              if (++visited > 2000 || entries.length >= 500) { limited = true; break; }
              const path = directory ? `${directory}/${entry.name}` : entry.name;
              try { workbenchPath(path); this.path(binding, path); } catch { continue; }
              if (!entry.isDirectory() && !entry.isFile()) continue;
              if (input.operation === 'tree' || path.toLocaleLowerCase().includes(input.search.toLocaleLowerCase())) {
                entries.push({ path, name: entry.name, kind: entry.isDirectory() ? 'directory' : 'file' });
              }
              if (input.operation === 'search' && entry.isDirectory()) walk(path, depth + 1);
            }
          } finally { dir.closeSync(); }
        };
        walk(input.operation === 'tree' ? input.path : '', 0);
        entries.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'directory' ? -1 : 1) || a.path.localeCompare(b.path));
        result = { ...result, entries, limited };
      }
      await this.revalidate(binding);
      return result;
    });
  }

  async resolve(input: MobileWorkspaceSelection, optional = false, prepareHome = false): Promise<WorkbenchScope | null> {
    const config = this.store.get();
    const agent = config.agents.find((agent) => agent.id === input.agentId);
    if (!agent) return reject('Agent ist nicht mehr vorhanden.');
    if (input.repositoryId === null) {
      const scope: WorkbenchScope = { agentId: agent.id, workspaceDir: homeWorkspace(agent), executionBackend: agentHomeBackend(agent) };
      if (prepareHome && this.managed(scope)) reject('Workspace ist durch einen verwalteten Auftrag belegt.');
      const identity = await this.homeIdentity(scope, prepareHome);
      if (!identity) { if (optional) return null; return reject('Eigener Ordner fehlt. Zuerst eine Terminalsitzung öffnen.'); }
      scope.rootIdentity = identity; await this.revalidate(scope); return scope;
    }
    const repo = config.repositories.find((item) => item.id === input.repositoryId);
    if (!repo || repo.executionBackend !== 'native' || !repo.verified) reject('Dieser Zugriff benötigt ein geprüftes natives Projekt.');
    assertNoLinks(repo!.rootPath); assertNoLinks(repo!.commonGitDir);
    const binding = config.workspaceBindings.find((item) => item.agentId === input.agentId && item.repositoryId === input.repositoryId);
    if (!binding) { if (optional) return null; reject('Workspace zuerst unter Verwalten vorbereiten.'); }
    await this.revalidate(binding!); return { ...binding! };
  }

  version(binding: WorkbenchScope): string {
    return workbenchDigest(JSON.stringify([binding.id, binding.agentId, binding.repositoryId, binding.workspaceDir, binding.executionBackend, binding.rootIdentity]));
  }

  async revalidate(binding: WorkbenchScope): Promise<void> {
    if (!binding.repositoryId) {
      const agent = this.store.get().agents.find((item) => item.id === binding.agentId);
      if (!agent || agentHomeBackend(agent) !== binding.executionBackend
        || !this.execution.samePath(binding.executionBackend, homeWorkspace(agent), binding.workspaceDir)
        || !binding.rootIdentity || await this.homeIdentity(binding) !== binding.rootIdentity) reject('Eigener Workspace hat sich geändert. Neu öffnen.');
      return;
    }
    const config = this.store.get(); const current = config.workspaceBindings.find((item) => item.id === binding.id);
    const repo = config.repositories.find((item) => item.id === binding.repositoryId);
    if (!current || this.version(current) !== this.version(binding) || !repo || repo.executionBackend !== 'native'
      || !repo.verified || binding.status !== 'ready' || binding.executionBackend !== 'native' || !config.agents.some((agent) => agent.id === binding.agentId)) reject('Workspace-Zuordnung hat sich geändert. Neu öffnen.');
    assertNoLinks(repo!.rootPath); assertNoLinks(repo!.commonGitDir); assertNoLinks(binding.workspaceDir);
    assertNoLinks(join(binding.workspaceDir, '.git'));
    const [top, common] = await Promise.all([
      this.git(binding, ['rev-parse', '--show-toplevel']), this.git(binding, ['rev-parse', '--path-format=absolute', '--git-common-dir']),
    ]);
    assertNoLinks(common.trim());
    if (!this.execution.samePath('native', top.trim(), binding.workspaceDir)
      || !this.execution.samePath('native', common.trim(), repo!.commonGitDir)) reject('Git-Zuordnung hat sich geändert. Am PC prüfen.');
    const latest = this.store.get().workspaceBindings.find((item) => item.id === binding.id);
    if (!latest || this.version(latest) !== this.version(binding)) reject('Workspace-Zuordnung hat sich geändert.');
    assertNoLinks(binding.workspaceDir);
  }

  busy(binding: WorkbenchScope): boolean {
    const same = (item: { workspaceBindingId?: string; workspaceDir?: string; executionBackend?: ExecutionBackendId }) =>
      !!binding.id && item.workspaceBindingId === binding.id
      || (item.executionBackend ?? 'native') === binding.executionBackend && !!item.workspaceDir && this.execution.samePath(binding.executionBackend, item.workspaceDir, binding.workspaceDir);
    return this.managed(binding)
      || this.sessions().some((item) => item.status === 'running' && same(item));
  }

  managed(binding: WorkbenchScope): boolean {
    return this.store.get().runWorkspaceLeases.some((lease) => lease.status === 'active' && (!!binding.id && lease.workspaceBindingId === binding.id
      || (this.store.get().repositories.find((repo) => repo.id === lease.repositoryId)?.executionBackend ?? 'native') === binding.executionBackend
        && this.execution.samePath(binding.executionBackend, lease.workspaceDir, binding.workspaceDir)));
  }

  sessionMatches(binding: WorkbenchScope, session: SessionMeta): boolean {
    return session.agentId === binding.agentId && session.repositoryId === binding.repositoryId
      && session.workspaceBindingId === binding.id && (session.executionBackend ?? 'native') === binding.executionBackend
      && !!session.workspaceDir && this.execution.samePath(binding.executionBackend, session.workspaceDir, binding.workspaceDir);
  }

  private async homeIdentity(scope: WorkbenchScope, create = false): Promise<string | null> {
    if (scope.executionBackend !== 'native') {
      const result = await remoteWslWorkspace(this.execution, scope.executionBackend, scope.workspaceDir, 'probe', { create });
      return result.missing ? null : result.identity;
    }
    assertNoLinks(scope.workspaceDir);
    if (create) mkdirSync(scope.workspaceDir, { recursive: true });
    try { const stat = lstatSync(scope.workspaceDir, { bigint: true }); if (!stat.isDirectory()) reject('Eigener Workspace ist kein Ordner.'); return `${stat.dev}:${stat.ino}`; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
  }

  private async readScoped(binding: WorkbenchScope, path: string): Promise<MobileWorkspaceFile> {
    if (binding.executionBackend === 'native') return this.read(binding, path);
    const file = await remoteWslWorkspace(this.execution, binding.executionBackend, binding.workspaceDir, 'read', { path, identity: binding.rootIdentity });
    return this.decodeFile(path, file.large ? Buffer.alloc(TEXT_BYTES + 1) : Buffer.from(file.bytes!, 'base64'));
  }

  path(binding: WorkbenchScope, path: string, missing = false): string {
    if (binding.executionBackend !== 'native') reject('Dieser Zugriff benötigt die native Umgebung.');
    workbenchPath(path, true); const abs = join(binding.workspaceDir, path);
    if (relative(binding.workspaceDir, abs).startsWith('..')) reject('Ungültiger Workspace-Pfad.');
    assertNoLinks(abs);
    try { const stat = lstatSync(abs); if (stat.isSymbolicLink() || (stat.isFile() && stat.nlink > 1)) reject('Verknüpfte Dateien sind nicht verfügbar.'); }
    catch (error) { if (!missing || (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    return abs;
  }

  read(binding: WorkbenchScope, path: string): MobileWorkspaceFile {
    const abs = this.path(binding, path);
    const fd = openSync(abs, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const stat = fstatSync(fd);
      if (!stat.isFile() || stat.nlink > 1) reject('Nur normale Textdateien können geöffnet werden.');
      if (stat.size > TEXT_BYTES) return { path, text: '', revision: '', editable: false, notice: 'Datei ist grösser als 24 KiB. Am Desktop öffnen.' };
      // A file may grow after fstat; cap the actual allocation and I/O too.
      const buffer = Buffer.alloc(TEXT_BYTES + 1); let length = 0;
      while (length < buffer.length) {
        const count = readSync(fd, buffer, length, buffer.length - length, length);
        if (!count) break; length += count;
      }
      if (length > TEXT_BYTES) return { path, text: '', revision: '', editable: false, notice: 'Datei ist grösser als 24 KiB. Am Desktop öffnen.' };
      return this.decodeFile(path, buffer.subarray(0, length));
    } finally { closeSync(fd); }
  }

  private decodeFile(path: string, raw: Buffer): MobileWorkspaceFile {
      if (raw.length > TEXT_BYTES) return { path, text: '', revision: '', editable: false, notice: 'Datei ist grösser als 24 KiB. Am Desktop öffnen.' };
      const text = raw.toString('utf8');
      if (raw.includes(0) || !Buffer.from(text, 'utf8').equals(raw)) return { path, text: '', revision: '', editable: false, notice: 'Binärdatei oder nicht unterstützte Textkodierung.' };
      const safe = redactForWire(text, TEXT_BYTES); const changed = safe !== text;
      const mixed = text.includes('\r') && (!text.includes('\r\n') || /(?<!\r)\n|\r(?!\n)/.test(text));
      return { path, text: safe, revision: workbenchDigest(raw), editable: !changed && !mixed,
        notice: changed ? 'Inhalt enthält ausgeblendete Zugangsdaten oder Host-Pfade und ist nur lesbar.' : mixed ? 'Gemischte oder nicht unterstützte Zeilenenden: nur lesbar.' : null };
  }

  private async git(binding: WorkbenchScope, args: string[]): Promise<string> {
    assertNoLinks(binding.workspaceDir); assertNoLinks(join(binding.workspaceDir, '.git'));
    const result = await this.execution.checked('native', 'git', ['--literal-pathspecs', '-c', 'core.fsmonitor=false',
      '-c', 'core.untrackedCache=false', ...args], { cwd: binding.workspaceDir, timeoutMs: 15_000,
      maxBuffer: 256 * 1024, env: { GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' } });
    return result.stdout.toString('utf8');
  }
}
