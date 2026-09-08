import { randomUUID } from 'node:crypto';
import { existsSync, lstatSync } from 'node:fs';
import { join, parse, posix, resolve } from 'node:path';
import type { AdeConfig, Repository, SessionMeta } from '../../shared/types';
import { normalizeExecutionBackendId } from '../../shared/executionBackends';
import type { GitSyncOverview, GitSyncPreview, GitSyncRequest, GitSyncTarget } from '../../shared/gitSync';
import { validSyncRef } from '../../shared/gitSync';
import { ExecutionBackendService, decodeOutput } from '../execution/ExecutionBackendService';
import { BackendGitService } from '../execution/BackendGitService';
import { redactedErrorDetail } from '../errors';
import { hostNullDevice } from '../platform';
import { workspaceOperations, type WorkspaceOperationGate } from './WorkspaceOperationGate';

const SHA = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const TTL = 5 * 60 * 1000;
const ROOT = 'repository';
interface Target { id: string; name: string; kind: 'repository' | 'agent'; path: string; branch?: string; backend?: string }
interface StoredPreview { value: GitSyncPreview; root: string; common: string; path: string }

/** Explicit desktop-only Git mutations. All arguments derive from validated catalog identities. */
export class RepositorySyncService {
  private readonly previews = new Map<string, StoredPreview>();
  private readonly fetched = new Map<string, number>();
  private readonly git: BackendGitService;
  constructor(
    private readonly store: { get(): AdeConfig },
    private readonly sessions: () => SessionMeta[],
    private readonly execution = new ExecutionBackendService(),
    private readonly gate: WorkspaceOperationGate = workspaceOperations,
  ) { this.git = new BackendGitService(execution); }

  async overview(input: GitSyncRequest): Promise<GitSyncOverview> {
    const repository = await this.repository(input.repositoryId);
    const rawRefs = await this.command(repository, repository.rootPath, [
      'for-each-ref', '--count=101', '--format=%(refname)', 'refs/heads', 'refs/remotes/origin',
    ]);
    const refs = rawRefs.trim().split(/\r?\n/).filter((ref) => validSyncRef(ref) && ref !== 'refs/remotes/origin/HEAD');
    if (refs.length > 100) throw new Error('ade: Zu viele Branches für diese Ansicht (maximal 100).');
    const currentBranch = (await this.command(repository, repository.rootPath, ['branch', '--show-current'])).trim();
    const sourceRef = input.sourceRef ?? (currentBranch ? `refs/heads/${currentBranch}` : refs[0] ?? '');
    if (!refs.includes(sourceRef)) throw new Error('ade: Gewählter Basis-Branch ist nicht mehr vorhanden. Ansicht aktualisieren.');
    const sourceSha = await this.resolve(repository, sourceRef);
    const targets: GitSyncTarget[] = [];
    for (const target of this.targets(repository)) {
      try { targets.push(await this.inspect(repository, target, sourceSha)); }
      catch (error) {
        console.warn('[ade] Git sync target inspection failed:', redactedErrorDetail(error));
        targets.push({ id: target.id, name: target.name, kind: target.kind, branch: target.branch ?? '',
          headSha: null, changedFiles: null, ahead: null, behind: null, blockedReason: 'Worktree nicht lesbar oder Repository-Zuordnung ungültig.' });
      }
    }
    return { repositoryId: repository.id, repositoryName: repository.name,
      executionBackend: normalizeExecutionBackendId(repository.executionBackend), checkedAt: Date.now(),
      remoteCheckedAt: this.fetched.get(repository.id) ?? null, sourceRef, sourceSha,
      refs: refs.map((ref) => ({ ref, label: ref.startsWith('refs/heads/')
        ? `Lokal · ${ref.slice(11)}` : `Remote · ${ref.slice(13)}` })), targets };
  }

  async fetch(repositoryId: string): Promise<GitSyncOverview> {
    return this.gate.mutate(async () => {
      const repository = await this.repository(repositoryId);
      // A configured fetch refspec could overwrite local branches. Supply ADE's own
      // remote-tracking-only refspec; no tags, recursive submodules or pruning.
      const urls = (await this.command(repository, repository.rootPath, ['config', '--get-all', 'remote.origin.url'])).trim().split(/\r?\n/);
      if (urls.length !== 1 || !urls[0]) throw new Error('ade: Fetch benötigt genau einen origin-Remote.');
      await this.command(repository, repository.rootPath, [
        'fetch', '--no-tags', '--no-prune', '--no-recurse-submodules', '--refmap=', '--', 'origin', '+refs/heads/*:refs/remotes/origin/*',
      ], 60_000);
      this.fetched.set(repository.id, Date.now());
      this.previews.clear();
      console.log(`[ade] repository fetch completed repository=${repository.id}`);
      return this.overview({ repositoryId });
    });
  }

  async preview(input: GitSyncRequest & { targetId: string }): Promise<GitSyncPreview> {
    const overview = await this.overview(input);
    const target = overview.targets.find((item) => item.id === input.targetId);
    if (!target || target.blockedReason || target.behind === 0) throw new Error(`ade: ${target?.blockedReason ?? 'Kein Fast-forward verfügbar.'}`);
    const repository = await this.repository(input.repositoryId);
    const resolved = this.targets(repository).find((item) => item.id === target.id)!;
    const value = { id: randomUUID(), expiresAt: Date.now() + TTL, overview, target };
    for (const [id, entry] of this.previews) if (entry.value.expiresAt < Date.now()) this.previews.delete(id);
    if (this.previews.size >= 20) this.previews.delete(this.previews.keys().next().value!);
    this.previews.set(value.id, { value, root: repository.rootPath, common: repository.commonGitDir, path: resolved.path });
    return value;
  }

  async apply(previewId: string): Promise<GitSyncOverview> {
    return this.gate.mutate(async () => {
      const stored = this.previews.get(previewId);
      this.previews.delete(previewId);
      if (!stored || stored.value.expiresAt < Date.now()) throw new Error('ade: Vorschau abgelaufen. Erneut prüfen.');
      const before = stored.value;
      const repository = await this.repository(before.overview.repositoryId);
      const target = this.targets(repository).find((item) => item.id === before.target.id);
      if (!target || target.path !== stored.path || repository.rootPath !== stored.root || repository.commonGitDir !== stored.common) {
        throw new Error('ade: Repository-Zuordnung geändert. Erneut prüfen.');
      }
      const sourceSha = await this.resolve(repository, before.overview.sourceRef);
      if (sourceSha !== before.overview.sourceSha) throw new Error('ade: Basis-Branch seit der Vorschau geändert. Erneut prüfen.');
      const current = await this.inspect(repository, target, sourceSha);
      if (current.blockedReason || current.headSha !== before.target.headSha || current.branch !== before.target.branch) {
        throw new Error(`ade: ${current.blockedReason ?? 'Ziel-Branch seit der Vorschau geändert. Erneut prüfen.'}`);
      }
      await this.command(repository, target.path, [
        'merge', '--ff-only', '--no-edit', '--no-stat', '--no-autostash', '--no-overwrite-ignore', sourceSha,
      ]);
      const after = await this.inspect(repository, target, sourceSha);
      if (after.headSha !== sourceSha || after.changedFiles !== 0 || after.branch !== current.branch) {
        throw new Error('ade: Git-Update konnte nicht sauber bestätigt werden. Aktuellen Stand prüfen.');
      }
      this.previews.clear();
      console.log(`[ade] repository fast-forward repository=${repository.id} target=${target.id} from=${current.headSha} to=${sourceSha}`);
      return this.overview({ repositoryId: repository.id, sourceRef: before.overview.sourceRef });
    });
  }

  private targets(repository: Repository): Target[] {
    const config = this.store.get();
    const bindings = config.workspaceBindings.filter((item) => item.repositoryId === repository.id && item.status !== 'invalid');
    if (bindings.length > 32) throw new Error('ade: Maximal 32 Agent-Worktrees pro Vergleich.');
    return [{ id: ROOT, name: 'Hauptrepository', kind: 'repository', path: repository.rootPath },
      ...bindings.map((item): Target => ({ id: item.id, kind: 'agent', path: item.workspaceDir, branch: item.branch, backend: item.executionBackend,
        name: config.agents.find((agent) => agent.id === item.agentId)?.name ?? 'Agent' }))];
  }

  private async inspect(repository: Repository, target: Target, sourceSha: string): Promise<GitSyncTarget> {
    if (target.backend && target.backend !== normalizeExecutionBackendId(repository.executionBackend)) throw new Error('ade: Worktree-Backend stimmt nicht überein.');
    await this.assertNoLinks(repository, this.dotGit(repository, target.path));
    const identity = await this.git.identity(repository.executionBackend, target.path);
    if (!this.execution.samePath(repository.executionBackend, identity.commonGitDir, repository.commonGitDir)) {
      throw new Error('ade: Worktree gehört nicht mehr zum ausgewählten Repository.');
    }
    const branch = (await this.command(repository, target.path, ['branch', '--show-current'])).trim();
    const headSha = (await this.command(repository, target.path, ['rev-parse', '--verify', 'HEAD'])).trim();
    if (!SHA.test(headSha)) throw new Error('ade: Ungültiger Git-Stand.');
    const status = await this.command(repository, target.path, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignore-submodules=none']);
    // Count status records (renames have a second NUL-delimited pathname).
    const records = status.split('\0');
    let changedFiles = 0;
    for (let i = 0; i < records.length; i++) {
      if (!records[i]) continue;
      changedFiles++;
      if (/[RC]/.test(records[i]!.slice(0, 2))) i++;
    }
    const counts = (await this.command(repository, target.path, ['rev-list', '--left-right', '--count', `${headSha}...${sourceSha}`])).trim().split(/\s+/).map(Number);
    if (counts.length !== 2 || counts.some((value) => !Number.isSafeInteger(value) || value < 0)) throw new Error('ade: Git-Vergleich fehlgeschlagen.');
    const config = this.store.get();
    const same = (path: string): boolean => this.execution.samePath(repository.executionBackend, path, target.path);
    const leased = config.runWorkspaceLeases.some((lease) => lease.status === 'active' && same(lease.workspaceDir));
    const live = this.sessions().some((session) => session.status === 'running' && session.workspaceDir && same(session.workspaceDir));
    const gitDir = (await this.command(repository, target.path, ['rev-parse', '--absolute-git-dir'])).trim();
    await this.assertNoLinks(repository, gitDir);
    const stateNames = ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'rebase-merge', 'rebase-apply', 'sequencer', 'index.lock'];
    const inProgress = normalizeExecutionBackendId(repository.executionBackend) === 'native'
      ? stateNames.some((name) => existsSync(join(gitDir, name)))
      : (await this.execution.text(repository.executionBackend, 'python3', ['-c',
        'import os,sys; print(int(any(os.path.lexists(os.path.join(sys.argv[1],n)) for n in sys.argv[2:])))', gitDir, ...stateNames],
      { timeoutMs: 10_000, maxBuffer: 1024 })).trim() === '1';
    const blockedReason = leased ? 'Worktree gehört zu einem aktiven Run.'
      : live ? 'Terminal läuft in diesem Worktree. Session zuerst schliessen.'
        : !branch ? 'Detached HEAD: kein ausgecheckter Branch.'
          : target.branch && branch !== target.branch ? 'Agent-Branch wurde ausserhalb von ADE gewechselt.'
            : inProgress ? 'Git-Operation ist noch nicht abgeschlossen (Merge, Rebase oder Lock).'
              : changedFiles > 0 ? `${changedFiles} uncommittete Änderungen. Zuerst prüfen und sichern.`
                : counts[0]! > 0 ? 'Eigene Commits: automatischer Fast-forward ist nicht möglich.' : null;
    return { id: target.id, name: target.name, kind: target.kind, branch, headSha, changedFiles,
      ahead: counts[0]!, behind: counts[1]!, blockedReason };
  }

  private async repository(id: string): Promise<Repository> {
    const repository = this.store.get().repositories.find((item) => item.id === id && item.verified);
    if (!repository) throw new Error('ade: Verifiziertes Repository nicht gefunden.');
    await this.assertNoLinks(repository, this.dotGit(repository, repository.rootPath));
    await this.assertNoLinks(repository, repository.commonGitDir);
    const actual = await this.git.identity(repository.executionBackend, repository.rootPath);
    if (!this.execution.samePath(repository.executionBackend, actual.rootPath, repository.rootPath)
      || !this.execution.samePath(repository.executionBackend, actual.commonGitDir, repository.commonGitDir)) {
      throw new Error('ade: Repository-Identität hat sich geändert.');
    }
    return repository;
  }
  private async assertNoLinks(repository: Repository, path: string): Promise<void> {
    if (normalizeExecutionBackendId(repository.executionBackend) === 'native') { assertNativeNoLinks(path); return; }
    const canonical = await this.execution.canonicalPath(repository.executionBackend, path);
    if (canonical !== path) throw new Error('ade: Git-Pfad enthält eine Umleitung.');
  }
  private dotGit(repository: Repository, path: string): string {
    return normalizeExecutionBackendId(repository.executionBackend) === 'native' ? join(path, '.git') : posix.join(path, '.git');
  }
  private async resolve(repository: Repository, ref: string): Promise<string> {
    if (!validSyncRef(ref)) throw new Error('ade: Ungültiger Basis-Branch.');
    const sha = (await this.command(repository, repository.rootPath, ['rev-parse', '--verify', `${ref}^{commit}`])).trim();
    if (!SHA.test(sha)) throw new Error('ade: Basis-Commit nicht gefunden.');
    return sha;
  }
  private async command(repository: Repository, path: string, args: string[], timeoutMs = 15_000): Promise<string> {
    const result = await this.execution.run(repository.executionBackend, 'git', [
      '-c', `core.hooksPath=${normalizeExecutionBackendId(repository.executionBackend) === 'native' ? hostNullDevice() : '/dev/null'}`, '-c', 'core.fsmonitor=false', '-c', 'submodule.recurse=false',
      '-c', 'protocol.ext.allow=never', '-c', 'maintenance.auto=false', '-c', 'gc.auto=0', '-C', path, ...args,
    ], { timeoutMs, maxBuffer: 512 * 1024, env: { GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'Never', GIT_OPTIONAL_LOCKS: '0' } });
    if (result.code !== 0 || result.timedOut) {
      console.warn('[ade] repository sync Git command failed:', redactedErrorDetail(decodeOutput(result.stderr)));
      throw new Error('ade: Git-Aktion fehlgeschlagen. Verbindung, Anmeldung und Repository-Zustand prüfen; Ansicht neu laden.');
    }
    return decodeOutput(result.stdout);
  }
}

function assertNativeNoLinks(path: string): void {
  const absolute = resolve(path);
  let current = parse(absolute).root;
  for (const part of absolute.slice(current.length).split(/[\\/]/).filter(Boolean)) {
    current = join(current, part);
    if (lstatSync(current).isSymbolicLink()) throw new Error('ade: Worktree-Pfad enthält eine Umleitung.');
  }
}
