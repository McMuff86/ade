/**
 * Goal 34.6 H1: the ADE host must not reach Electron at runtime.
 *
 * Walks the runtime import graph from src/main/host/index.ts (see
 * helpers/importGraph.ts) and fails with the import chain as soon as
 * `electron` is reached. A minimum module count keeps the check from passing
 * vacuously while the host entry is still small; it rises with each stage
 * that moves composition into the host. Fixtures prove the detector itself:
 * a runtime chain and a lazy require must fail, type-only references pass.
 *
 * A deliberate negative control belongs in a module the host reaches at
 * runtime (for example settings/HostOperationService.ts). src/main/host/ports.ts
 * is re-exported with `export type *`, so it is not loaded through the entry
 * and an Electron import placed only there does not trip this check.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import { importGraph } from './helpers/importGraph';

/** Modules reached from host + keyring worker (H1g: 213, H2a: 215, H2b: 219). Raise, never lower. */
const MIN_HOST_MODULES = 219;
const HOST_ENTRY = 'src/main/host/index.ts';
const FORBIDDEN = ['electron'];
/** Desktop-only modules: Electron-free at runtime by themselves, but the host reaches clients only through ports. */
const DESKTOP_ONLY = ['src/main/rendererWindows.ts', 'src/main/notifications.ts', 'src/main/ipc.ts', 'src/main/index.ts',
  'src/main/settings/desktopMicrophone.ts'];
const FIXTURES = 'scripts/fixtures/host-boundary';

let passed = 0; let failed = 0;
const check = (label: string, ok: boolean, detail?: string) => {
  if (ok) { passed++; console.log(`  ok  ${label}`); } else { failed++; console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`); }
};
const chainOf = (graph: ReturnType<typeof importGraph>, name: string) => graph.packages.get(name)?.join(' -> ');

const host = importGraph([HOST_ENTRY, 'src/main/host/secrets/keyringWorker.ts']);
console.log(`host entry reaches ${host.modules.length} modules (minimum ${MIN_HOST_MODULES})`);
for (const name of FORBIDDEN) {
  check(`host runtime graph does not reach "${name}"`, !host.packages.has(name), chainOf(host, name));
}
for (const file of DESKTOP_ONLY) {
  check(`host graph does not reach the desktop-only module ${file}`, !host.modules.includes(file), host.chains.get(file)?.join(' -> '));
}
const desktopAdapter = host.modules.filter((file) => file.startsWith('src/main/desktop/'));
check('host graph reaches nothing under src/main/desktop/ (the Electron port implementations)', desktopAdapter.length === 0,
  desktopAdapter.map((file) => host.chains.get(file)?.join(' -> ')).join('; '));
check(`host graph reaches at least ${MIN_HOST_MODULES} modules (no vacuous pass)`, host.modules.length >= MIN_HOST_MODULES,
  `only ${host.modules.length}`);
check('host graph contains the orchestration core, so resolution really walked the sources',
  host.modules.includes('src/main/orchestration/OrchestrationService.ts')
  && host.modules.includes('src/main/application/AdeApplicationService.ts'));

// Remote adapter invariant: src/main/remote calls only AdeApplicationService, never
// the host composer, its handler table/dispatch, or the desktop IPC adapter.
const remoteDir = join(import.meta.dirname, '..', 'src', 'main', 'remote');
const remoteFiles = readdirSync(remoteDir, { recursive: true }).map(String).filter((name) => name.endsWith('.ts'))
  .map((name) => `src/main/remote/${name.split(sep).join('/')}`);
const remote = importGraph(remoteFiles);
for (const file of ['src/main/host/composeHost.ts', 'src/main/host/handlers.ts', 'src/main/host/index.ts', 'src/main/ipc.ts']) {
  check(`remote adapter does not reach ${file}`, !remote.modules.includes(file), remote.chains.get(file)?.join(' -> '));
}
const remoteDispatch = remoteFiles.filter((file) => /\b(dispatch|guard|channels)\s*\(|\bhostHandlers\b/.test(readFileSync(join(import.meta.dirname, '..', file), 'utf8')));
check('remote adapter never calls dispatch/guard/channels of the host handler table', remoteDispatch.length === 0, remoteDispatch.join(', '));
check('remote adapter reaches AdeApplicationService (positive control)', remote.modules.includes('src/main/application/AdeApplicationService.ts'));

const runtimeChain = importGraph([`${FIXTURES}/runtime-chain/entry.ts`]);
check('negative control: a runtime Electron import two modules deep is detected with its chain',
  chainOf(runtimeChain, 'electron') === [
    `${FIXTURES}/runtime-chain/entry.ts`, `${FIXTURES}/runtime-chain/middle.ts`, `${FIXTURES}/runtime-chain/leaf.ts`, 'electron',
  ].join(' -> '), chainOf(runtimeChain, 'electron'));
const lazy = importGraph([`${FIXTURES}/lazy-require/entry.ts`]);
check('negative control: a lazy require("electron") inside a function is detected', lazy.packages.has('electron'));
const typeOnly = importGraph([`${FIXTURES}/type-only/entry.ts`]);
check('positive control: import type, inline type imports, export type and typeof import() are not runtime imports',
  !typeOnly.packages.has('electron'), chainOf(typeOnly, 'electron'));

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
