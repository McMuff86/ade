import { join } from 'node:path';
import { chromium, type ElectronApplication, type Page } from 'playwright';
import { mobileTlsProxy } from './mobileBrowser';
import { isBuildInfo } from '../../src/shared/buildInfo';
import { REMOTE_SCOPE_LABELS } from '../../src/shared/setup';
import type { MobileHostState } from '../../src/shared/remote';

/** Real signed browser requests; only build/failed-response negative controls are intercepted. */
export async function checkMobileSetup(app: ElectronApplication, desktop: Page, port: number, evidence: string, check: (name: string, ok: boolean) => void) {
  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0]!.setSize(1280, 1000); });
  await desktop.getByRole('button', { name: 'Einrichtung', exact: true }).click();
  const setup = desktop.getByRole('dialog', { name: 'ADE einrichten', exact: true });
  const pcBuild = (await setup.getByLabel('ADE-Build auf dem PC', { exact: true }).innerText()).match(/[a-f0-9]{20}/)?.[0];
  check('desktop exposes a compiled source identity', !!pcBuild);
  await setup.getByRole('button', { name: '3. Tablet verbinden', exact: true }).click();
  const mobile = setup.getByTestId('mobile-access');
  await mobile.getByRole('button', { name: 'Mit Tailscale aktivieren', exact: true }).click();
  await mobile.getByText('Private Freigabe eingerichtet.', { exact: true }).waitFor();
  await mobile.getByRole('button', { name: 'Tablet oder Smartphone koppeln', exact: true }).click();
  const code = await mobile.getByLabel('Einmaliger Pairing-Code', { exact: true }).inputValue();
  const proxy = await mobileTlsProxy(); proxy.target(port); proxy.rewriteOrigin('https://ade-mobile.fixture.ts.net');
  const browser = await chromium.launch({ args: ['--ignore-certificate-errors', '--host-resolver-rules=MAP ade-mobile.fixture.ts.net 127.0.0.1'] });
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 }, hasTouch: true, ignoreHTTPSErrors: true });
  const page = await context.newPage(); page.setDefaultTimeout(30_000); const errors: string[] = []; page.on('pageerror', (error) => errors.push(error.message));
  try {
    let mode: 'real' | 'different' | 'unknown' | 'failure' = 'real'; let actualHost: MobileHostState | undefined;
    await page.route('**/api/v1/host', async (route) => {
      try {
      if (mode === 'failure') { await route.fulfill({ status: 503, json: { error: 'service_unavailable' } }); return; }
      // route.fetch uses Node DNS, outside Chromium's isolated host-resolver rule.
      const response = await route.fetch({ url: `${proxy.localOrigin}/api/v1/host` });
      if (!response.ok()) { await route.fulfill({ response }); return; }
      const data = await response.json() as MobileHostState; actualHost = data;
      if (mode === 'different') await route.fulfill({ response, json: { ...data, build: { ...data.build, sourceId: '00000000000000000000' } } });
      else if (mode === 'unknown') { const { build: _build, ...legacy } = data; await route.fulfill({ response, json: legacy }); }
      else await route.fulfill({ response });
      } catch { await route.abort('failed').catch(() => undefined); }
    });
    await page.goto(`${proxy.origin}/#pair=${code}`);
    await page.getByLabel('Gerätename', { exact: true }).fill('Einrichtungs-Tablet');
    await page.getByRole('button', { name: 'Dieses Gerät verbinden', exact: true }).click();
    await page.getByRole('status').filter({ hasText: /^Verbunden$/ }).waitFor();
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    const settings = page.getByRole('dialog', { name: 'Settings', exact: true });
    const builds = settings.getByRole('region', { name: 'Build-Stand', exact: true });
    const readiness = settings.getByRole('region', { name: 'Einrichtung auf diesem Gerät', exact: true });
    const refresh = settings.getByRole('button', { name: 'Einrichtungsstatus aktualisieren', exact: true });
    await builds.getByText('Browser und PC verwenden denselben Quellstand.', { exact: true }).waitFor();
    check('signed host metadata and both UIs use the same compiled source', isBuildInfo(actualHost?.build) && actualHost?.build?.sourceId === pcBuild && (await builds.locator('dd').allTextContents()).every((text) => text.includes(pcBuild!)));
    check('host build descriptor contains no host paths', Object.keys(actualHost!.build!).sort().join() === 'builtAt,sourceId');
    check('mobile settings take keyboard focus', await settings.evaluate((node) => node.contains(document.activeElement)));
    await readiness.getByText('Für dieses Vorhaben fehlen noch Einstellungen oder Freigaben.', { exact: true }).waitFor();
    check('ungranted project flow names missing desktop switches', (await readiness.getByRole('list').innerText()).includes(REMOTE_SCOPE_LABELS['projects:write']) && (await readiness.innerText()).includes('Projektarbeit auswählen'));
    await readiness.getByLabel('Vorhaben auf diesem Gerät', { exact: true }).selectOption('results');
    check('result reading shows exactly its single needed grant', await readiness.getByRole('listitem').count() === 1 && await readiness.getByRole('listitem').innerText() === REMOTE_SCOPE_LABELS['workspace:read']);
    await setup.getByRole('button', { name: '4. Freigaben prüfen', exact: true }).click();
    const permissions = setup.getByRole('group', { name: 'Verwaltungsrechte für Einrichtungs-Tablet', exact: true });
    await permissions.getByRole('button', { name: 'Dateilesen auswählen', exact: true }).click();
    check('read preset changes only its checkbox before save', await permissions.getByRole('checkbox', { checked: true }).count() === 1 && !(await desktop.evaluate(() => window.ade.invoke('remoteDevices:list'))).devices[0]!.adminScopes?.length);
    await permissions.getByRole('checkbox', { name: REMOTE_SCOPE_LABELS['profiles:write'], exact: true }).check();
    await permissions.getByRole('button', { name: 'Projektarbeit auswählen', exact: true }).click();
    check('project preset preserves deliberate profile grant without adding publish or restart', await permissions.getByRole('checkbox', { name: REMOTE_SCOPE_LABELS['profiles:write'], exact: true }).isChecked()
      && !await permissions.getByRole('checkbox', { name: REMOTE_SCOPE_LABELS['projectGit:publish'], exact: true }).isChecked() && !await permissions.getByRole('checkbox', { name: REMOTE_SCOPE_LABELS['host:restart'], exact: true }).isChecked());
    await permissions.getByRole('button', { name: 'Verwaltungsrechte speichern', exact: true }).scrollIntoViewIfNeeded();
    await desktop.screenshot({ path: join(evidence, '26-device-permission-presets.png') });
    await permissions.getByRole('button', { name: 'Verwaltungsrechte speichern', exact: true }).click();
    await setup.getByText('Verwaltungsrechte gespeichert. Das Gerät verbindet sich erneut.', { exact: true }).waitFor();
    await readiness.getByText('Die nötigen Einstellungen und Gerätefreigaben sind vorhanden.', { exact: true }).waitFor();
    check('explicit save refreshes permissions on the same paired device', (await desktop.evaluate(() => window.ade.invoke('remoteDevices:list'))).devices.length === 1);
    await readiness.getByLabel('Vorhaben auf diesem Gerät', { exact: true }).selectOption('project');
    check('project readiness does not claim CLI authentication', await readiness.getByText('Die nötigen Einstellungen und Gerätefreigaben sind vorhanden.', { exact: true }).isVisible() && (await readiness.innerText()).includes('Vorhandene Freigaben bestätigen keine CLI-Anmeldung.'));
    await readiness.getByLabel('Vorhaben auf diesem Gerät', { exact: true }).selectOption('publish');
    check('publishing remains separately missing after project grant', await readiness.getByRole('listitem').count() === 1 && await readiness.getByRole('listitem').innerText() === REMOTE_SCOPE_LABELS['projectGit:publish']);
    await readiness.getByLabel('Vorhaben auf diesem Gerät', { exact: true }).selectOption('project');
    await builds.scrollIntoViewIfNeeded(); await page.screenshot({ path: join(evidence, '27-mobile-setup-status.png') });
    await page.evaluate(() => { document.documentElement.dataset.setupNoReload = 'preserve-current-document'; });
    mode = 'different'; await refresh.click();
    await builds.getByText('Browser und PC verwenden unterschiedliche Builds.', { exact: false }).waitFor();
    check('different build gives manual recovery without reloading the page', (await builds.innerText()).includes('Entwürfe zuerst sichern') && await page.evaluate(() => document.documentElement.dataset.setupNoReload) === 'preserve-current-document');
    mode = 'unknown'; await refresh.click();
    await builds.getByText('Build-Vergleich nicht möglich:', { exact: false }).waitFor();
    check('legacy build absence is unknown rather than outdated', !(await builds.innerText()).includes('unterschiedliche Builds') && (await builds.innerText()).includes('Build nicht gemeldet'));
    mode = 'failure'; await refresh.click();
    await settings.getByRole('alert').filter({ hasText: 'Host-Zustand konnte nicht geladen werden.' }).waitFor();
    check('failed status request clears stale ready claims', !await readiness.getByText('Die nötigen Einstellungen und Gerätefreigaben sind vorhanden.', { exact: true }).count() && !await settings.getByText('Erreichbar', { exact: true }).count());
    mode = 'real'; await refresh.click();
    await builds.getByText('Browser und PC verwenden denselben Quellstand.', { exact: true }).waitFor();
    check('positive authenticated retry restores verified build comparison', !await settings.getByRole('alert').count());
    proxy.setApiOffline(true);
    await page.getByRole('status').filter({ hasText: /^Offline$/ }).waitFor();
    check('offline status identifies cached PC data and disables next action', (await builds.innerText()).includes('letzten Antwort') && await readiness.getByRole('button', { name: 'Zu den Projekten', exact: true }).isDisabled() && !await settings.getByText('Erreichbar', { exact: true }).count());
    proxy.setApiOffline(false);
    await builds.getByText('Browser und PC verwenden denselben Quellstand.', { exact: true }).waitFor();
    check('reconnection restores truthful readiness without new pairing', await readiness.getByText('Die nötigen Einstellungen und Gerätefreigaben sind vorhanden.', { exact: true }).isVisible());
    await page.setViewportSize({ width: 390, height: 844 });
    check('build and permission status fit a narrow phone viewport', await settings.evaluate((node) => node.scrollWidth <= node.clientWidth && node.getBoundingClientRect().right <= innerWidth));
    await page.keyboard.press('Escape');
    check('mobile settings restore opener focus', await page.getByRole('button', { name: 'Settings', exact: true }).evaluate((node) => node === document.activeElement));
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await readiness.getByRole('button', { name: 'Zu den Projekten', exact: true }).click();
    check('next project step closes settings and focuses destination', !await settings.count() && await page.getByRole('tab', { name: 'Projekte', exact: true }).evaluate((node) => node === document.activeElement));
    check('real browser setup has no unhandled renderer errors', errors.length === 0);
  } catch (error) { await page.screenshot({ path: join(evidence, 'mobile-setup-failure.png') }).catch(() => undefined); throw error; }
  finally { await browser.close(); await proxy.close(); }
}
