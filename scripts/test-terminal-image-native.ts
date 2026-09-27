/** Opt-in UI probe against installed Codex (default) or Claude Code (--claude).
 * Inserts an image and text but never presses Enter, starts a model turn, changes
 * CLI configuration or attaches to the operator's session. Run separately from
 * the deterministic verify suite. */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { PNG } from 'pngjs';
import { Terminal } from '@xterm/headless';
import { TerminalImageStore } from '../src/main/application/TerminalImageStore';
import { ExecutionBackendService } from '../src/main/execution/ExecutionBackendService';
import { ProtectedPromptWriter } from '../src/main/pty/ProtectedPromptWriter';

const require = createRequire(import.meta.url);
const wsl = process.argv.includes('--wsl');
const claude = process.argv.includes('--claude');
const cliName = claude ? 'Claude Code' : 'Codex';
if (!process.versions.electron) {
  const child = spawn(require('electron') as string, ['--import', 'tsx', fileURLToPath(import.meta.url), ...(wsl ? ['--wsl'] : []), ...(claude ? ['--claude'] : [])], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, windowsHide: true, stdio: 'inherit',
  });
  child.on('error', error => { console.error(error.message); process.exitCode = 1; });
  child.on('exit', code => { process.exitCode = code ?? 1; });
} else void (async () => {
  if (process.platform !== 'win32') throw new Error('This probe currently measures Windows and Windows-to-WSL only.');
  if (claude && wsl) throw new Error('The Claude Code probe measures native Windows only.');
  const evidence = resolve('test-results/terminal-media'); mkdirSync(evidence, { recursive: true });
  const backend = wsl ? 'wsl:Ubuntu' : 'native';
  const images = new TerminalImageStore(join(evidence, 'native-staging'), new ExecutionBackendService(), value => PNG.sync.write(PNG.sync.read(value)));
  const png = new PNG({ width: 64, height: 64 });
  for (let index = 0; index < png.data.length; index += 4) { png.data[index] = 255; png.data[index + 3] = 255; }
  const image = await images.put('probe', 'isolated-codex', backend, PNG.sync.write(png), () => {});
  const path = await images.path('probe', 'isolated-codex', backend, image.id);
  const pty = require('node-pty') as typeof import('node-pty');
  const workspace = wsl ? await new ExecutionBackendService().toBackendPath(backend, process.cwd()) : process.cwd();
  const term = pty.spawn(wsl ? 'wsl.exe' : 'powershell.exe', wsl
    ? ['--distribution', 'Ubuntu', '--cd', workspace, '--exec', 'bash', '-lc', 'exec codex --no-alt-screen -c check_for_update_on_startup=false -c "$1"', 'ade-image-probe', `projects.${JSON.stringify(workspace)}.trust_level="trusted"`]
    : ['-NoLogo', '-NoProfile', '-Command', claude ? 'claude' : 'codex --no-alt-screen -c check_for_update_on_startup=false'], {
    cols: 120, rows: 32, cwd: process.cwd(), env: process.env, name: 'xterm-256color',
  });
  let output = ''; let exited = false; const display = new Terminal({ cols: 120, rows: 32, allowProposedApi: true });
  const visible = () => Array.from({ length: display.buffer.active.length }, (_, row) => display.buffer.active.getLine(row)?.translateToString(true) ?? '').join('\n');
  term.onData(data => { display.write(data); output = (output + data).slice(-100000); if (data.includes('\x1b[6n')) term.write('\x1b[1;1R'); });
  term.onExit(() => { exited = true; });
  const pause = (ms: number) => new Promise(done => setTimeout(done, ms));
  const wait = async (predicate: () => boolean, label: string, ms = 45000) => {
    const until = Date.now() + ms;
    while (!predicate() && Date.now() < until && !exited) await pause(100);
    if (!predicate()) throw new Error(`${label}: native ${cliName} did not reach the expected UI state`);
  };
  try {
    // Both CLIs enable bracketed paste once their prompt is ready; Claude Code draws it as "❯"/">".
    await wait(() => (claude ? visible().includes('Claude Code') && /[❯>]/.test(visible()) : output.includes('OpenAI Codex') && output.includes('›'))
      && output.includes('\x1b[?2004h'), 'Ready');
    await pause(2500);
    const writer = new ProtectedPromptWriter({ check: () => { if (exited) throw new Error(`${cliName} exited`); }, write: (_id, bytes) => term.write(bytes) });
    await writer.write('probe', [`\x1b[200~${path}\x1b[201~`, '\x1b[200~ADE_IMAGE_TEST_DO_NOT_SUBMIT\x1b[201~'], () => {});
    await wait(() => visible().includes('[Image #1]') && visible().includes('ADE_IMAGE_TEST_DO_NOT_SUBMIT'), 'Image attachment', 15000);
    const cli = claude ? visible().match(/Claude Code v?\d+\.\d+\.\d+/)?.[0] ?? 'observed Claude Code' : output.match(/v0\.\d+\.\d+/)?.[0] ?? 'observed Codex';
    const proof = { passed: true, backend, cli, attachment: '[Image #1]', messageInserted: true, submitted: false, at: new Date().toISOString() };
    writeFileSync(join(evidence, `${wsl ? 'wsl' : 'windows'}-${claude ? 'claude' : 'codex'}.json`), JSON.stringify(proof, null, 2));
    console.log(`Native image attachment: 3 passed, 0 failed (${cliName}, ${backend}; real CLI, no model turn)`);
  } catch (error) {
    writeFileSync(join(evidence, `${wsl ? 'wsl' : 'windows'}-${claude ? 'claude-' : ''}failure.txt`), visible()); throw error;
  } finally {
    if (!exited) { term.write('\x03'); await pause(350); term.write('\x03'); await pause(350); }
    if (!exited) { term.write('\x04'); await pause(750); }
    if (!exited) term.kill();
    display.dispose();
    // Some ConPTY/WSL versions keep the closed pseudoconsole handle alive.
    // This isolated probe owns that process and must not keep the driver open.
    setTimeout(() => process.exit(process.exitCode ?? 0), 1000);
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
