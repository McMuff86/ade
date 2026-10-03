/**
 * Goal 34.6 H1e: desktop renderers are host clients with a random id.
 *
 * Client-bound state (dictation jobs, reply speech, workspace import
 * selections) is owned by `desktop:<clientId>` instead of Electron's numeric
 * sender id. The ids live in memory only: no store, journal or archive
 * contains a desktop owner, so nothing needs migrating.
 */
import { EventEmitter } from 'node:events';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { DesktopClients, type ClientContents } from '../src/main/desktop/DesktopClients';
import { DictationJobs } from '../src/main/settings/DictationJobs';

let passed = 0; let failed = 0;
const check = (label: string, ok: boolean) => { if (ok) { passed++; console.log(`  ok  ${label}`); } else { failed++; console.error(`FAIL  ${label}`); } };
const throws = (fn: () => unknown) => { try { fn(); return false; } catch { return true; } };

class FakeContents extends EventEmitter implements ClientContents {
  private destroyed = false;
  constructor(readonly id: number) { super(); }
  isDestroyed(): boolean { return this.destroyed; }
  destroy(): void { this.destroyed = true; this.emit('destroyed'); }
}

const clients = new DesktopClients();
const windowA = new FakeContents(1); const windowB = new FakeContents(2);
const a = clients.for(windowA); const b = clients.for(windowB);
check('one renderer keeps one client id across calls', clients.for(windowA) === a && clients.for(windowA).id === a.id);
check('two renderers get different client ids', a.id !== b.id);
check('client ids are random UUIDs, not Electron sender ids', /^[0-9a-f-]{36}$/.test(a.id) && a.id !== String(windowA.id));
check('a live renderer is an alive client', a.alive() && b.alive());

const jobs = new DictationJobs({ transcribe: async () => ({ text: 'never called' }) as never });
const { jobId } = jobs.prepare(`desktop:${a.id}`, () => { if (!a.alive()) throw new Error('closed'); });
check('client B cannot read client A\'s dictation job', throws(() => jobs.read(`desktop:${b.id}`, jobId)));
check('client B cannot cancel client A\'s dictation job', throws(() => jobs.cancel(`desktop:${b.id}`, jobId)));
check('client B cannot submit audio into client A\'s dictation job', throws(() => jobs.submit(`desktop:${b.id}`, jobId, 'k', new Uint8Array([1]))));
check('client A still owns its job (positive control)', jobs.read(`desktop:${a.id}`, jobId).status !== undefined);

let closed = 0;
a.onClose(() => { closed += 1; });
windowA.destroy();
check('closing the renderer runs the close listener exactly once (reply speech revokes there)', closed === 1);
check('a closed renderer is no longer an alive client, so owner-bound authorization fails closed', !a.alive());
const reopened = clients.for(new FakeContents(1));
check('a new renderer after close gets a fresh client id, even with a reused numeric id', reopened.id !== a.id && reopened.alive());
check('other clients are unaffected by one renderer closing', b.alive() && clients.for(windowB) === b);
jobs.dispose();

// Desktop owners are memory-only: since H1g they are built in the host handler table, never in a store.
const mainDir = join(import.meta.dirname, '..', 'src', 'main');
const files: string[] = [];
const walk = (dir: string): void => { for (const name of readdirSync(dir)) { const path = join(dir, name); if (statSync(path).isDirectory()) walk(path); else if (path.endsWith('.ts')) files.push(path); } };
walk(mainDir);
const owners = files.filter((file) => readFileSync(file, 'utf8').includes('desktop:${')).map((file) => relative(mainDir, file));
check('desktop:<clientId> owners are built only in the host handler table (no persisted owner to migrate)', owners.length === 1 && owners[0] === 'host/composeHost.ts');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
