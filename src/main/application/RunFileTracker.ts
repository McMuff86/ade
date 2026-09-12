import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open, opendir, lstat } from 'node:fs/promises';
import type { AdeConfig } from '../../shared/types';
import type { RunFileSnapshot, RunFileTracking } from '../../shared/runFiles';
import type { ResolvedExecutionScope } from '../repositories/RepositoryScopeService';
import type { RemoteWorkbenchService, WorkbenchScope } from './RemoteWorkbenchService';
import { sameHostPath } from '../platform';
import { redactedErrorDetail } from '../errors';
import type { RunFileStore } from './RunFileStore';

export const RUN_FILE_MAX_BYTES = 16 * 1024 * 1024;
export async function snapshotRunFiles(workbench: RemoteWorkbenchService, scope: WorkbenchScope, capture?: (file: RunFileSnapshot['files'][number], bytes: Buffer) => void): Promise<RunFileSnapshot> {
  const snapshot: RunFileSnapshot = { capturedAt: Date.now(), workspaceVersion: workbench.version(scope), limited: false, files: [] };
  let visited = 0; let bytesRead = 0; const deadline = Date.now() + 3000;
  const walk = async (directory: string, depth: number): Promise<void> => {
    if (depth > 8 || Date.now() > deadline) { snapshot.limited = true; return; }
    const dir = await opendir(workbench.path(scope, directory));
    try {
      for (;;) {
        const entry = await dir.read(); if (!entry) break;
        if (++visited > 5000 || snapshot.files.length >= 1000 || bytesRead >= 64 * 1024 * 1024 || Date.now() > deadline) { snapshot.limited = true; break; }
        const path = directory ? `${directory}/${entry.name}` : entry.name;
        let absolute: string; try { absolute = workbench.path(scope, path); } catch { continue; }
        if (entry.isDirectory()) { await walk(path, depth + 1); continue; }
        if (!entry.isFile()) continue;
        const stat = await lstat(absolute); if (!stat.isFile() || stat.nlink !== 1 || stat.size > RUN_FILE_MAX_BYTES) { snapshot.limited = true; continue; }
        const handle = await open(absolute, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
        try {
          const same = (current: typeof stat) => current.isFile() && current.nlink === 1 && current.dev === stat.dev && current.ino === stat.ino && current.size === stat.size && current.mtimeMs === stat.mtimeMs;
          if (!same(await handle.stat())) throw new Error('file replaced');
          const digest = createHash('sha256'); const buffer = Buffer.alloc(Math.min(128 * 1024, Math.max(stat.size, 1))); let count = 0;
          const chunks: Buffer[] = [];
          while (count < stat.size) {
            if (bytesRead >= 64 * 1024 * 1024 || Date.now() > deadline) { snapshot.limited = true; return; }
            const result = await handle.read(buffer, 0, Math.min(buffer.length, stat.size - count), count);
            if (!result.bytesRead) throw new Error('file changed'); count += result.bytesRead; bytesRead += result.bytesRead; digest.update(buffer.subarray(0, result.bytesRead));
            if (capture) chunks.push(Buffer.from(buffer.subarray(0, result.bytesRead)));
          }
          if (!same(await handle.stat()) || !same(await lstat(workbench.path(scope, path)))) throw new Error('file changed');
          const file = { path, bytes: count, sha256: digest.digest('hex') }; snapshot.files.push(file);
          capture?.(file, Buffer.concat(chunks));
        } catch { snapshot.limited = true; }
        finally { await handle.close(); }
      }
    } finally { await dir.close(); }
  };
  await walk('', 0); await workbench.revalidate(scope); return snapshot;
}

/** Captures actual start/end filesystem observations. Missing evidence never becomes an empty successful delta. */
export class RunFileTracker {
  constructor(private readonly store: { get(): AdeConfig; save(value: Partial<AdeConfig>): AdeConfig }, private readonly workbench: RemoteWorkbenchService, private readonly files?: RunFileStore) {}
  async before(taskId: string, execution: ResolvedExecutionScope): Promise<void> {
    try {
      if (execution.executionBackend !== 'native' || !execution.repositoryId || !execution.workspaceBindingId) throw new Error('unsupported workspace');
      const task = this.store.get().runTasks.find((item) => item.id === taskId); const participant = this.store.get().runParticipants.find((item) => item.id === task?.participantId);
      if (!task || !participant) return;
      const scope = await this.workbench.resolve({ agentId: participant.agentId, repositoryId: execution.repositoryId });
      if (!scope || scope.id !== execution.workspaceBindingId || !sameHostPath(scope.workspaceDir, execution.workspaceDir)) throw new Error('workspace changed');
      const before = await snapshotRunFiles(this.workbench, scope); this.save(taskId, { before, notice: null });
    } catch (error) { console.warn('[ade] task file baseline unavailable:', redactedErrorDetail(error));
      this.save(taskId, { notice: 'Ausgangsstand nicht vollständig verfügbar. Dateizuordnung bleibt unbekannt.' }); }
  }
  async after(taskId: string): Promise<void> {
    const config = this.store.get(); const task = config.runTasks.find((item) => item.id === taskId); const previous = task?.fileTracking;
    if (!task || !previous?.before) return;
    try {
      const participant = config.runParticipants.find((item) => item.id === task.participantId);
      if (!participant || !task.repositoryId || !task.workspaceDir) throw new Error('scope unavailable');
      const scope = await this.workbench.resolve({ agentId: participant.agentId, repositoryId: task.repositoryId });
      if (!scope || scope.id !== task.workspaceBindingId || !sameHostPath(scope.workspaceDir, task.workspaceDir)) throw new Error('scope changed');
      const saved: RunFileSnapshot = { capturedAt: Date.now(), workspaceVersion: previous.before.workspaceVersion, limited: false, files: [] };
      const before = new Map(previous.before.files.map((file) => [file.path, file.sha256]));
      const after = await snapshotRunFiles(this.workbench, scope, this.files ? (file, bytes) => {
        if (before.get(file.path) === file.sha256) return;
        if (saved.files.length >= 100) { saved.limited = true; return; }
        try { this.files!.put(file.sha256, bytes); saved.files.push(file); }
        catch (error) { saved.limited = true; console.warn('[ade] result file unavailable:', redactedErrorDetail(error)); }
      } : undefined);
      if (after.workspaceVersion !== previous.before.workspaceVersion) throw new Error('scope version changed');
      this.save(taskId, { ...previous, after, ...(this.files ? { saved: { ...saved, limited: saved.limited || after.limited } } : {}) });
    } catch (error) { console.warn('[ade] task file completion unavailable:', redactedErrorDetail(error));
      this.save(taskId, { ...previous, notice: 'Kein bestätigter Abschlussvergleich. Aktuelle Dateien sind kein gesicherter Run-Nachweis.' }); }
  }
  private save(taskId: string, fileTracking: RunFileTracking) {
    const config = this.store.get(); if (!config.runTasks.some((task) => task.id === taskId)) return;
    this.store.save({ runTasks: config.runTasks.map((task) => task.id === taskId ? { ...task, fileTracking } : task) });
  }
}
