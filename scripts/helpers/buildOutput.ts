import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Locates the production build a driver launches or serves.
 *
 * `pnpm verify` builds into an isolated directory and exports it as
 * `ADE_BUILD_DIR`, so no driver reads `out/`, which the personal ADE instance
 * runs from. Without it, drivers use `out/` as before. The older per-suite
 * overrides (`ADE_E2E_MAIN`, `ADE_MOBILE_ASSETS`, …) still win when set.
 */
const REPOSITORY = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export function buildDir(): string {
  const configured = process.env.ADE_BUILD_DIR;
  return configured ? resolve(configured) : join(REPOSITORY, 'out');
}

/** Main-process entry of the build under test. */
export function mainEntry(override?: string): string {
  return override ? resolve(override) : join(buildDir(), 'main', 'index.js');
}

/** Tablet assets of the build under test. */
export function mobileAssetsDir(override?: string): string {
  return override ? resolve(override) : join(buildDir(), 'mobile');
}
