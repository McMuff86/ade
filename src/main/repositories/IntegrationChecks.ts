import { execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { redactForWire, redactedWireMessage } from '../errors';
import { readIntegrationFile } from './IntegrationGit';

export interface IntegrationRecipe { label: string; executable: string; args: string[] }
/** Recipes are selected in main; a device never supplies executable or argv. */
export function integrationRecipes(cwd: string): { recipes: IntegrationRecipe[]; notice: string } {
  const manifest = readIntegrationFile(join(cwd, 'package.json'));
  if (manifest) {
    const pkg = JSON.parse(manifest.toString('utf8')) as { scripts?: Record<string, unknown> };
    const script = typeof pkg.scripts?.verify === 'string' ? 'verify' : typeof pkg.scripts?.test === 'string' ? 'test' : null;
    if (script) return { recipes: [{ label: `pnpm run ${script}`, executable: process.platform === 'win32' ? 'cmd.exe' : 'pnpm',
      args: process.platform === 'win32' ? ['/d', '/s', '/c', `pnpm run ${script}`] : ['run', script] }], notice: 'Führt das Prüfskript dieser Arbeitskopie auf dem ADE-Rechner aus. Projektcode kann dabei Prozesse starten.' };
  }
  if (existsSync(join(cwd, 'rhinoclaw-kit.json')) && existsSync(join(cwd, 'scripts', 'fastener', 'catalog.py'))) {
    const recipes: IntegrationRecipe[] = [
      { label: 'Python kompilieren', executable: 'python', args: ['-m', 'compileall', '-q', 'scripts', 'tools'] },
      { label: 'Ruff', executable: 'python', args: ['-m', 'ruff', 'check', 'scripts', 'tools'] },
      { label: 'Katalog prüfen', executable: 'python', args: ['scripts/fastener/catalog.py'] },
    ];
    for (const path of ['scripts/fastener/profiles.py', 'scripts/fastener/identity.py', 'scripts/fastener/silhouette.py', 'tools/check_fastener_palette.py',
      'tools/check_drilling.py', 'tools/test_drilling.py', 'tools/check_kit.py', 'tools/test_toolbar.py', 'tools/test_constraints.py', 'tools/test_explosion.py', 'tools/test_gearing.py']) {
      if (existsSync(join(cwd, path))) recipes.push({ label: path, executable: 'python', args: [path] });
    }
    if (existsSync(join(cwd, 'tools', 'build_toolbar.py'))) recipes.push({ label: 'Toolbar-Assets prüfen', executable: 'python', args: ['tools/build_toolbar.py', '--check'] });
    for (const pattern of ['test_sketch_*.py', 'test_assembly_*.py']) recipes.push({ label: pattern, executable: 'python', args: ['-m', 'unittest', 'discover', '-s', 'tools', '-p', pattern] });
    return { recipes, notice: 'Automatisierte Projektprüfungen. Rhino-Dialoge und Platzierung zusätzlich in Rhino prüfen; diese Tests bestätigen keine Live-Abnahme.' };
  }
  return { recipes: [], notice: 'Kein unterstütztes Projekt-Prüfskript gefunden. Ein pnpm-Skript „verify“ oder „test“ ergänzen, dann erneut prüfen.' };
}

/** Bounded output/time; terminate the owned process group on timeout or shutdown. */
export function runIntegrationCheck(cwd: string, recipe: IntegrationRecipe, signal: AbortSignal): Promise<{ output: string; exitCode: number }> {
  return new Promise((resolve) => {
    if (signal.aborted) { resolve({ output: 'Prüfung unterbrochen.', exitCode: -1 }); return; }
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(?:GIT_|NODE_OPTIONS$|ELECTRON_RUN_AS_NODE$)/i.test(key)));
    const child = spawn(recipe.executable, recipe.args, { cwd, env: { ...env, CI: '1', GIT_TERMINAL_PROMPT: '0' }, windowsHide: true,
      detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
    let output = ''; let bytes = 0; let interrupted = false;
    const stop = () => {
      interrupted = true;
      if (!child.pid) return;
      if (process.platform === 'win32') execFile('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, () => undefined);
      else { try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); } }
    };
    const append = (buffer: Buffer) => { bytes += buffer.length; output = (output + buffer.toString('utf8')).slice(-32_768); if (bytes > 16 * 1024 * 1024) stop(); };
    child.stdout.on('data', append); child.stderr.on('data', append);
    const timer = setTimeout(stop, 20 * 60_000); signal.addEventListener('abort', stop, { once: true });
    child.on('error', (error) => { output += '\n' + redactedWireMessage(error); });
    child.on('close', (code) => {
      clearTimeout(timer); signal.removeEventListener('abort', stop);
      resolve({ exitCode: interrupted ? -1 : code ?? -1, output: redactForWire(output + (interrupted ? '\nPrüfung abgebrochen (Zeit-/Ausgabelimit oder Neustart).' : ''), 8192) });
    });
  });
}
