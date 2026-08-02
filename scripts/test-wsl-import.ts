/**
 * Live Windows -> WSL workspace import.
 *
 * Opt-in, because it needs a real WSL distribution with python3 and it creates
 * and removes a directory inside it. Everything else about it is real: the real
 * ExecutionBackendService, the real TargetPathProbe shelling into the distro,
 * the real ExecutionBackendHomeProvisioner, the real ConfigStore on disk and
 * the real transactional importer.
 *
 *   pnpm run test:wsl-import                 # against the default distro
 *   pnpm run test:wsl-import -- --distro X   # against a named one
 *
 * Without a usable distro it reports that and exits 0 — a machine without WSL
 * is not a failing machine.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigStore } from '../src/main/config/store';
import { ExecutionBackendService } from '../src/main/execution/ExecutionBackendService';
import { ExecutionBackendHomeProvisioner } from '../src/main/portability/ExecutionBackendHomeProvisioner';
import { TargetPathProbe } from '../src/main/portability/TargetPathProbe';
import { WorkspaceImportService } from '../src/main/portability/WorkspaceImportService';
import { planWorkspaceImport, type WorkspaceImportMappings } from '../src/main/portability/WorkspaceImportPlanner';
import { exportWorkspaceBundle } from '../src/main/portability/WorkspaceBundleExporter';
import { parseWorkspaceBundle } from '../src/shared/workspaceBundle';
import { DEFAULT_CONFIG, type AdeConfig, type Agent, type Category } from '../src/shared/types';

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

function wsl(distro: string, script: string): { code: number; out: string } {
  try {
    const out = execFileSync('wsl.exe', ['-d', distro, '--', 'bash', '-lc', script], {
      encoding: 'utf8', timeout: 60_000,
    });
    return { code: 0, out: out.replace(/\0/g, '').trim() };
  } catch (error) {
    const shaped = error as { status?: number; stdout?: string; stderr?: string };
    return {
      code: shaped.status ?? 1,
      out: `${shaped.stdout ?? ''}${shaped.stderr ?? ''}`.replace(/\0/g, '').trim(),
    };
  }
}

function resolveDistro(): string | null {
  const flag = process.argv.indexOf('--distro');
  if (flag >= 0 && process.argv[flag + 1]) return process.argv[flag + 1]!;
  try {
    const listed = execFileSync('wsl.exe', ['--list', '--quiet'], { encoding: 'utf8', timeout: 30_000 })
      .replace(/\0/g, '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && line !== 'docker-desktop');
    return listed[0] ?? null;
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  if (process.platform !== 'win32') {
    console.log('  --  live WSL import (skipped: a wsl: target is reachable only from a Windows host)');
    return;
  }
  const distro = resolveDistro();
  if (!distro) {
    console.log('  --  live WSL import (skipped: no WSL distribution found)');
    return;
  }
  const python = wsl(distro, 'command -v python3');
  if (python.code !== 0) {
    console.log(`  --  live WSL import (skipped: ${distro} has no python3, which provisioning needs)`);
    return;
  }
  console.log(`Live WSL import against "${distro}" (python3 at ${python.out})\n`);

  const linuxHome = wsl(distro, 'printf %s "$HOME"').out;
  const target = `${linuxHome}/.ade-wsl-import-check`;
  wsl(distro, `rm -rf '${target}'`);

  const root = mkdtempSync(join(tmpdir(), 'ade-wsl-import-'));
  const profileDir = join(root, 'profile', 'ade');
  mkdirSync(profileDir, { recursive: true });

  try {
    const store = new ConfigStore(join(profileDir, 'config.json'));

    // The bundle a Windows profile would export: one category, one agent.
    const category: Category = {
      id: 'wsl-source-category', name: 'WSL Migration', kind: 'plain', agents: ['wsl-source-agent'],
    };
    const agent: Agent = {
      id: 'wsl-source-agent', categoryId: category.id, name: 'WSL Imported Agent',
      runtime: 'shell', permissionMode: 'default',
      workspaceDir: 'C:\\source\\not-portable', memoryDir: 'C:\\source\\not-portable-memory',
    };
    const sourceConfig: AdeConfig = {
      ...structuredClone(DEFAULT_CONFIG), categories: [category], agents: [agent],
    };
    const bundle = parseWorkspaceBundle(exportWorkspaceBundle(sourceConfig, {
      sourcePlatform: 'win32', exportedAt: '2026-08-02T00:00:00.000Z',
    }).bundle);

    const execution = new ExecutionBackendService();
    const probe = new TargetPathProbe({ hostPlatform: process.platform }, execution);
    const mappings: WorkspaceImportMappings = {
      repositories: {},
      agentHomes: { [bundle.agents[0]!.id]: { backend: `wsl:${distro}`, path: target } },
    };

    const plan = await planWorkspaceImport(
      bundle, store.get(), mappings, probe, { hostPlatform: process.platform },
    );
    check('a wsl: agent home is planned as applicable from the Windows host',
      plan.canApplyFully,
      plan.agentHomes.map((item) => ({ status: item.status, reason: item.reason })));

    const service = new WorkspaceImportService({
      profileDir,
      store,
      probe,
      hostPlatform: process.platform,
      homeProvisioner: new ExecutionBackendHomeProvisioner(execution),
    });
    const receipt = await service.apply(plan, mappings);

    check('the agent home really exists inside the distribution',
      wsl(distro, `test -d '${target}' && echo yes`).out === 'yes');
    check('the home carries ADE\u2019s import ownership marker',
      wsl(distro, `test -f '${target}/.ade-workspace-import-owner' && echo yes`).out === 'yes');
    check('the home is private to the user (0700)',
      wsl(distro, `stat -c %a '${target}'`).out === '700');

    const imported = store.get().agents.find((item) => item.name.includes('WSL Imported Agent'));
    check('the imported agent points at the WSL home',
      imported?.homeWorkspaceDir === target
        && imported?.homeExecutionBackend === `wsl:${distro}`,
      { homeWorkspaceDir: imported?.homeWorkspaceDir, backend: imported?.homeExecutionBackend });
    check('the import produced a durable backup and receipt', Boolean(receipt.receiptPath));

    // What this migration does NOT carry across, stated rather than implied.
    const memoryInWsl = wsl(distro, `test -e '${target}/MEMORY.md' && echo yes || echo no`).out;
    console.log(`\n  note  agent memory inside the distro: ${memoryInWsl === 'yes' ? 'present' : 'absent'}`
      + ` (memoryDir stays host-side at ${imported?.memoryDir ?? 'n/a'})`);
  } finally {
    wsl(distro, `rm -rf '${target}'`);
    rmSync(root, { recursive: true, force: true });
  }

  console.log(`\nLive WSL import: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

void main();
