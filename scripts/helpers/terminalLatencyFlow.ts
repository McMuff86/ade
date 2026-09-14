import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ElectronApplication, Locator, Page } from 'playwright';

async function samples(page: Page, terminal: Locator, burst: number, raw?: { count: number; offset: number }): Promise<number[]> {
  const direct = terminal.getByLabel('Direkte Terminal-Eingabe', { exact: true });
  await direct.focus();
  let expected = '';
  const times: number[] = [];
  for (let index = 0; index < (raw?.count ?? 20); index++) {
    const text = String.fromCharCode((burst === 1 ? 97 : 65) + index % 26).repeat(burst);
    expected = raw ? `ADE_LATENCY_ECHO_${raw.offset + (index + 1) * burst}_READY` : expected + text;
    await direct.evaluate((node, { expected }) => {
      const measurement = { started: 0, elapsed: 0 };
      (window as unknown as { adeEchoMeasurement: typeof measurement }).adeEchoMeasurement = measurement;
      node.addEventListener('keydown', () => { measurement.started = performance.now(); }, { once: true, capture: true });
      const screen = node.closest('.m-terminal-screen')!;
      const observer = new MutationObserver(() => {
        if (measurement.started && screen.textContent?.includes(expected)) {
          observer.disconnect(); requestAnimationFrame(() => requestAnimationFrame(() => { measurement.elapsed = performance.now() - measurement.started; }));
        }
      });
      observer.observe(screen, { childList: true, characterData: true, subtree: true });
      setTimeout(() => observer.disconnect(), 10_000);
    }, { expected });
    await page.keyboard.type(text);
    await page.waitForFunction(() => (window as unknown as { adeEchoMeasurement: { elapsed: number } }).adeEchoMeasurement.elapsed > 0, undefined, { timeout: 10_000 });
    times.push(await page.evaluate(() => Math.round((window as unknown as { adeEchoMeasurement: { elapsed: number } }).adeEchoMeasurement.elapsed)));
  }
  // Only clears the unsubmitted fixture input. Never executes the typed buffer.
  if (!raw) await page.keyboard.press('Control+c');
  return times;
}

export async function terminalLatencyFlow(app: ElectronApplication, desktop: Page, page: Page, root: string, evidence: string,
  check: (name: string, ok: boolean) => void): Promise<void> {
  const parent = join(root, 'latency-projects'); const repo = join(parent, 'Latency'); mkdirSync(repo, { recursive: true });
  execFileSync('git', ['init', '--initial-branch=main', repo], { windowsHide: true });
  execFileSync('git', ['-C', repo, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost', '-c', 'commit.gpgSign=false', 'commit', '--allow-empty', '-m', 'Latency fixture'], { windowsHide: true });
  await desktop.evaluate(path => window.ade.invoke('projectDefaults:save', { rootPath: path, agentId: null }), parent);
  const device = (await desktop.evaluate(() => window.ade.invoke('remoteDevices:list'))).devices.find(item => item.name === 'Terminal tablet')!;
  await desktop.evaluate(({ id, scopes }) => window.ade.invoke('remoteDevices:setAdminScopes', { deviceId: id, scopes }),
    { id: device.id, scopes: [...new Set([...(device.adminScopes ?? []), 'projects:write' as const])] });
  await page.keyboard.press('Escape'); await page.getByRole('tab', { name: 'Projekte', exact: true }).click();
  await page.getByRole('button', { name: 'Workspace öffnen: Latency', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Projekt · Latency', exact: true });
  await dialog.getByRole('button', { name: 'Workspace öffnen', exact: true }).click();
  await dialog.getByLabel('Projekt-CLI', { exact: true }).selectOption('shell');
  await dialog.getByRole('button', { name: 'Leeres Terminal öffnen', exact: true }).click();
  await dialog.getByLabel('Direkte Terminal-Eingabe', { exact: true }).waitFor();
  await page.waitForFunction(() => !document.querySelector<HTMLTextAreaElement>('[aria-label="Direkte Terminal-Eingabe"]')?.disabled);
  await page.evaluate(() => performance.clearResourceTimings());
  const single = await samples(page, dialog, 1);
  writeFileSync(join(evidence, 'terminal-latency-singles.json'), JSON.stringify(single));
  const bursts = await samples(page, dialog, 4);
  const percentile = (values: number[], percent: number) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * percent) - 1];
  const timing = (values: number[]) => ({ count: values.length, p50: percentile(values, .5), p95: percentile(values, .95), max: Math.max(...values), samples: values });
  const requests = await page.evaluate(() => performance.getEntriesByType('resource').filter(entry => /\/api\/v1\/terminal\/(query|input)$/.test(entry.name))
    .map(entry => ({ operation: new URL(entry.name).pathname.split('/').at(-1), ms: Math.round(entry.duration) })));
  const counts = await app.evaluate(() => (globalThis as unknown as { adeGitMeasurements?: number[] }).adeGitMeasurements ?? []);
  const report = { measuredAt: new Date().toISOString(), transport: 'Chromium desktop keyboard events over local HTTPS proxy to native Windows project PTY; no physical tablet or WAN measurement',
    observation: 'keydown to matching authoritative screen text and two animation frames; no local terminal echo', single: timing(single), bursts: timing(bursts), requests,
    gitProcesses: { count: counts.length, ...(counts.length ? { p50: percentile(counts, .5), p95: percentile(counts, .95) } : {}) } };
  writeFileSync(join(evidence, 'terminal-latency.json'), JSON.stringify(report, null, 2));
  check('every direct key and burst reaches the real project terminal without Enter', single.length === 20 && bursts.length === 20);
  check('latency report includes positive rendered-echo samples', single.every(ms => ms > 0) && bursts.every(ms => ms > 0));
  console.log(`  latency single p50=${report.single.p50} p95=${report.single.p95} ms; bursts p50=${report.bursts.p50} p95=${report.bursts.p95} ms`);
  writeFileSync(join(repo, 'terminal-latency-fixture'), 'Local raw-key fixture only; no provider request.');
  await dialog.getByLabel('Projekt-CLI', { exact: true }).selectOption('codex');
  await dialog.getByRole('button', { name: 'Codex öffnen', exact: true }).click();
  await dialog.getByLabel('Terminalanzeige', { exact: true }).getByText('ADE_LATENCY_READY', { exact: false }).waitFor();
  await app.evaluate(() => { (globalThis as unknown as { adeGitMeasurements: number[] }).adeGitMeasurements = []; });
  await page.evaluate(() => performance.clearResourceTimings());
  const rawSingle = await samples(page, dialog, 1, { count: 100, offset: 0 });
  const rawBursts = await samples(page, dialog, 4, { count: 20, offset: 100 });
  const rawCounts = await app.evaluate(() => (globalThis as unknown as { adeGitMeasurements: number[] }).adeGitMeasurements);
  const rawReport = { ...report, transport: 'Chromium key events over local HTTPS to native Windows raw-key CLI fixture; no provider, physical tablet or WAN',
    single: timing(rawSingle), bursts: timing(rawBursts), requests: undefined, gitProcesses: { count: rawCounts.length } };
  writeFileSync(join(evidence, 'terminal-latency-raw-cli.json'), JSON.stringify(rawReport, null, 2));
  check('raw CLI receives 100 keys and 20 four-key bursts in order', rawSingle.length === 100 && rawBursts.length === 20);
  check('ordinary live-project terminal I/O does not spawn Git per key', rawCounts.length === 0);
  console.log(`  raw CLI single p50=${rawReport.single.p50} p95=${rawReport.single.p95} ms; bursts p50=${rawReport.bursts.p50} p95=${rawReport.bursts.p95} ms`);
  await page.keyboard.press('Control+c');
}
