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

interface PtyObservationPort {
  getSessionMeta(id: string): SessionMeta | undefined;
  activitySnapshot(id: string): { lines: ActivityLine[]; lastOutputAt?: number; outputBytes: number; structured: boolean };
}
const TYPES: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.md': 'text/markdown; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.csv': 'text/csv; charset=utf-8' };
const MAX_FILE = 16 * 1024 * 1024;
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const absent = (): never => { throw new RemoteApiError(404, 'not_found'); };

/** No terminal input, shell commands or client-supplied host paths. */
export class RunInspectionService {
  constructor(private readonly store: { get(): AdeConfig }, private readonly workbench: RemoteWorkbenchService,
    private readonly pty: PtyObservationPort, private readonly report: (runId: string) => RunReport) {}

  activity(runId: string, taskId?: string): MobileRunActivity['tasks'] {
    const config = this.store.get(); if (!config.runs.some((run) => run.id === runId)) return absent();
    const report = this.report(runId);
    if (taskId && !report.tasks.some((task) => task.id === taskId)) return absent();
    return report.tasks.filter((task) => !taskId || task.id === taskId).slice(-32).map((task) => {
      const stored = config.runTasks.find((item) => item.id === task.id)!;
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
        process: session?.status ?? 'unavailable', lastOutputAt: observation?.lastOutputAt, outputBytes: observation?.outputBytes, activity,
        notice: !session && task.status === 'running' ? 'Auftrag ist als laufend erfasst, aber der Prozess ist nicht erreichbar. Status am PC prüfen.'
          : session && !observation?.structured ? 'Diese Sitzung liefert keine strukturierten Werkzeugmeldungen. Empfangene Ausgabe wird weiterhin gezählt.' : null,
        output: taskId && task.output ? { ...task.output, text: clean(task.output.text, 64 * 1024) } : undefined,
        result: taskId && task.result ? { ...task.result, summary: clean(task.result.summary, 64 * 1024), filesChanged: task.result.filesChanged.map((path) => clean(path, 400)),
          risks: task.result.risks.map((risk) => clean(risk, 4000)), tests: task.result.tests.map((test) => ({ ...test, command: clean(test.command, 2000), output: clean(test.output, 64 * 1024) })),
          adapterId: clean(task.result.adapterId, 100) } : null };
    });
  }

  async files(runId: string, taskId: string, authorize: () => void): Promise<MobileRunFiles> {
    return workspaceOperations.use(async () => {
      authorize(); const { scope } = await this.scope(runId, taskId); const listing = this.list(scope, taskId);
      await this.workbench.revalidate(scope); authorize(); return listing;
    });
  }

  async file(runId: string, taskId: string, fileId: string, authorize: () => void): Promise<{ bytes: Buffer; type: string; name: string }> {
    return workspaceOperations.use(async () => {
      authorize(); const { scope } = await this.scope(runId, taskId);
      const file = this.list(scope, taskId).files.find((item) => item.id === fileId); if (!file) return absent();
      await this.workbench.revalidate(scope); authorize();
      const path = this.workbench.path(scope, file.path); const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      try {
        const stat = fstatSync(fd); const identity = hash([taskId, this.workbench.version(scope), file.path, stat.dev, stat.ino, stat.size, stat.mtimeMs]);
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
        return { bytes: TYPES[ext]!.startsWith('text/') ? Buffer.from(redactForWire(bytes.toString('utf8'), MAX_FILE)) : bytes,
          type: TYPES[ext]!, name: file.name };
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

  private list(scope: WorkbenchScope, taskId: string): MobileRunFiles {
    const result: MobileRunFiles = { files: [], limited: false, notice: 'Dateien im Auftrags-Workspace; sie können auch von früheren Arbeiten stammen. Bis 16 MiB pro Datei.' };
    let visited = 0;
    const walk = (directory: string, depth: number) => {
      if (depth > 8 || visited >= 1500 || result.files.length >= 100) { result.limited = true; return; }
      const dir = opendirSync(this.workbench.path(scope, directory));
      try {
        for (;;) {
          const entry = dir.readSync(); if (!entry) break;
          if (++visited > 1500 || result.files.length >= 100) { result.limited = true; break; }
          const path = directory ? `${directory}/${entry.name}` : entry.name;
          let abs: string; try { abs = this.workbench.path(scope, path); } catch { continue; }
          if (entry.isDirectory()) { walk(path, depth + 1); continue; }
          const type = TYPES[extname(entry.name).toLowerCase()]; if (!entry.isFile() || !type) continue;
          const stat = lstatSync(abs); if (!stat.isFile() || stat.nlink !== 1 || stat.size > MAX_FILE) continue;
          result.files.push({ id: hash([taskId, this.workbench.version(scope), path, stat.dev, stat.ino, stat.size, stat.mtimeMs]),
            path, name: basename(path), bytes: stat.size, image: type.startsWith('image/') });
        }
      } catch (error) { throw new RemoteApiError(422, 'command_rejected', redactedWireMessage(error)); }
      finally { dir.closeSync(); }
    };
    walk('', 0); result.files.sort((a, b) => Number(b.image) - Number(a.image) || a.path.localeCompare(b.path)); return result;
  }
}
