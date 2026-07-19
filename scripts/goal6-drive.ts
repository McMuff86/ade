/**
 * Goal 6 operator drivers — drive the real ADE build through the UI the way
 * the operator would, against the real profile (%APPDATA%/ADE).
 *
 * Modes:
 *   managed   create a managed run for a fixture, start orchestration, wait
 *             for the approval gate (or a terminal state), dump the gate
 *             reason + diff, then close. The gate is restart-durable.
 *   approve   reopen, approve the pending integration of --run, follow it to
 *             completed.
 *   reject    reopen, reject the pending integration of --run, verify the
 *             run leaves the approval phase.
 *   baseline  create a manual run (no orchestrator, single agent), dispatch
 *             the fixture goal one-shot via "Direkt an Teams", wait for
 *             completion.
 *
 * Usage examples:
 *   pnpm exec tsx scripts/goal6-drive.ts --mode managed --fixture F5 \
 *     --name "F5 arena-presets (managed)" --orchestrator "Main Chef" \
 *     --agents "Worker A,Worker B,Worker C" --parallel 4
 *   pnpm exec tsx scripts/goal6-drive.ts --mode approve --run "F5 arena"
 *   pnpm exec tsx scripts/goal6-drive.ts --mode baseline --fixture F5 \
 *     --name "F5 arena-presets (baseline)" --agents "Test_Agent_2D_Jump"
 *
 * Protocol reminders (docs/goal6/VALIDATION_PLAN.md):
 *   - The goal is ONLY the fixture's fenced block; this script extracts it.
 *   - Before approving, machine-check the worker commit range yourself.
 *   - After a run terminates: evidence branches, then reset the ade
 *     worktrees to the recorded baseline SHA. Never while a lease is active.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, type ElectronApplication, type Page } from 'playwright';

const root = join(__dirname, '..');
const shots = join(tmpdir(), 'ade-goal6-shots');
const GOAL6_CODEX_MODEL = 'gpt-5.6-sol';
const GOAL6_WORKER_REASONING = new Set(['high', 'xhigh', 'max', 'ultra']);

interface Options {
  mode: 'managed' | 'approve' | 'reject' | 'baseline';
  fixture?: string;
  name?: string;
  run?: string;
  orchestrator?: string;
  agents: string[];
  parallel?: number;
  timeoutMin: number;
}

function parseArgs(): Options {
  const argv = process.argv.slice(2);
  const get = (flag: string): string | undefined => {
    const index = argv.indexOf(`--${flag}`);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  const mode = get('mode') as Options['mode'];
  if (!['managed', 'approve', 'reject', 'baseline'].includes(mode ?? '')) {
    throw new Error('goal6-drive: --mode managed|approve|reject|baseline is required');
  }
  return {
    mode,
    fixture: get('fixture'),
    name: get('name'),
    run: get('run'),
    orchestrator: get('orchestrator'),
    agents: (get('agents') ?? '').split(',').map((value) => value.trim()).filter(Boolean),
    parallel: get('parallel') ? Number(get('parallel')) : undefined,
    timeoutMin: get('timeout-min') ? Number(get('timeout-min')) : 45,
  };
}

let passed = 0;
let failed = 0;
function check(label: string, condition: boolean, detail?: unknown): void {
  if (condition) { passed += 1; console.log(`  ok  ${label}`); }
  else { failed += 1; console.error(`FAIL  ${label}`, detail ?? ''); }
}

/** The fixture's fenced goal block, verbatim — never the card metadata. */
function fixtureGoal(id: string): string {
  const plan = readFileSync(join(root, 'docs', 'goal6', 'VALIDATION_PLAN.md'), 'utf8')
    .replace(/\r\n/g, '\n');
  const pattern = new RegExp(`### ${id}[^\\n]*\\n[\\s\\S]*?\`\`\`text\\n([\\s\\S]*?)\`\`\``);
  const match = plan.match(pattern);
  if (!match) throw new Error(`goal6-drive: no fenced block found for fixture ${id}`);
  return match[1]!.trim();
}

async function launch(): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    args: [join(root, 'out/main/index.js')],
    cwd: root,
    env: { ...process.env, ADE_USER_DATA_DIR: join(process.env['APPDATA']!, 'ADE') },
    timeout: 20_000,
  });
  const page = await app.firstWindow({ timeout: 20_000 });
  await page.waitForLoadState('domcontentloaded');
  // Real window size instead of Playwright viewport emulation: the emulation
  // pins the renderer even when the operator maximizes the window mid-run
  // (CDP clearDeviceMetricsOverride proved ineffective on the Electron page).
  // A native resize keeps clicks deterministic and lets manual maximize /
  // fullscreen win afterwards.
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      win.setContentSize(1440, 900);
      win.center();
    }
  });
  await page.waitForTimeout(1_500);
  await page.keyboard.press('Control+2');
  return { app, page };
}

async function pasteInto(app: ElectronApplication, page: Page, locator: ReturnType<Page['locator']>, text: string): Promise<void> {
  await app.evaluate(({ clipboard }, value) => clipboard.writeText(value), text);
  await locator.click();
  await page.keyboard.press('Control+v');
  await page.waitForTimeout(200);
}

async function selectRun(page: Page, match: string): Promise<string> {
  const runSelect = page.locator('select').first();
  await runSelect.waitFor({ state: 'visible', timeout: 10_000 });
  const labels = await runSelect.locator('option').allInnerTexts();
  const label = labels.find((candidate) => candidate.toLowerCase().includes(match.toLowerCase()));
  if (!label) throw new Error(`goal6-drive: no run matches "${match}" (${labels.join(' | ')})`);
  await runSelect.selectOption({ label });
  return label;
}

/**
 * Goal 6 is a Codex-only measurement. Fail before run creation if a selected
 * identity could silently fall back to Claude/custom/default model settings or
 * lacks its durable AGENTS.md role contract.
 */
async function assertCodexRoster(page: Page, options: Options): Promise<void> {
  const rosterNames = [options.orchestrator, ...options.agents].filter(Boolean) as string[];
  const agents = await page.evaluate(async () => {
    const api = (window as unknown as {
      ade: { invoke: (channel: string, payload?: unknown) => Promise<unknown> };
    }).ade;
    const config = await api.invoke('config:get') as {
      agents: Array<{
        id: string;
        name: string;
        runtime: string;
        permissionMode: string;
        teamRole?: string;
        customCommand?: string;
        codexModel?: string;
        codexReasoningEffort?: string;
      }>;
    };
    return config.agents;
  });
  const violations: string[] = [];
  for (const name of rosterNames) {
    const matches = agents.filter((agent) => agent.name === name);
    if (matches.length !== 1) {
      violations.push(`${name}: expected one saved identity, found ${matches.length}`);
      continue;
    }
    const agent = matches[0]!;
    if (agent.runtime !== 'codex') violations.push(`${name}: runtime=${agent.runtime}, expected codex`);
    if (agent.permissionMode !== 'bypass') {
      violations.push(`${name}: permissionMode=${agent.permissionMode}, expected bypass`);
    }
    if (agent.customCommand?.trim()) violations.push(`${name}: customCommand would bypass the native Codex adapter`);
    if (agent.codexModel !== GOAL6_CODEX_MODEL) {
      violations.push(`${name}: model=${agent.codexModel ?? 'unset'}, expected ${GOAL6_CODEX_MODEL}`);
    }
    const isOrchestrator = options.orchestrator === name;
    if (isOrchestrator && agent.codexReasoningEffort !== 'xhigh') {
      violations.push(`${name}: reasoning=${agent.codexReasoningEffort ?? 'unset'}, expected xhigh`);
    }
    if (!isOrchestrator && !GOAL6_WORKER_REASONING.has(agent.codexReasoningEffort ?? '')) {
      violations.push(`${name}: reasoning=${agent.codexReasoningEffort ?? 'unset'}, expected high or deeper`);
    }
    const agentsContract = await page.evaluate(async ({ agentId }) => {
      const api = (window as unknown as {
        ade: { invoke: (channel: string, payload?: unknown) => Promise<unknown> };
      }).ade;
      const files = await api.invoke('fs:agentFiles', { agentId }) as Array<{ name: string }>;
      if (!files.some((file) => file.name === 'AGENTS.md')) return { exists: false, text: '' };
      const content = await api.invoke('fs:read', { agentId, path: 'AGENTS.md' }) as { text: string };
      return { exists: true, text: content.text };
    }, { agentId: agent.id });
    if (!agentsContract.exists) {
      violations.push(`${name}: durable AGENTS.md is missing`);
    } else {
      const expectedRole = isOrchestrator
        ? 'main orchestrator'
        : agent.teamRole === 'lead'
          ? 'team lead'
          : 'worker';
      if (!agentsContract.text.includes(`Orchestration role: ${expectedRole}`)) {
        violations.push(`${name}: AGENTS.md does not declare role ${expectedRole}`);
      }
    }
  }
  check('selected Goal 6 roster is Codex-only with pinned model, reasoning, bypass and AGENTS.md',
    violations.length === 0, violations);
  if (violations.length > 0) {
    throw new Error(`goal6-drive: Codex roster policy failed\n- ${violations.join('\n- ')}`);
  }
}

async function createRun(app: ElectronApplication, page: Page, options: Options, goal: string): Promise<void> {
  await page.getByRole('button', { name: 'Neuer Run' }).first().click();
  const modal = page.locator('.grun-modal');
  await modal.waitFor({ state: 'visible' });

  await modal.locator('input').first().fill(options.name!);
  await pasteInto(app, page, modal.locator('textarea'), goal);
  check('goal pasted exactly', (await modal.locator('textarea').inputValue()) === goal);
  check('no truncation warning', (await modal.locator('.grun-goal-warn').count()) === 0);

  if (options.orchestrator) {
    await modal.locator('select').first().selectOption({ label: options.orchestrator });
  }
  const repoSelect = modal.locator('select').nth(1);
  const repoLabels = await repoSelect.locator('option').allInnerTexts();
  const repoLabel = repoLabels.find((label) => label.includes('2D_rpg_jumpnrun') || label.includes('2d_rpg'));
  check('pilot repository offered', Boolean(repoLabel), repoLabels);
  await repoSelect.selectOption({ label: repoLabel! });

  for (const agent of options.agents) {
    // exact-name filter: hasText is a substring match and would hit
    // Test_Agent_2D_Jump_2/_3 when asked for Test_Agent_2D_Jump
    await modal
      .locator('.grun-agent')
      .filter({ has: page.getByText(agent, { exact: true }) })
      .locator('input[type="checkbox"]')
      .check();
  }
  if (options.parallel) {
    await modal.locator('.grun-budget input').first().fill(String(options.parallel));
  }
  const expected = options.agents.length + (options.orchestrator ? 1 : 0);
  check(`${expected} participants selected`,
    (await modal.locator('.grun-roster-title b').innerText()).startsWith(String(expected)),
    await modal.locator('.grun-roster-title b').innerText());
  await page.screenshot({ path: join(shots, `${options.mode}-dialog.png`) });

  await modal.getByRole('button', { name: 'Run erstellen' }).click();
  await modal.waitFor({ state: 'hidden', timeout: 20_000 });
  check('run created', true);
}

async function dumpGate(page: Page, tag: string): Promise<void> {
  const banner = page.locator('.gapproval');
  await banner.waitFor({ state: 'visible', timeout: 15_000 });
  const reason = await banner.locator('.gapproval-row span').first().innerText();
  await banner.locator('[role="button"]').first().click();
  await banner.locator('.gapproval-commit').first().waitFor({ state: 'visible', timeout: 30_000 });
  const diff = await banner.locator('.gapproval-diff').innerText();
  const file = join(shots, `${tag}-approval-diff.txt`);
  writeFileSync(file, `${reason}\n\n${diff}\n`, 'utf8');
  console.log(`gate reason: ${reason.slice(0, 300)}`);
  console.log(`gate diff dumped to ${file}`);
  await page.screenshot({ path: join(shots, `${tag}-gate.png`) });
}

/** Poll the run bar until one of the given phase/status patterns appears. */
async function waitFor(page: Page, until: RegExp, fail: RegExp, timeoutMs: number): Promise<'until' | 'fail' | 'timeout'> {
  const started = Date.now();
  let last = '';
  while (Date.now() - started < timeoutMs) {
    const phase = await page.locator('.grun-phase').innerText().catch(() => '');
    const status = await page.locator('.grun-status').innerText().catch(() => '');
    const state = `${status} / ${phase}`;
    if (state !== last) {
      console.log(`[${Math.round((Date.now() - started) / 1000)}s] ${last || '(start)'} -> ${state}`);
      last = state;
      await page.screenshot({
        path: join(shots, `phase-${state.replace(/\W+/g, '_').slice(0, 40)}.png`),
      });
    }
    if (until.test(phase) || until.test(status)) return 'until';
    if (fail.test(phase) || fail.test(status)) return 'fail';
    await page.waitForTimeout(10_000);
  }
  return 'timeout';
}

async function main(): Promise<void> {
  mkdirSync(shots, { recursive: true });
  const options = parseArgs();
  console.log(`shots + dumps: ${shots}`);
  const { app, page } = await launch();
  try {
    if (options.mode === 'managed' || options.mode === 'baseline') {
      if (!options.fixture || !options.name) throw new Error('goal6-drive: --fixture and --name are required');
      if (!options.agents.length) throw new Error('goal6-drive: --agents is required');
      if (options.mode === 'managed' && !options.orchestrator) {
        throw new Error('goal6-drive: managed mode requires --orchestrator');
      }
      await assertCodexRoster(page, options);
      const goal = fixtureGoal(options.fixture);
      console.log(`fixture ${options.fixture}: ${goal.length} chars`);
      await createRun(app, page, options, goal);

      if (options.mode === 'managed') {
        await page.getByRole('button', { name: 'Orchestrierung starten' }).click();
        // Pin the run bar to OUR run: polling must never read another run's
        // status (a stale failed run in the bar aborted a healthy baseline).
        await selectRun(page, options.name!);
        const outcome = await waitFor(page, /Freigabe/, /Abgebrochen|Fehlgeschlagen/, options.timeoutMin * 60_000);
        check('reached the approval gate', outcome === 'until', outcome);
        if (outcome === 'until') await dumpGate(page, options.fixture);
      } else {
        await page.getByRole('button', { name: 'Direkt an Teams' }).click();
        const composer = page.locator('.gcomposer');
        await composer.waitFor({ state: 'visible', timeout: 10_000 });
        await pasteInto(app, page, composer.locator('textarea'), goal);
        check('composer carries the exact goal', (await composer.locator('textarea').inputValue()) === goal);
        await composer.getByRole('button', { name: 'Senden' }).click();
        await composer.waitFor({ state: 'hidden', timeout: 15_000 });
        await selectRun(page, options.name!);
        const outcome = await waitFor(page, /Abgeschlossen/, /Fehlgeschlagen|Abgebrochen/, options.timeoutMin * 60_000);
        check('baseline completed', outcome === 'until', outcome);
      }
    } else {
      if (!options.run) throw new Error('goal6-drive: --run <name match> is required');
      const label = await selectRun(page, options.run);
      console.log(`run: ${label}`);
      await dumpGate(page, options.mode);
      if (options.mode === 'approve') {
        await page.locator('.gapproval').getByRole('button', { name: 'Freigeben & integrieren' }).click();
        const outcome = await waitFor(page, /Fertig|Abgeschlossen/, /Abgebrochen|Fehlgeschlagen/, options.timeoutMin * 60_000);
        check('run completed after approval', outcome === 'until', outcome);
      } else {
        await page.locator('.gapproval').getByRole('button', { name: 'Ablehnen' }).click();
        const outcome = await waitFor(page, /Abgebrochen/, /Fertig/, 2 * 60_000);
        check('run cancelled after reject', outcome === 'until', outcome);
      }
    }
    await page.screenshot({ path: join(shots, `${options.mode}-final.png`) });
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exitCode = failed ? 1 : 0;
  } finally {
    await app.close();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
