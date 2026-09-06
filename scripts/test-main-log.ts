/**
 * Durable main-process sinks (Thema 3 / Thema 5): the rotating main log and
 * the run archive that history retention writes before pruning.
 */

import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
  testRunArchive(scratch);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

console.log(`\n${failed ? 'FAILED' : 'PASSED'} - ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
