/** Production-build Electron workflow smoke for Goal 3 (Windows-first). */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { _electron as electron, type ElectronApplication, type Page } from 'playwright';
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

async function eventually(
  label: string,
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 15_000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      if (await predicate()) {
        check(label, true);
        return true;
      }
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  check(label, false, lastError);
  return false;
}

function seedConfig(userData: string, workspace: string): void {
  const category: Category = {
    id: 'e2e-category',
    name: 'E2E',
    kind: 'plain',
    agents: ['e2e-agent'],
  };
  const agent: Agent = {
    id: 'e2e-agent',
    categoryId: category.id,
    name: 'E2E Shell',
    role: 'Local workflow',
    runtime: 'shell',
    permissionMode: 'default',
    workspaceDir: workspace,
    memoryDir: join(userData, 'agent-memory'),
  };
  const config: AdeConfig = {
    ...structuredClone(DEFAULT_CONFIG),
    categories: [category],
    agents: [agent],
  };
  const configDir = join(userData, 'ade');
  mkdirSync(configDir, { recursive: true });
  writeFileSync(join(configDir, 'config.json'), `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}

async function activeTabId(page: Page): Promise<string | null> {
  return page.locator('[role="tab"][id^="session-tab-"][aria-selected="true"]').getAttribute('id');
}

async function sendCommand(page: Page, command: string): Promise<void> {
  const input = page.locator('.terminal-pane-wrap:visible .xterm-helper-textarea');
  await input.waitFor({ state: 'visible', timeout: 10_000 });
  await input.click();
  await page.keyboard.type(command);
  await page.keyboard.press('Enter');
}

async function run(): Promise<void> {
  const root = process.cwd();
  const scratch = mkdtempSync(join(tmpdir(), 'ade-e2e-'));
  const userData = join(scratch, 'user-data');
  const workspace = join(scratch, 'workspace');
  mkdirSync(workspace, { recursive: true });
  seedConfig(userData, workspace);

  let app: ElectronApplication | null = null;
  let page: Page | null = null;
  try {
    const packagedExecutable = process.env['ADE_E2E_EXECUTABLE'];
    app = await electron.launch({
      ...(packagedExecutable
        ? { executablePath: resolve(packagedExecutable), args: [] }
        : { args: [join(root, 'out/main/index.js')] }),
      cwd: root,
      env: {
        ...process.env,
        ADE_USER_DATA_DIR: userData,
        ADE_E2E_PTY_LIST_SNAPSHOT_DELAY_MS: '900',
        NODE_ENV: 'test',
      },
      timeout: 20_000,
    });
    page = await app.firstWindow({ timeout: 20_000 });
    await page.waitForLoadState('domcontentloaded');
    await page.locator('.agent-row', { hasText: 'E2E Shell' }).waitFor({ state: 'visible' });

    const surface = await page.evaluate(() => {
      const global = window as unknown as {
        ade?: Record<string, unknown>;
        require?: unknown;
        process?: unknown;
      };
      return {
        api: Object.keys(global.ade ?? {}).sort(),
        requireType: typeof global.require,
        processType: typeof global.process,
        csp: document.querySelector<HTMLMetaElement>('meta[http-equiv="Content-Security-Policy"]')?.content ?? '',
      };
    });
    check('preload exposes only invoke/on', JSON.stringify(surface.api) === JSON.stringify(['invoke', 'on']), surface.api);
    check('renderer has no Node globals', surface.requireType === 'undefined' && surface.processType === 'undefined', surface);
    check('production renderer loaded the restrictive CSP', surface.csp.includes("default-src 'none'"));

    const preferences = await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      const prefs = window?.webContents.getLastWebPreferences();
      return {
        sandbox: prefs?.sandbox,
        contextIsolation: prefs?.contextIsolation,
        nodeIntegration: prefs?.nodeIntegration,
        webviewTag: prefs?.webviewTag,
      };
    });
    check('live renderer is sandboxed and context-isolated',
      preferences.sandbox === true && preferences.contextIsolation === true && preferences.nodeIntegration === false,
      preferences);
    check('webview support is disabled', preferences.webviewTag === false, preferences);

    const invalidPayload = await page.evaluate(async () => {
      try {
        const api = (window as unknown as { ade: { invoke: (...args: unknown[]) => Promise<unknown> } }).ade;
        await api.invoke('pty:resize', { sessionId: 'missing', cols: 80, rows: 24, extra: true });
        return '';
      } catch (error) {
        return String(error);
      }
    });
    check(
      'main rejects malformed payloads from the trusted renderer',
      invalidPayload.includes('invalid IPC payload'),
      invalidPayload,
    );
    const unknownChannel = await page.evaluate(async () => {
      try {
        const api = (window as unknown as { ade: { invoke: (...args: unknown[]) => Promise<unknown> } }).ade;
        await api.invoke('not:a:channel');
        return '';
      } catch (error) {
        return String(error);
      }
    });
    check('preload rejects unknown channels', unknownChannel.includes('unknown invoke channel'), unknownChannel);

    await page.locator('.agent-row', { hasText: 'E2E Shell' }).click();
    await page.keyboard.press('Control+Shift+T');
    const tabs = page.locator('[role="tab"][id^="session-tab-"]');
    await eventually('keyboard shortcut creates a terminal session', async () => await tabs.count() === 1);
    const firstTab = await activeTabId(page);
    check('new session becomes the active tab', Boolean(firstTab));
    await sendCommand(page, 'Write-Output ADE_E2E_READY');
    await eventually('real ConPTY output reaches xterm', async () =>
      (await page!.locator('.terminal-pane-wrap:visible .xterm-rows').textContent())?.includes('ADE_E2E_READY') === true,
    );

    await page.keyboard.press('Control+Shift+T');
    await eventually('a second keyboard-created session runs in parallel', async () => await tabs.count() === 2);
    const secondTab = await activeTabId(page);
    check('second session receives focus', Boolean(secondTab) && secondTab !== firstTab, { firstTab, secondTab });
    await page.keyboard.press('Control+PageUp');
    await eventually('Ctrl+PageUp selects the previous session', async () => await activeTabId(page!) === firstTab);
    await page.keyboard.press('Control+PageDown');
    await eventually('Ctrl+PageDown selects the next session', async () => await activeTabId(page!) === secondTab);

    await sendCommand(page, 'Start-Sleep -Milliseconds 700; Write-Output ADE_RELOAD_OK');
    await page.waitForTimeout(75);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('.agent-row', { hasText: 'E2E Shell' }).click();
    await eventually('renderer reload reconstructs both main-owned sessions', async () =>
      await page!.locator('[role="tab"][id^="session-tab-"]').count() === 2,
    );
    await eventually('output produced across reload is replayed without a gap', async () =>
      (await page!.locator('.terminal-pane-wrap:visible .xterm-rows').textContent())?.includes('ADE_RELOAD_OK') === true,
    );

    await sendCommand(page, 'Start-Sleep -Milliseconds 300; exit 7');
    await page.waitForTimeout(50);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('.agent-row', { hasText: 'E2E Shell' }).click();
    await eventually('exit racing a stale reload snapshot has actionable failure UI', async () =>
      (await page!.locator('.session-notice.error').textContent())?.includes('Session failed (exit 7)') === true,
    );
    const evidenceDir = process.env['ADE_E2E_EVIDENCE_DIR'];
    if (evidenceDir) {
      mkdirSync(resolve(evidenceDir), { recursive: true });
      await page.screenshot({ path: join(resolve(evidenceDir), 'failure-ui.png'), fullPage: true });
    }
    await page.getByRole('button', { name: 'Restart' }).click();
    await eventually('restart replaces the failed interactive session', async () => {
      const selected = page!.locator('[role="tab"][id^="session-tab-"][aria-selected="true"]');
      return await selected.count() === 1 && (await selected.getAttribute('aria-label'))?.includes('running') === true;
    });
    await sendCommand(page, 'Write-Output ADE_RESTART_OK');
    await eventually('restarted terminal accepts input', async () =>
      (await page!.locator('.terminal-pane-wrap:visible .xterm-rows').textContent())?.includes('ADE_RESTART_OK') === true,
    );

    await page.keyboard.press('Control+Shift+W');
    await eventually('close shortcut removes the active tab and PTY', async () =>
      await page!.locator('[role="tab"][id^="session-tab-"]').count() === 1,
    );
    await page.keyboard.press('Control+2');
    await eventually('Ctrl+2 opens Graph mode', async () =>
      await page!.getByRole('tab', { name: 'Graph' }).getAttribute('aria-selected') === 'true',
    );
    await page.keyboard.press('Control+1');
    await eventually('Ctrl+1 returns to Terminals mode', async () =>
      await page!.getByRole('tab', { name: 'Terminals' }).getAttribute('aria-selected') === 'true',
    );

    await page.getByRole('button', { name: 'Diagnostics' }).first().click();
    await page.getByRole('dialog', { name: 'Runtime diagnostics' }).waitFor({ state: 'visible' });
    const diagnosticText = await page.getByRole('dialog', { name: 'Runtime diagnostics' }).textContent();
    check('diagnostics report configured shell readiness without mutation',
      diagnosticText?.includes('E2E Shell') === true && diagnosticText.includes('Interactive shell is ready.'),
      diagnosticText);
    if (evidenceDir) {
      await page.screenshot({ path: join(resolve(evidenceDir), 'diagnostics-ui.png'), fullPage: true });
    }
    await page.getByRole('button', { name: 'Close' }).last().click();
  } catch (error) {
    console.error('Electron workflow threw:', error);
    failed += 1;
    if (page) {
      const resultDir = join(root, 'test-results');
      mkdirSync(resultDir, { recursive: true });
      await page.screenshot({ path: join(resultDir, 'electron-workflow-failure.png'), fullPage: true }).catch(() => undefined);
    }
  } finally {
    await app?.close().catch(() => undefined);
    const safeRoot = resolve(tmpdir());
    const safeScratch = resolve(scratch);
    const rel = relative(safeRoot, safeScratch);
    if (dirname(safeScratch) === safeRoot && rel.startsWith('ade-e2e-')) {
      rmSync(safeScratch, { recursive: true, force: true });
    }
  }

  console.log(`\n${failed ? 'FAILED' : 'PASSED'} - ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

void run();
