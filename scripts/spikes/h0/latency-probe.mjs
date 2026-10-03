// Goal 34.6 spike H0 (throwaway, not product code, not part of pnpm verify).
// Linux desktop baseline for R3: today's in-process path, before a host hop.
//
//   node latency-probe.mjs <build dir> <scratch dir> [samples]
//
// Launches an isolated ADE (disposable ADE_USER_DATA_DIR, host API off) from
// the given build, creates one session running `cat` and measures:
//   (a) renderer IPC round trip: pty:write -> matching pty:data event;
//   (b) keystroke -> echo in the visible xterm: keydown timestamp in the page
//       to the first animation frame after the echoed text is in .xterm-rows.
// Prints one JSON line. Never touches the personal profile or out/.
import { _electron as electron } from 'playwright';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const [buildDir, scratch, samplesArg] = process.argv.slice(2);
const samples = Number(samplesArg ?? 200);
const root = mkdtempSync(join(scratch, 'latency-'));
const pct = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return +s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)].toFixed(2); };
const stats = (xs) => ({ n: xs.length, p50: pct(xs, 0.5), p95: pct(xs, 0.95), max: pct(xs, 1) });
const out = { build: resolve(buildDir) };
let app;
try {
  app = await electron.launch({ args: [join(resolve(buildDir), 'main', 'index.js')], timeout: 60_000,
    env: { ...process.env, ADE_USER_DATA_DIR: join(root, 'profile'), ADE_HOST_API_ENABLED: '0', NODE_ENV: 'test' } });
  const page = await app.firstWindow(); page.setDefaultTimeout(30_000);
  await app.evaluate(({ BrowserWindow }) => { for (const w of BrowserWindow.getAllWindows()) w.webContents.setBackgroundThrottling(false); });
  out.ownerPid = await app.evaluate(() => process.pid);

  const agent = await page.evaluate(async () => {
    const category = await window.ade.invoke('category:create', { name: 'H0 Latency' });
    return window.ade.invoke('agent:create', { categoryId: category.id, name: 'H0 Cat', runtime: 'custom', permissionMode: 'default', customCommand: 'cat' });
  });

  // (a) IPC round trip on a session of its own.
  out.ipcRoundTripMs = stats(await page.evaluate(async ({ agentId, samples }) => {
    const meta = await window.ade.invoke('pty:create', { agentId });
    const sessionId = meta.id ?? meta.sessionId;
    let text = ''; let waiter = null;
    const off = window.ade.on('pty:data', (event) => {
      if (event.sessionId !== sessionId) return;
      text += atob(event.dataBase64);
      if (waiter && text.includes(waiter.token)) { const w = waiter; waiter = null; w.done(); }
    });
    const send = (data) => window.ade.invoke('pty:write', { sessionId, dataBase64: btoa(data) });
    await new Promise((r) => setTimeout(r, 1500));
    const times = [];
    for (let i = 0; i < samples; i += 1) {
      const token = `q${i.toString(36)}w`;
      const t0 = performance.now();
      await new Promise((done, fail) => { const t = setTimeout(() => fail(new Error('ipc echo timeout')), 3000); waiter = { token, done: () => { clearTimeout(t); done(); } }; send(token); });
      times.push(performance.now() - t0);
      if (i % 20 === 19) { await send('\r'); text = ''; }
    }
    off(); await window.ade.invoke('pty:kill', { sessionId });
    return times;
  }, { agentId: agent.id, samples }));

  // (b) Keystroke -> visible echo through the real UI session.
  await page.locator('.agent-row', { hasText: 'H0 Cat' }).click();
  await page.keyboard.press('Control+Shift+T');
  const launch = page.getByRole('dialog', { name: 'Neue Terminalsitzung', exact: true });
  await launch.waitFor();
  await launch.getByRole('button', { name: 'Sitzung starten', exact: true }).click();
  const input = page.locator('.terminal-pane-wrap:visible .xterm-helper-textarea');
  await input.waitFor({ state: 'visible', timeout: 60_000 });
  await input.click();
  await page.waitForTimeout(1500);
  await page.evaluate(() => {
    const rows = document.querySelector('.terminal-pane-wrap:not([hidden]) .xterm-rows') ?? document.querySelector('.xterm-rows');
    const state = { t0: 0, expect: null, resolve: null };
    document.addEventListener('keydown', () => { state.t0 = performance.now(); }, true);
    const check = () => {
      if (!state.expect) return;
      const lines = [...rows.children].map((r) => r.textContent.replace(/\s+$/, ''));
      if (lines.some((l) => l.endsWith(state.expect))) {
        const { t0, resolve } = state; state.expect = null;
        requestAnimationFrame(() => resolve(performance.now() - t0));
      }
    };
    new MutationObserver(check).observe(rows, { subtree: true, childList: true, characterData: true });
    window.__h0 = { arm: (expect) => new Promise((resolve) => { state.expect = expect; state.resolve = resolve; }) };
  });
  const keyTimes = [];
  const alphabet = 'abcdefghijklmnopqrst';
  for (let line = 0; keyTimes.length < samples; line += 1) {
    const marker = `L${line}:`;
    await page.keyboard.insertText(marker); // unmeasured unique line prefix
    await page.waitForTimeout(50);
    let typed = '';
    for (const ch of alphabet) {
      if (keyTimes.length >= samples) break;
      typed += ch;
      const armed = page.evaluate((e) => window.__h0.arm(e), marker + typed);
      await page.keyboard.press(ch);
      keyTimes.push(await armed);
    }
    await page.keyboard.press('Enter');
    await page.waitForTimeout(30);
  }
  out.keystrokeEchoMs = stats(keyTimes);
  out.state = 'ok';
} catch (error) {
  out.state = 'failed'; out.error = String(error?.message ?? error).slice(0, 400);
} finally {
  if (app) await app.close().catch(() => {});
  writeFileSync(join(scratch, 'latency-last.json'), JSON.stringify(out, null, 2));
  rmSync(root, { recursive: true, force: true });
}
console.log(JSON.stringify(out));
