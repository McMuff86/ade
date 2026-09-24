/**
 * Durable main-process sinks (Thema 3 / Thema 5): the rotating main log and
 * the run archive that history retention writes before pruning.
 */

import { EventEmitter } from 'node:events';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { App, WebContents } from 'electron';
import { captureMainProcessFailures, captureProcessCrashes, captureRendererConsoleErrors, LogGate } from '../src/main/logging/crashCapture';
import { MainLogSink } from '../src/main/logging/mainLog';
import { RunArchiveStore } from '../src/main/orchestration/RunArchiveStore';
import type { RunArchive } from '../src/main/orchestration/OrchestrationService';
import { DEFAULT_RUN_BUDGET } from '../src/shared/types';

let passed = 0;
let failed = 0;

function check(label: string, condition: boolean, detail?: unknown): void {
  if (condition) {
    passed += 1;
    console.log(`  ok  ${label}`);
  } else {
    failed += 1;
    console.error(`FAIL  ${label}`, detail ?? '');
  }
}

function testMainLog(scratch: string): void {
  const dir = join(scratch, 'logs');
  const sink = new MainLogSink({ dir, maxBytes: 2_048, maxFiles: 3, now: () => new Date('2026-09-06T00:00:00.000Z') });
  check('the log directory is created lazily on first write', !existsSync(dir) && (sink.write('log', ['hello']), existsSync(dir)));
  const first = readFileSync(sink.path(), 'utf8');
  check('a line is timestamped, levelled and newline-terminated',
    first === '2026-09-06T00:00:00.000Z LOG   hello\n');

  sink.write('error', ['token=verysecret1234', new Error('boom')]);
  const withError = readFileSync(sink.path(), 'utf8');
  check('credentials are redacted and error stacks stay on one line',
    !withError.includes('verysecret1234') && withError.includes('ERROR') && withError.includes('boom')
      && withError.trimEnd().split('\n').length === 2);

  for (let index = 0; index < 60; index += 1) sink.write('info', [`line ${index} ${'x'.repeat(100)}`]);
  const files = readdirSync(dir).sort();
  check('the log rotates by size and keeps at most maxFiles files',
    files.length === 3 && files.join(',') === 'main.1.log,main.2.log,main.log', files);
  check('no rotated file exceeds the byte bound',
    files.every((file) => statSync(join(dir, file)).size <= 2_048 + 256));
  check('the newest lines live in the current file',
    readFileSync(sink.path(), 'utf8').includes('line 59'));
  check('the oldest lines were dropped, not the newest',
    !files.some((file) => readFileSync(join(dir, file), 'utf8').includes('line 0 ')));

  const fakeConsole = {
    calls: [] as string[],
    log(...args: unknown[]) { this.calls.push(`log:${args.join(' ')}`); },
    info(...args: unknown[]) { this.calls.push(`info:${args.join(' ')}`); },
    warn(...args: unknown[]) { this.calls.push(`warn:${args.join(' ')}`); },
    error(...args: unknown[]) { this.calls.push(`error:${args.join(' ')}`); },
  };
  const teeDir = join(scratch, 'tee');
  const tee = new MainLogSink({ dir: teeDir });
  const restore = tee.install(fakeConsole as unknown as Console);
  fakeConsole.warn('[ade] something odd');
  check('install() tees console output into the file and keeps the original console',
    fakeConsole.calls.join('|') === 'warn:[ade] something odd'
      && readFileSync(tee.path(), 'utf8').includes('WARN  [ade] something odd'));
  restore();
  fakeConsole.error('after restore');
  check('restore() detaches the sink',
    !readFileSync(tee.path(), 'utf8').includes('after restore') && fakeConsole.calls.length === 2);

  // A regular file where the directory should be makes mkdir fail.
  const blockedDir = join(scratch, 'blocked-file');
  writeFileSync(blockedDir, 'not a directory');
  const blocked = new MainLogSink({ dir: blockedDir });
  let threw = false;
  try {
    blocked.write('log', ['x']);
  } catch {
    threw = true;
  }
  check('a sink that cannot write disables itself instead of throwing into the caller',
    !threw && blocked.disabledReason() !== null);
}

function testCrashCapture(): void {
  const lines: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => { lines.push(args.map(String).join(' ')); };
  try {
    let clock = 0;
    const gate = new LogGate('probe', 2, 1_000, () => clock);
    const admitted = [gate.admit(), gate.admit(), gate.admit(), gate.admit()];
    check('a failure gate admits its limit per window and drops the rest',
      admitted.join() === 'true,true,false,false' && lines.length === 0, admitted);
    clock = 1_000;
    check('the next window reopens the gate and reports how many failures it dropped',
      gate.admit() && lines.at(-1) === '[ade] probe: 2 further failure(s) not logged in the previous minute', lines);

    lines.length = 0;
    const mainProcess = new EventEmitter();
    captureMainProcessFailures(mainProcess as unknown as NodeJS.Process);
    mainProcess.emit('uncaughtException', new Error('main boom token=verysecret1234'));
    mainProcess.emit('unhandledRejection', 'rejected without an Error');
    check('uncaught exceptions and unhandled rejections in main reach the log',
      lines[0]?.startsWith('[ade] uncaught exception in main: Error: main boom') === true
        && lines[1] === '[ade] unhandled rejection in main: rejected without an Error', lines);
    check('crash lines are redacted before they reach the log', !lines.join('\n').includes('verysecret1234'));

    lines.length = 0;
    const app = new EventEmitter();
    captureProcessCrashes(app as unknown as App);
    app.emit('render-process-gone', {}, {}, { reason: 'clean-exit', exitCode: 0 });
    app.emit('render-process-gone', {}, {}, { reason: 'crashed', exitCode: -1073741819 });
    app.emit('child-process-gone', {}, { type: 'GPU', reason: 'oom', exitCode: 1 });
    app.emit('child-process-gone', {}, { type: 'Utility', serviceName: 'network.mojom.NetworkService', reason: 'killed', exitCode: 9 });
    check('crashed renderer, GPU and utility processes are logged, clean exits are not',
      lines.join('|') === '[ade] renderer process gone: crashed, exit code -1073741819'
        + '|[ade] GPU process gone: oom, exit code 1'
        + '|[ade] Utility process gone (network.mojom.NetworkService): killed, exit code 9', lines);

    lines.length = 0;
    const contents = new EventEmitter();
    captureRendererConsoleErrors(contents as unknown as WebContents, new LogGate('renderer', 3, 60_000, () => 0));
    contents.emit('console-message', { level: 'warning', message: 'just a warning', lineNumber: 1, sourceId: '' });
    contents.emit('console-message', { level: 'error', message: 'Uncaught TypeError: x is undefined password=hunter22',
      lineNumber: 42, sourceId: 'file:///C:/Users/someone/ade/out/renderer/assets/index-abc.js?v=1' });
    contents.emit('console-message', { level: 'error', message: 'x'.repeat(5_000), lineNumber: 0, sourceId: '' });
    check('renderer console errors are logged with file and line but no host path',
      lines[0] === '[ade] renderer error: Uncaught TypeError: x is undefined password=[credential] (index-abc.js:42)', lines);
    check('renderer warnings are ignored and a long message is bounded',
      lines.length === 2 && lines[1]!.length < 2_100);
    for (let index = 0; index < 5; index += 1) contents.emit('console-message', { level: 'error', message: `loop ${index}`, lineNumber: 1, sourceId: '' });
    check('a renderer error loop is cut off by its gate', lines.length === 3 && lines[2] === '[ade] renderer error: loop 0', lines);
  } finally {
    console.error = original;
  }
}

function testRunArchive(scratch: string): void {
  const dir = join(scratch, 'archive', 'runs');
  const store = new RunArchiveStore(dir);
  const archive: RunArchive = {
    format: 'ade-run-archive',
    version: 1,
    archivedAt: 1_000,
    run: {
      id: '5b2a7d1e-3c4f-4a6b-9c8d-0e1f2a3b4c5d', name: 'old', goal: '', status: 'completed', mode: 'manual',
      phase: 'completed', budget: { ...DEFAULT_RUN_BUDGET }, createdAt: 1, updatedAt: 2,
    },
    participants: [],
    tasks: [],
    events: [],
    artifacts: [],
    results: [],
    approvals: [],
    workspaceLeases: [],
    messages: [],
  };
  store.write(archive);
  const path = store.pathFor(archive.run.id);
  check('an archive is written as one compact JSON file named after the run id',
    existsSync(path) && JSON.parse(readFileSync(path, 'utf8')).run.name === 'old'
      && readFileSync(path, 'utf8').trimEnd().split('\n').length === 1);
  check('no temp file is left behind', readdirSync(dir).every((entry) => !entry.endsWith('.tmp')));
  store.write({ ...archive, archivedAt: 2_000 });
  check('re-archiving the same run replaces the file atomically',
    readdirSync(dir).length === 1 && JSON.parse(readFileSync(path, 'utf8')).archivedAt === 2_000);
  let rejected = false;
  try {
    store.pathFor('../escape');
  } catch {
    rejected = true;
  }
  check('a non-UUID run id can never steer the archive path', rejected);
}

const scratch = mkdtempSync(join(tmpdir(), 'ade-main-log-'));
try {
  testMainLog(scratch);
  testCrashCapture();
  testRunArchive(scratch);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

console.log(`\n${failed ? 'FAILED' : 'PASSED'} - ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
