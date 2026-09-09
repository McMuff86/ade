import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import type { Page } from 'playwright';
import { terminalEchoLatency } from './terminalLatency';
import { terminalLauncher } from './terminalControls';
import { terminalKeyboardFlow } from './terminalKeyboardFlow';

export async function assistantAccessFlow(desktop: Page, tablet: Page, root: string, categoryId: string, evidence: string,
  check: (label: string, ok: boolean) => void): Promise<void> {
  const compile = join(root, 'compile-tui.ps1'); const binary = join(root, 'assistant-tui.exe');
  writeFileSync(compile, `param([string]$Target)
Add-Type -OutputAssembly $Target -OutputType ConsoleApplication -TypeDefinition @'
using System; using System.IO;
public class Tui { public static void Main(string[] args) {
  Console.Write("\\u001b[?1049h\\u001b[2J\\u001b[H\\u001b[31mADE_TUI_READY\\u001b[0m");
  for (;;) { var key = Console.ReadKey(true); if (key.KeyChar == 'q') break;
    File.AppendAllText("direct-input.txt", key.KeyChar.ToString());
    Console.Write("\\u001b[3;1HKEY_" + key.KeyChar + "_ACK");
  }
  Console.Write("\\u001b[?1049l");
} }
'@
`);
  execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', compile, binary], { windowsHide: true, timeout: 30_000 });
  const profiles = [{ name: 'Hermes General Fixture', executable: 'general.exe', args: '--tui', url: 'https://assistant.fixture.ts.net:9443/login' },
    { name: 'Sentinel Fixture', executable: 'openclaw.exe', args: 'tui', url: 'https://assistant.fixture.ts.net:8443/' }];
  await tablet.context().route('https://assistant.fixture.ts.net:*/**', (route) => route.fulfill({ contentType: 'text/html', body: '<h1>Assistant dashboard</h1>' }));
  const address = new URL(tablet.url());
  const shellRequest = () => tablet.request.get(`https://127.0.0.1:${address.port}/`, { headers: { host: address.host } });
  const firstShell = await shellRequest(); const secondShell = await shellRequest();
  const firstNonce = (await firstShell.text()).match(/name="ade-style-nonce" content="([^"]+)"/)?.[1];
  const secondNonce = (await secondShell.text()).match(/name="ade-style-nonce" content="([^"]+)"/)?.[1];
  check('terminal styles use fresh matching CSP nonces without unsafe-inline', !!firstNonce && !!secondNonce && firstNonce !== secondNonce
    && firstShell.headers()['content-security-policy']!.includes(`'nonce-${firstNonce}'`) && !firstShell.headers()['content-security-policy']!.includes('unsafe-inline'));
  const inlineBlocked = await tablet.evaluate(() => {
    const script = document.createElement('script'); script.textContent = 'window.__ADE_INLINE_CANARY = true';
    script.nonce = document.querySelector<HTMLMetaElement>('meta[name="ade-style-nonce"]')!.content;
    document.head.append(script); script.remove();
    return !(window as unknown as Record<string, unknown>).__ADE_INLINE_CANARY;
  });
  check('style nonce does not authorize inline scripts', inlineBlocked);
  for (const profile of profiles) {
    const executable = join(root, profile.executable); copyFileSync(binary, executable);
    const home = join(root, profile.executable + '-home');
    const agent = await desktop.evaluate(async ({ categoryId, profile, executable, home }) => {
      const a = await window.ade.invoke('agent:create', { categoryId, name: profile.name, runtime: 'custom', permissionMode: 'default',
        customCommand: `& '${executable.replace(/'/g, "''")}' ${profile.args}` });
      return window.ade.invoke('agent:update', { id: a.id, name: a.name, runtime: a.runtime, permissionMode: a.permissionMode,
        customCommand: a.customCommand, dashboardUrl: profile.url, homeWorkspaceDir: home });
    }, { categoryId, profile, executable, home });
    await tablet.keyboard.press('Escape'); await tablet.getByRole('tab', { name: 'Overview', exact: true }).click();
    if (profile.name === 'Hermes General Fixture') {
      await tablet.getByRole('button', { name: `Workspace für ${profile.name}`, exact: true }).click();
      const normal = tablet.getByRole('dialog', { name: `Workspace · ${profile.name}`, exact: true });
      await normal.getByRole('button', { name: 'Terminal', exact: true }).click();
      await terminalLauncher(normal);
      check('agent workspace defaults to the saved profile rather than a blank shell', await normal.getByLabel('Sitzung starten mit', { exact: true }).inputValue() === 'agent');
      await normal.getByRole('button', { name: 'Shell öffnen', exact: true }).click();
      await normal.getByLabel('Terminalanzeige', { exact: true }).waitFor();
      check('ordinary workspace keeps a usable terminal and folds the empty composer', await normal.getByLabel('Terminalanzeige', { exact: true }).evaluate((node) => node.getBoundingClientRect().height >= 220)
        && !await normal.getByLabel('Terminal-Eingabe', { exact: true }).isVisible());
      await normal.getByRole('button', { name: `${profile.name} öffnen`, exact: true }).focus(); await tablet.keyboard.press('Enter');
      await normal.getByLabel('Terminalanzeige', { exact: true }).getByText('ADE_TUI_READY', { exact: false }).last().waitFor();
      check('visible agent action starts the TUI from a shell and enlarges it', await normal.getByRole('button', { name: 'Workspace einblenden', exact: true }).isVisible());
      await normal.getByRole('button', { name: `Workspace · ${profile.name} schliessen`, exact: true }).click();
    }
    await tablet.getByRole('button', { name: `Terminal öffnen: ${profile.name}`, exact: true }).click();
    const workspace = tablet.getByRole('dialog', { name: `Workspace · ${profile.name}`, exact: true });
    await workspace.getByLabel('Terminalanzeige', { exact: true }).getByText('ADE_TUI_READY', { exact: false }).last().waitFor();
    check(`${profile.name}: direct entry opens saved TUI without project`, await workspace.getByLabel('Workspace-Projekt', { exact: true }).inputValue() === '');
    check(`${profile.name}: focused tablet terminal uses most of the screen`, await workspace.getByLabel('Terminalanzeige', { exact: true }).evaluate((node) => node.getBoundingClientRect().height > 300));
    const echoMs = await terminalEchoLatency(tablet, workspace, 'xyz', 'KEY_z_ACK');
    check(`${profile.name}: keydown to visible PTY acknowledgement stays below 500 ms (${echoMs} ms)`, echoMs < 500);
    await workspace.getByLabel('Terminalanzeige', { exact: true }).getByText('KEY_z_ACK', { exact: false }).last().waitFor();
    check(`${profile.name}: rapid direct keys reach the real PTY once, in order`, existsSync(join(home, 'direct-input.txt')) && readFileSync(join(home, 'direct-input.txt'), 'utf8') === 'xyz');
    check(`${profile.name}: direct typing keeps the composer folded`, !await workspace.getByLabel('Terminal-Eingabe', { exact: true }).isVisible());
    const color = await workspace.getByLabel('Terminalanzeige', { exact: true }).locator('span').filter({ hasText: 'ADE_TUI_READY' }).last().evaluate((node) => getComputedStyle(node).color);
    const rgb = color.match(/\d+/g)?.map(Number) ?? [];
    check(`${profile.name}: ANSI red is visible in browser (${color})`, rgb[0]! > rgb[1]! + 40 && rgb[0]! > rgb[2]! + 40);
    const before = (await desktop.evaluate(() => window.ade.invoke('pty:list'))).sessions.filter((s) => s.agentId === agent.id);
    await desktop.keyboard.press('Escape'); await desktop.getByRole('tab', { name: 'Overview view', exact: true }).click();
    await desktop.getByRole('button', { name: `Terminal öffnen: ${profile.name}`, exact: true }).click();
    check(`${profile.name}: desktop direct entry reuses the same profile session`, (await desktop.evaluate(() => window.ade.invoke('pty:list'))).sessions.filter((s) => s.agentId === agent.id).length === before.length);
    await workspace.getByRole('button', { name: `Workspace · ${profile.name} schliessen`, exact: true }).click();
    await tablet.getByRole('button', { name: `Terminal öffnen: ${profile.name}`, exact: true }).click();
    await workspace.getByLabel('Terminalanzeige', { exact: true }).getByText('KEY_z_ACK', { exact: false }).last().waitFor();
    check(`${profile.name}: reopening resumes the same process`, (await desktop.evaluate(() => window.ade.invoke('pty:list'))).sessions.filter((s) => s.agentId === agent.id).length === before.length);
    if (profile.name === 'Hermes General Fixture') await terminalKeyboardFlow(tablet, workspace, evidence, check);
    const popupPromise = tablet.context().waitForEvent('page');
    await workspace.getByRole('link', { name: `Web-Dashboard für ${profile.name}`, exact: true }).click();
    const popup = await popupPromise; await popup.waitForLoadState();
    check(`${profile.name}: separate dashboard preserves private URL and has no opener`, popup.url() === profile.url && await popup.evaluate(() => window.opener === null));
    await popup.close();
    await tablet.screenshot({ path: join(evidence, `${profile.executable}-tablet.png`) });
    await workspace.getByRole('button', { name: 'Sitzung beenden', exact: true }).click();
    await tablet.getByRole('dialog', { name: 'Terminalsitzung beenden' }).getByRole('button', { name: 'Beenden bestätigen' }).click();
    await workspace.getByText('Sitzung beendet.', { exact: true }).waitFor();
  }
}
