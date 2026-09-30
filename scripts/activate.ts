/** Keep the established Windows driver; Linux uses its own measured lifecycle. */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { activateLinux } from './helpers/linuxActivation';
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2).filter(arg => arg !== '--');
const run = (file: string, argv: string[], env = process.env) => new Promise<void>((done, fail) => {
  const child = spawn(file, argv, { cwd: repo, env, stdio: 'inherit' });
  child.once('error', fail); child.once('exit', code => code === 0 ? done() : fail(new Error(`Activation check failed (exit ${code}); existing ADE remains unchanged.`)));
});
void (async () => {
  if (process.platform === 'win32') return run('pwsh', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(repo, 'scripts/activate.ps1'), ...args]);
  if (process.platform !== 'linux') throw new Error('Activation is measured on native Linux and Windows only.');
  let label = 'Update'; let rollback = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '-Label' || args[i] === '--label') label = args[++i] ?? '';
    else if (args[i] === '-Rollback' || args[i] === '--rollback') rollback = true;
    else throw new Error(`Unsupported Linux activation option: ${args[i]}. The gate and live-session protection cannot be skipped.`);
  }
  const require = createRequire(import.meta.url);
  await activateLinux({ repo, profile: process.env.ADE_USER_DATA_DIR ?? join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'ade'),
    backupRoot: process.env.ADE_BACKUP_DIR ?? join(homedir(), 'ADE-Backups'), staged: join(repo, 'test-results/verify-build'),
    electron: require('electron') as string, label, rollback, env: process.env,
    gate: () => run(process.execPath, ['--import', 'tsx', join(repo, 'scripts/verify.ts'), '--gate'], { ...process.env, ADE_REMOTE_DEBUG_PORT: undefined }) });
})().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
