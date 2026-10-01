/** Goal 34.3: distinguish app quit, host restart and ADE crash for work the previous owner left. */
import { mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { causeFor, classifyPreviousEnd, HostLifecycle, TASK_INTERRUPTION_REASON, type BootIdentity } from '../src/main/overview/hostLifecycle';
import { interruptOrphanBookends } from '../src/main/overview/sessionBookends';
import { attentionOverview } from '../src/main/overview/attentionOverview';
import { validateCompleteConfig } from '../src/main/config/store';
import { DEFAULT_CONFIG, type SessionBookend } from '../src/shared/types';

let passed = 0; let failed = 0;
const check = (label: string, ok: boolean) => { if (ok) { passed++; console.log(`  ok  ${label}`); } else { failed++; console.error(`FAIL  ${label}`); } };
const root = mkdtempSync(join(tmpdir(), 'ade-lifecycle-'));
try {
  const bootA: BootIdentity = { kind: 'id', value: '11111111-2222-3333-4444-555555555555' };
  const bootB: BootIdentity = { kind: 'id', value: '99999999-2222-3333-4444-555555555555' };
  const file = join(root, 'ade', 'lifecycle.json');
  let now = 1_000_000; let boot = bootA;
  const open = () => new HostLifecycle(file, { now: () => now, boot: () => boot });

  const first = open();
  check('first start without a record is unknown, never a guessed cause', first.previous.cause === 'unknown' && first.previous.window === null);
  check('the record is private and starts without a clean mark', JSON.parse(readFileSync(file, 'utf8')).cleanAt === null
    && (process.platform === 'win32' || (statSync(file).mode & 0o777) === 0o600));
  now += 30_000; first.markClean();
  now += 5_000;
  const afterQuit = open();
  check('same boot with a clean mark is an app quit', afterQuit.previous.cause === 'app-quit');
  check('the quit window spans the previous owner exactly', afterQuit.previous.window?.from === 1_000_000 && afterQuit.previous.window.to === 1_030_000);

  now += 60_000; afterQuit.heartbeat();
  now += 10_000;
  const afterCrash = open();
  check('same boot without a clean mark is an unexpected ADE stop', afterCrash.previous.cause === 'app-crash');
  check('heartbeat bounds the crash window', afterCrash.previous.window!.to === 1_095_000 + 120_000);

  boot = bootB; now += 1_000;
  const afterReboot = open();
  check('a new boot id is a host restart', afterReboot.previous.cause === 'host-restart');
  afterReboot.markClean(); boot = { kind: 'id', value: 'aaaaaaaa-2222-3333-4444-555555555555' };
  check('a host restart wins over a clean quit before shutdown', open().previous.cause === 'host-restart');

  check('boot time within tolerance is the same boot', classifyPreviousEnd({ version: 1, boot: { kind: 'time', at: 10_000 }, startedAt: 1, lastSeenAt: 2, cleanAt: null }, { kind: 'time', at: 10_000 + 60_000 }).cause === 'app-crash');
  check('boot time beyond tolerance is a host restart', classifyPreviousEnd({ version: 1, boot: { kind: 'time', at: 10_000 }, startedAt: 1, lastSeenAt: 2, cleanAt: null }, { kind: 'time', at: 10_000 + 3_600_000 }).cause === 'host-restart');
  check('incomparable boot identities stay unknown', classifyPreviousEnd({ version: 1, boot: bootA, startedAt: 1, lastSeenAt: 2, cleanAt: 2 }, { kind: 'time', at: 1 }).cause === 'unknown');

  const quitEnd = { cause: 'app-quit' as const, window: { from: 100, to: 200 } };
  check('sessions of the recorded owner receive its cause', causeFor(quitEnd, 150) === 'app-quit');
  check('older sessions (another build or rollback) stay unknown', causeFor(quitEnd, 50) === 'unknown');
  check('sessions after the recorded window stay unknown', causeFor(quitEnd, 201) === 'unknown');

  writeFileSync(file, '{"version":1,"boot":{"kind":"id","value":"../../etc"},"startedAt":1,"lastSeenAt":1,"cleanAt":null}');
  check('a malformed record degrades to unknown and is replaced', open().previous.cause === 'unknown' && JSON.parse(readFileSync(file, 'utf8')).boot.value === boot.value);
  const target = join(root, 'target.json'); writeFileSync(target, 'outside');
  rmSync(file); symlinkSync(target, file);
  const linked = open();
  check('a linked record is not trusted and its target stays untouched', linked.previous.cause === 'unknown' && readFileSync(target, 'utf8') === 'outside');

  const bookend = (id: string, startedAt: number): SessionBookend => ({ id, projectWorkspaceId: 'workspace', agentName: id, runtime: 'codex',
    repositoryId: 'repo', repositoryName: 'Repo', startedAt, endedAt: null });
  const crashEnd = { cause: 'app-crash' as const, window: { from: 100, to: 200 } };
  const closed = interruptOrphanBookends([bookend('in-window', 150), bookend('older', 10), bookend('live', 150)], new Set(['live']), 500, startedAt => causeFor(crashEnd, startedAt));
  check('orphaned sessions carry the cause of their owner only', closed[0]!.interruption === 'app-crash' && closed[1]!.interruption === 'unknown' && closed[2]!.interruption === undefined);

  const config = structuredClone(DEFAULT_CONFIG);
  config.repositories = [{ id: 'repo', name: 'Repo', rootPath: '/private/repo', commonGitDir: '/private/repo/.git', executionBackend: 'native', verified: true, createdAt: 1 }];
  config.sessionBookends = closed;
  validateCompleteConfig(config); check('persisted interruption causes pass the store schema', true);
  const invalid = structuredClone(config); invalid.sessionBookends = [{ ...bookend('done', 1), endedAt: 2, exitReason: 'exit', interruption: 'app-crash' }];
  let rejected = false; try { validateCompleteConfig(invalid); } catch { rejected = true; }
  check('a cause on a normally ended session is rejected', rejected);
  const unknownCause = structuredClone(config); unknownCause.sessionBookends = [{ ...closed[0]!, interruption: 'resumed' as never }];
  rejected = false; try { validateCompleteConfig(unknownCause); } catch { rejected = true; }
  check('an unknown cause value is rejected', rejected);

  const legacy = structuredClone(config); legacy.sessionBookends = [{ ...bookend('legacy', 1), endedAt: 2, exitReason: 'interrupted' }];
  const rows = attentionOverview(config, [], [], undefined, 999).rows;
  check('attention reports the cause as interrupted work without actions', rows.find(row => row.id === 'history:in-window')?.interruption === 'app-crash'
    && rows.every(row => row.group === 'interrupted' && row.actions.length === 0 && row.target?.kind === 'project'));
  check('legacy interrupted records without a cause are reported as unknown', attentionOverview(legacy, [], [], undefined, 999).rows[0]?.interruption === 'unknown');
  check('each cause has a distinct task reason; the legacy reason stays for unknown', new Set(Object.values(TASK_INTERRUPTION_REASON)).size === 4
    && TASK_INTERRUPTION_REASON.unknown === 'ADE restarted before task completion');
  check('cause projection carries no paths', !JSON.stringify(rows).includes('/private'));
} finally {
  rmSync(root, { recursive: true, force: true });
}
console.log(`Host lifecycle: ${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
