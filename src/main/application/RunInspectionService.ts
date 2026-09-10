import { createHash } from 'node:crypto';
import { closeSync, constants, fstatSync, lstatSync, openSync, opendirSync, readSync } from 'node:fs';
import { basename, extname } from 'node:path';
import type { AdeConfig, RunReport, RunTask, SessionMeta } from '../../shared/types';
import type { ActivityLine } from '../../shared/ipc';
import type { MobileRunActivity, MobileRunFiles } from '../../shared/remote';
import { redactForWire, redactedWireMessage } from '../errors';
import { sameHostPath } from '../platform';
import { workspaceOperations } from '../repositories/WorkspaceOperationGate';
import { RemoteApiError } from './AdeApplicationService';
import type { RemoteWorkbenchService, WorkbenchScope } from './RemoteWorkbenchService';
import { taskFileChanges } from '../../shared/runFiles';
import { snapshotRunFiles } from './RunFileTracker';

interface PtyObservationPort {
  getSessionMeta(id: string): SessionMeta | undefined;
  activitySnapshot(id: string): { lines: ActivityLine[]; lastOutputAt?: number; outputBytes: number; structured: boolean };
}
const TYPES: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.pdf': 'application/pdf', '.zip': 'application/zip',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.md': 'text/markdown; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.csv': 'text/csv; charset=utf-8' };
const fileType = (name: string) => TYPES[extname(name).toLowerCase()] ?? (/\.(?:json|ya?ml|toml|xml|html?|svg|[cm]?jsx?|tsx?|py|rs|css|sh|ps1|c|cpp|h|log)$/i.test(name) ? 'text/plain; charset=utf-8' : 'application/octet-stream');
const MAX_FILE = 16 * 1024 * 1024;
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const absent = (): never => { throw new RemoteApiError(404, 'not_found'); };

/** No terminal input, shell commands or client-supplied host paths. */
export class RunInspectionService {
  constructor(private readonly store: { get(): AdeConfig }, private readonly workbench: RemoteWorkbenchService,
    private readonly pty: PtyObservationPort, private readonly report: (runId: string) => RunReport) {}

  private label(text: string, runId: string, fallback: string): string {
    const prompts = this.store.get().runTasks.filter((task) => task.runId === runId).map((task) => task.prompt.trim()).filter(Boolean);
    return prompts.some((prompt) => text === prompt.slice(0, 80) || text.includes(prompt)) ? fallback : redactForWire(text, 200);
  }

  projectRuns(repositoryId: string): import('../../shared/remote').ProjectRunResults {
    const config = this.store.get();
    const runs = config.runs.filter((run) => config.runTasks.some((task) => task.runId === run.id && task.repositoryId === repositoryId)).sort((a, b) => b.createdAt - a.createdAt);
    return { runs: runs.slice(0, 20).map((run) => ({ id: run.id, name: this.label(run.name, run.id, 'Einzelaufgabe'), status: this.report(run.id).status, createdAt: run.createdAt,
      taskIds: config.runTasks.filter((task) => task.runId === run.id && task.repositoryId === repositoryId).slice(-32).map((task) => task.id) })), limited: runs.length > 20 };
  }

  activity(runId: string, taskId?: string): MobileRunActivity['tasks'] {
    const config = this.store.get(); if (!config.runs.some((run) => run.id === runId)) return absent();
    const report = this.report(runId);
    if (taskId && !report.tasks.some((task) => task.id === taskId)) return absent();
    return report.tasks.filter((task) => !taskId || task.id === taskId).slice(-32).map((task) => {
      const stored = config.runTasks.find((item) => item.id === task.id)!;
      const changes = task.files ?? taskFileChanges(stored.fileTracking, task.result?.filesChanged);
      const count = (kind: string) => changes.files.filter((file) => file.change === kind).length;
      const candidate = stored.sessionId ? this.pty.getSessionMeta(stored.sessionId) : undefined;
      const session = candidate?.runTaskId === task.id && candidate.kind === 'task' ? candidate : undefined;
      const observation = session ? this.pty.activitySnapshot(session.id) : undefined;
      const clean = (value: string, max: number) => redactForWire(stored.prompt.trim() ? value.split(stored.prompt.trim()).join('[Auftragstext ausgeblendet]') : value, max);
      // Live tool arguments may contain prompts. Show the operation name only;
      // assistant answers belong in full result detail, not in a truncated teaser.
      const activity = (observation?.lines ?? []).slice(-40).map((line) => ({ kind: line.kind,
        text: line.kind === 'tool' ? clean(line.text.split(':')[0]!.slice(0, 80), 80)
          : line.kind === 'thinking' ? 'Agent bearbeitet die Aufgabe…' : line.kind === 'text' ? 'Agent-Antwort empfangen'
            : line.kind === 'error' ? 'CLI meldet einen Fehler; Ergebnis prüfen.' : clean(line.text, 200) }));
      return { id: task.id, participantId: task.participantId, status: task.status, startedAt: task.startedAt, endedAt: task.endedAt, exitCode: task.exitCode,
        fileChanges: { created: count('created'), modified: count('modified'), deleted: count('deleted'), reported: count('reported'), unknown: count('unknown'), source: changes.source },
        process: session?.status ?? 'unavailable', lastOutputAt: observation?.lastOutputAt, outputBytes: observation?.outputBytes, activity,
        notice: !session && task.status === 'running' ? 'Auftrag ist als laufend erfasst, aber der Prozess ist nicht erreichbar. Status am PC prüfen.'
          : session && !observation?.structured ? 'Diese Sitzung liefert keine strukturierten Werkzeugmeldungen. Empfangene Ausgabe wird weiterhin gezählt.' : null,
        output: taskId && task.output ? { ...task.output, text: clean(task.output.text, 64 * 1024) } : undefined,
        result: taskId && task.result ? { ...task.result, summary: clean(task.result.summary, 64 * 1024), filesChanged: task.result.filesChanged.map((path) => clean(path, 400)),
          risks: task.result.risks.map((risk) => clean(risk, 4000)), tests: task.result.tests.map((test) => ({ ...test, command: clean(test.command, 2000), output: clean(test.output, 64 * 1024) })),
          adapterId: clean(task.result.adapterId, 100) } : null };
    });
  }

  async files(runId: string, taskId: string | undefined, authorize: () => void): Promise<MobileRunFiles> {
    return workspaceOperations.use(async () => {
      authorize(); if (taskId) return this.taskFiles(runId, taskId, authorize);
      const config = this.store.get(); if (!config.runs.some((run) => run.id === runId)) return absent();
      const tasks = config.runTasks.filter((task) => task.runId === runId).sort((a, b) => b.createdAt - a.createdAt);
      const result: MobileRunFiles = { files: [], limited: tasks.length > 32, notice: 'Dateien der Aufgaben dieses Runs, aus ihren jeweiligen Arbeitskopien. Downloads verwenden den aktuellen Dateistand.', unavailableTasks: [] };
      const deadline = Date.now() + 8000;
      for (const task of tasks.slice(0, 32)) {
        if (result.files.length >= 100 || Date.now() > deadline) { result.limited = true; break; }
        try { const list = await this.taskFiles(runId, task.id, authorize); const room = 100 - result.files.length;
          result.files.push(...list.files.slice(0, room)); result.limited ||= list.limited || list.files.length > room;
        } catch (error) { authorize(); result.unavailableTasks!.push({ taskId: task.id, title: this.label(task.title, runId, 'Aufgabe'), notice: redactedWireMessage(error) }); }
      }
      authorize(); return result;
    });
  }

  private async taskFiles(runId: string, taskId: string, authorize: () => void): Promise<MobileRunFiles> {
    authorize(); const { scope, task } = await this.scope(runId, taskId);
    const snapshot = await snapshotRunFiles(this.workbench, scope);
    const reported = this.store.get().runTaskResults.find((item) => item.taskId === taskId)?.filesChanged;
    const delta = taskFileChanges(task.fileTracking?.before && !task.fileTracking.after && task.status === 'running'
      ? { ...task.fileTracking, after: snapshot } : task.fileTracking, reported);
    const listing = this.list(scope, taskId, delta.files.map((file) => file.path));
    const changes = new Map(delta.files.map((file) => [file.path, file])); const latest = new Map(snapshot.files.map((file) => [file.path, file]));
    const after = new Map(task.fileTracking?.after?.files.map((file) => [file.path, file]) ?? []);
    listing.files = listing.files.map((file) => ({ ...file, id: latest.has(file.path) ? hash([file.id, latest.get(file.path)!.sha256]) : file.id,
      taskId, taskTitle: this.label(task.title, runId, 'Aufgabe'), available: true,
      sha256: latest.get(file.path)?.sha256, change: changes.get(file.path)?.change ?? (delta.source === 'observed' && after.has(file.path) ? 'unchanged' : 'unknown'),
      changedSinceRun: !!after.get(file.path) && !!latest.get(file.path) && after.get(file.path)!.sha256 !== latest.get(file.path)!.sha256 }));
    for (const change of delta.files) if (!listing.files.some((file) => file.path === change.path)) {
      try { this.workbench.path(scope, change.path, true); } catch { continue; }
      if (listing.files.length >= 100) {
        listing.limited = true; const spare = listing.files.findIndex((file) => file.change === 'unchanged' || file.change === 'unknown');
        if (spare < 0) break; listing.files.splice(spare, 1);
      }
      listing.files.push({ id: hash([taskId, change.path, 'unavailable']), path: change.path, name: basename(change.path), bytes: 0, image: false,
        taskId, taskTitle: this.label(task.title, runId, 'Aufgabe'), change: change.change, available: false });
    }
    listing.files.sort((a, b) => Number(a.change === 'unchanged' || a.change === 'unknown') - Number(b.change === 'unchanged' || b.change === 'unknown') || a.path.localeCompare(b.path));
    listing.limited ||= snapshot.limited || delta.limited; listing.notice = `${delta.notice ?? ''} Bis 16 MiB pro Datei.`;
    await this.workbench.revalidate(scope); authorize(); return listing;
  }

  async file(runId: string, taskId: string, fileId: string, authorize: () => void): Promise<{ bytes: Buffer; type: string; name: string }> {
    return workspaceOperations.use(async () => {
      authorize(); const { scope } = await this.scope(runId, taskId);
      const file = (await this.taskFiles(runId, taskId, authorize)).files.find((item) => item.id === fileId && item.available); if (!file) return absent();
      await this.workbench.revalidate(scope); authorize();
      const path = this.workbench.path(scope, file.path); const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      try {
        const stat = fstatSync(fd); const metadataId = hash([taskId, this.workbench.version(scope), file.path, stat.dev, stat.ino, stat.size, stat.mtimeMs]);
        const identity = file.sha256 ? hash([metadataId, file.sha256]) : metadataId;
        if (!stat.isFile() || stat.nlink !== 1 || stat.size > MAX_FILE || fileId !== identity) throw new RemoteApiError(409, 'command_rejected', 'Datei wurde geändert. Liste aktualisieren.');
        const bytes = Buffer.alloc(stat.size); let read = 0;
        while (read < bytes.length) { const count = readSync(fd, bytes, read, bytes.length - read, read); if (!count) break; read += count; }
        const after = fstatSync(fd);
        const named = lstatSync(this.workbench.path(scope, file.path)); authorize();
        if (read !== stat.size || after.size !== stat.size || after.mtimeMs !== stat.mtimeMs || named.ino !== stat.ino || named.dev !== stat.dev || named.size !== stat.size || named.mtimeMs !== stat.mtimeMs) throw new RemoteApiError(409, 'command_rejected', 'Datei wird noch geschrieben. Später erneut öffnen.');
        const ext = extname(file.name).toLowerCase();
        const magic = ext === '.png' ? bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
          : ext === '.jpg' || ext === '.jpeg' ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
            : ext === '.webp' ? bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP'
              : ext === '.xlsx' ? bytes[0] === 80 && bytes[1] === 75 && bytes[2] === 3 && bytes[3] === 4 : true;
        if (!magic) throw new RemoteApiError(422, 'command_rejected', 'Dateiinhalt passt nicht zum Dateityp.');
        if (file.sha256 && createHash('sha256').update(bytes).digest('hex') !== file.sha256) throw new RemoteApiError(409, 'command_rejected', 'Datei wurde während des Downloads geändert. Liste aktualisieren.');
        const type = fileType(file.name);
        return { bytes: type.startsWith('text/') ? Buffer.from(redactForWire(bytes.toString('utf8'), MAX_FILE)) : bytes,
          type, name: file.name };
      } finally { closeSync(fd); }
    });
  }

  private async scope(runId: string, taskId: string): Promise<{ scope: WorkbenchScope; task: RunTask }> {
    const config = this.store.get(); const task = config.runTasks.find((item) => item.id === taskId && item.runId === runId);
    const participant = config.runParticipants.find((item) => item.id === task?.participantId && item.runId === runId);
    if (!task || !participant || !task.repositoryId || !task.workspaceDir || !task.workspaceBindingId) return absent();
    const scope = await this.workbench.resolve({ agentId: participant.agentId, repositoryId: task.repositoryId });
    if (!scope || scope.executionBackend !== 'native' || scope.id !== task.workspaceBindingId || !sameHostPath(scope.workspaceDir, task.workspaceDir)) throw new RemoteApiError(409, 'command_rejected', 'Der ursprüngliche Auftrags-Workspace ist nicht mehr verfügbar.');
    return { scope, task };
  }

  private list(scope: WorkbenchScope, taskId: string, preferred: string[] = []): MobileRunFiles {
    const result: MobileRunFiles = { files: [], limited: false, notice: 'Dateien im Auftrags-Workspace; sie können auch von früheren Arbeiten stammen. Bis 16 MiB pro Datei.' };
    let visited = 0;
    const add = (path: string): void => {
      if (result.files.some((file) => file.path === path)) return;
      const stat = lstatSync(this.workbench.path(scope, path)); if (!stat.isFile() || stat.nlink !== 1 || stat.size > MAX_FILE) return;
      result.files.push({ id: hash([taskId, this.workbench.version(scope), path, stat.dev, stat.ino, stat.size, stat.mtimeMs]),
        path, name: basename(path), bytes: stat.size, image: fileType(path).startsWith('image/') });
    };
    for (const path of preferred.slice(0, 100)) { try { add(path); } catch { /* Missing or protected files cannot be downloaded. */ } }
    const walk = (directory: string, depth: number) => {
      if (depth > 8 || visited >= 1500 || result.files.length >= 100) { result.limited = true; return; }
      const dir = opendirSync(this.workbench.path(scope, directory));
      try {
        for (;;) {
          const entry = dir.readSync(); if (!entry) break;
          if (++visited > 1500 || result.files.length >= 100) { result.limited = true; break; }
          const path = directory ? `${directory}/${entry.name}` : entry.name;
          try { this.workbench.path(scope, path); } catch { continue; }
          if (entry.isDirectory()) { walk(path, depth + 1); continue; }
          if (!entry.isFile()) continue;
          add(path);
        }
      } catch (error) { throw new RemoteApiError(422, 'command_rejected', redactedWireMessage(error)); }
      finally { dir.closeSync(); }
    };
    walk('', 0); result.files.sort((a, b) => Number(b.image) - Number(a.image) || a.path.localeCompare(b.path)); return result;
  }
}
