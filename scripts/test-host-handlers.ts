/**
 * Goal 34.6 H1g: the host's handler table, composed in plain Node.
 *
 * composeHost runs here without Electron, with a disposable profile and test
 * ports. Every channel in CHANNEL_POLICY must have exactly one handler: a host
 * handler reached through dispatch(), or one of the Electron-bound desktop
 * handlers registered in ipc.ts. The guard keeps the former IPC hull: reads
 * bypass the fence, catalog mutations emit catalog:changed, failures leave
 * through the redaction funnel. After dispose the host services are null again,
 * so late calls fail instead of acting on disposed services.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { IPC, IPC_EVENTS } from '../src/shared/ipc';
import { CHANNEL_POLICY } from '../src/main/ipcPolicy';
import { ConfigStore } from '../src/main/config/store';
import { composeHost } from '../src/main/host/composeHost';
import { configPath, profilePaths } from '../src/main/host/profilePaths';
import { NO_HOST_NOTIFIER, type HostClient } from '../src/main/host/ports';

let passed = 0; let failed = 0;
const check = (label: string, ok: boolean) => { if (ok) { passed++; console.log(`  ok  ${label}`); } else { failed++; console.error(`FAIL  ${label}`); } };
const rejects = async (fn: () => Promise<unknown>) => { try { await fn(); return null; } catch (error) { return error as Error; } };

async function main(): Promise<void> {
const root = mkdtempSync(join(tmpdir(), 'ade-host-handlers-'));
const savedEnv = { ...process.env };
try {
  for (const name of ['ADE_HOST_API_ENABLED', 'ADE_HOST_API_TOKEN', 'ADE_MOBILE_PORT']) delete process.env[name];
  const paths = profilePaths(join(root, 'userData'));
  const store = new ConfigStore(configPath(paths));
  const emitted: Array<{ channel: string; payload: unknown }> = [];
  let blocker = 0; const started = new Set<number>();
  const host = await composeHost(store, {
    events: { emit: (channel, payload) => emitted.push({ channel, payload }) },
    notifier: NO_HOST_NOTIFIER,
    images: { checkDimensions: () => undefined, toPng: (bytes) => bytes, profilePng: (bytes) => bytes },
    secrets: { available: () => true, encrypt: (v) => Buffer.from(`enc:${v}`), decrypt: (b) => b.toString().slice(4) },
    power: { start: () => { blocker += 1; started.add(blocker); return blocker; }, stop: (id) => started.delete(id), isStarted: (id) => started.has(id) },
    startup: { supported: false, enabled: () => false, set: () => { throw new Error('Autostart unavailable.'); } },
    relaunch: { relaunch: () => { throw new Error('relaunch must not run in this suite'); } },
    app: { version: 'test', packaged: false },
    paths,
  });
  check('composeHost builds the whole host in plain Node (no Electron)', typeof host.dispatch === 'function');

  // One handler per channel: host table or the Electron-bound desktop list in ipc.ts.
  const ipcSource = readFileSync(join(import.meta.dirname, '..', 'src', 'main', 'ipc.ts'), 'utf8');
  const desktopNames = [...ipcSource.matchAll(/^\s{2}handle(?:WithEvent|WithClient)?\(IPC\.(\w+)/gm)].map((match) => match[1]!);
  const desktopChannels = desktopNames.map((name) => (IPC as Record<string, string>)[name]!);
  const hostChannels = host.channels();
  const policyChannels = Object.keys(CHANNEL_POLICY).sort();
  check(`desktop adapter keeps only the ${desktopChannels.length} Electron-bound handlers`, desktopChannels.length === 13 && desktopChannels.every(Boolean));
  check('host and desktop handlers are disjoint', desktopChannels.every((channel) => !hostChannels.includes(channel as never)));
  check(`every one of the ${policyChannels.length} policy channels has exactly one handler`,
    JSON.stringify([...hostChannels, ...desktopChannels].sort()) === JSON.stringify(policyChannels));
  check('ipc.ts registers host channels only generically through dispatch', /for \(const channel of host\.channels\(\)\) registerHostChannel\(channel\);/.test(ipcSource)
    && /host!\.dispatch\(channel, payload, desktopClients\.for\(event\.sender\)\)/.test(ipcSource));

  const client: HostClient = { id: 'test-client', alive: () => true, onClose: () => undefined };
  const config = await host.dispatch(IPC.ConfigGet, undefined, client) as { categories: unknown[] };
  check('a read channel dispatches to its host handler', Array.isArray(config.categories));
  const before = emitted.length;
  const category = await host.dispatch(IPC.CategoryCreate, { name: 'Host table' }, client) as { id: string };
  check('a catalog mutation runs and emits catalog:changed through the events port',
    Boolean(category.id) && emitted.slice(before).some((event) => event.channel === IPC_EVENTS.CatalogChanged));
  const unknown = await rejects(() => host.dispatch('no:such-channel' as never, undefined, client));
  check('an unknown channel is refused', unknown !== null);
  const failure = await rejects(() => host.dispatch(IPC.CategoryUpdate, { id: 'missing-category', name: 'x' }, client));
  check('a failing handler leaves through the redaction funnel as a plain Error', failure instanceof Error && failure.constructor === Error);

  await host.dispose();
  host.markCleanShutdown();
  const late = await rejects(() => host.dispatch(IPC.PtyList, undefined, client));
  check('after dispose the PTY layer is null again, so a late call fails instead of acting on a disposed service', late !== null);
} finally {
  process.env = savedEnv;
  rmSync(root, { recursive: true, force: true });
}
}

void main().then(() => {
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}, (error: unknown) => { console.error(error); process.exit(1); });
