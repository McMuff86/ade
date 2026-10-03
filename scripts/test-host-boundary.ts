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
import { importGraph } from './helpers/importGraph';

/** Modules reached from the host entry on the last green run (H1a: 102, H1b: 133, H1c: 142). Raise, never lower. */
const MIN_HOST_MODULES = 142;
const HOST_ENTRY = 'src/main/host/index.ts';
const FORBIDDEN = ['electron'];
/** Desktop-only modules: Electron-free at runtime by themselves, but the host reaches clients only through ports. */
const DESKTOP_ONLY = ['src/main/rendererWindows.ts', 'src/main/notifications.ts', 'src/main/ipc.ts', 'src/main/index.ts'];
const FIXTURES = 'scripts/fixtures/host-boundary';

let passed = 0; let failed = 0;
const check = (label: string, ok: boolean, detail?: string) => {
  if (ok) { passed++; console.log(`  ok  ${label}`); } else { failed++; console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`); }
};
const chainOf = (graph: ReturnType<typeof importGraph>, name: string) => graph.packages.get(name)?.join(' -> ');

const host = importGraph([HOST_ENTRY]);
console.log(`host entry reaches ${host.modules.length} modules (minimum ${MIN_HOST_MODULES})`);
for (const name of FORBIDDEN) {
  check(`host runtime graph does not reach "${name}"`, !host.packages.has(name), chainOf(host, name));
}
for (const file of DESKTOP_ONLY) {
  check(`host graph does not reach the desktop-only module ${file}`, !host.modules.includes(file), host.chains.get(file)?.join(' -> '));
}
check(`host graph reaches at least ${MIN_HOST_MODULES} modules (no vacuous pass)`, host.modules.length >= MIN_HOST_MODULES,
  `only ${host.modules.length}`);
check('host graph contains the orchestration core, so resolution really walked the sources',
  host.modules.includes('src/main/orchestration/OrchestrationService.ts')
  && host.modules.includes('src/main/application/AdeApplicationService.ts'));

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
