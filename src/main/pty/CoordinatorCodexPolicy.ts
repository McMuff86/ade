import { t as translate } from "../../shared/i18n";
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { isAbsolute } from 'node:path';
import { assertNoLinks } from '../repositories/pathDiscipline';

/** ADE owns the conversation contract, not the installed CLI version. Every
 * newly opened native process must confirm the effective policy before a turn. */
export const COORDINATOR_CODEX_CONTRACT = 'ade-coordinator-policy-v3';
export const COORDINATOR_CODEX_MIN_VERSION = '0.154.0';
export const COORDINATOR_DISABLED_FEATURES = [
  'shell_tool', 'unified_exec', 'shell_snapshot', 'apps', 'hooks', 'plugins', 'remote_plugin', 'multi_agent',
  'image_generation', 'view_image', 'skill_search', 'skill_mcp_dependency_install', 'tool_suggest', 'memories', 'remote_control',
  'browser_use', 'browser_use_external', 'browser_use_full_cdp_access', 'in_app_browser', 'computer_use',
  'code_mode', 'code_mode_only', 'code_mode_prewarm',
] as const;
export const COORDINATOR_CODEX_OVERRIDES = [
  ...COORDINATOR_DISABLED_FEATURES.map(name => `features.${name}=false`),
  // 0.154 routes dynamic tools through this host even with Code Mode disabled.
  'features.code_mode_host=true',
  'agents.enabled=false', 'tools.view_image=false', 'web_search=disabled', 'mcp_servers={}', 'sandbox_mode=read-only', 'approval_policy=never',
] as const;
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const refused = () => new Error(translate("The installed Codex version did not confirm ADE's required conversation settings. No conversation turn was started."));
export function assertCoordinatorCodexVersion(initialized: unknown): string {
  // The first product is the caller's clientInfo.name (e.g. ade), with the CLI
  // version. Do not mistake a later OS/terminal version for the native version.
  const version = record(initialized) && typeof initialized.userAgent === 'string' && initialized.userAgent.length <= 1024
    ? /^[A-Za-z0-9_.-]{1,128}\/(\d{1,6}\.\d{1,6}\.\d{1,6})(?=\s|$)/.exec(initialized.userAgent)?.[1] : undefined;
  const parts = version?.split('.').map(Number);
  const minimum = COORDINATOR_CODEX_MIN_VERSION.split('.').map(Number);
  const difference = parts?.findIndex((part, index) => part !== minimum[index]);
  if (!version || !parts || difference === undefined || difference >= 0 && parts[difference]! < minimum[difference]!) {
    throw new Error(translate("Codex on the PC must report a stable CLI version {{minimum}} or newer. No conversation turn was started.", { minimum: COORDINATOR_CODEX_MIN_VERSION }));
  }
  return version;
}
/** Inspect effective config in this very process and cwd, before thread/start.
 * No sensitive config fields, origins or host paths leave this boundary. */
export function assertCoordinatorCodexConfig(response: unknown): void {
  if (!record(response) || !record(response.config)) throw refused();
  const config = response.config;
  if (!record(config.features) || config.features.code_mode_host !== true || COORDINATOR_DISABLED_FEATURES.some(name => (config.features as Record<string, unknown>)[name] !== false)
    || !record(config.mcp_servers) || Object.values(config.mcp_servers).some(server => !record(server) || server.enabled !== false) || !record(config.agents) || config.agents.enabled !== false
    || config.web_search !== 'disabled' || config.sandbox_mode !== 'read-only' || config.approval_policy !== 'never') throw refused();
}
export function assertCoordinatorCodexThread(response: unknown): void {
  if (!record(response) || !record(response.sandbox) || response.sandbox.type !== 'readOnly' || response.sandbox.networkAccess !== false
    || response.approvalPolicy !== 'never') throw refused();
}
/** A constant script inventories inherited MCP entries without connecting,
 * then disables each for this process. Empty TOML maps merge with global config
 * in 0.154.0; they do not remove inherited entries. The effective config check
 * above still refuses drift or any enabled/ambiguous entry before thread/start.
 * No global config writes. User text, tools and model travel over stdio. */
export function launchCoordinatorCodex(cwd: string, env: Record<string, string>): ChildProcessWithoutNullStreams {
  if (!isAbsolute(cwd)) throw new Error(translate("Conversation needs an absolute workspace."));
  assertNoLinks(cwd);
  const args = COORDINATOR_CODEX_OVERRIDES.flatMap(value => ['-c', value]);
  if (process.platform !== 'win32') return launchPosixCoordinatorCodex(cwd, env, args);
  const literals = args.map(value => `'${value.replace(/'/g, "''")}'`).join(',');
  const command = `# ADE_COORDINATOR_LAUNCH\n$ErrorActionPreference='Stop'
try {
  $adeStage='MCP-Inventar'
  $adeArguments=@(${literals})
  $ErrorActionPreference='Continue'
  $adeInventory=(& codex @adeArguments mcp list --json 2>$null) -join [Environment]::NewLine
  $ErrorActionPreference='Stop'
  if ($LASTEXITCODE -ne 0 -or $adeInventory.Length -gt 1048576) { throw 'inventory' }
  $adeStage='MCP-Identities'
  $adeServers=ConvertFrom-Json -InputObject $adeInventory
  if ($adeServers.Count -gt 128) { throw 'server limit' }
  foreach ($adeServer in $adeServers) {
    if ($adeServer.name -isnot [string] -or $adeServer.name -cnotmatch '^[A-Za-z0-9_-]{1,128}$') { throw 'server identity' }
    $adeArguments+=@('-c',('mcp_servers.'+$adeServer.name+'.enabled=false'))
  }
  $adeStage='App-Server'
  & codex @adeArguments app-server --listen stdio://
  exit $LASTEXITCODE
} catch { [Console]::Error.WriteLine('ADE konnte die isolierte Codex-Konfiguration nicht vorbereiten ('+$adeStage+').'); exit 1 }`;
  return spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command], { cwd, env, windowsHide: true, stdio: 'pipe' });
}

/**
 * The same two stages as the PowerShell script, as a constant Node program run
 * by Electron's own Node (no shell, no string interpolation): inventory the
 * inherited MCP servers without connecting, disable each by validated name for
 * this process only, then exec the app server with ADE's overrides. The
 * overrides travel as argv after `--`; stdio is handed straight to Codex, so
 * the protocol and the checks above are identical on every platform.
 */
export const POSIX_COORDINATOR_LAUNCHER = `// ADE_COORDINATOR_LAUNCH
'use strict';
const { execFileSync, spawn } = require('node:child_process');
const raw = process.argv.slice(1); const base = raw[0] === '--' ? raw.slice(1) : raw;
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
let stage = 'MCP-Inventar';
try {
  const inventory = execFileSync('codex', [...base, 'mcp', 'list', '--json'], {
    env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 1048576, timeout: 30000 });
  stage = 'MCP-Identities';
  const parsed = inventory.trim() ? JSON.parse(inventory) : [];
  const servers = Array.isArray(parsed) ? parsed : [parsed];
  if (servers.length > 128) throw new Error('server limit');
  const args = [...base];
  for (const server of servers) {
    if (!server || typeof server.name !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(server.name)) throw new Error('server identity');
    args.push('-c', 'mcp_servers.' + server.name + '.enabled=false');
  }
  stage = 'App-Server';
  const child = spawn('codex', [...args, 'app-server', '--listen', 'stdio://'], { env, stdio: 'inherit' });
  for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(signal, () => child.kill(signal));
  child.on('error', () => { process.stderr.write('ADE konnte die isolierte Codex-Konfiguration nicht vorbereiten (' + stage + ').\\n'); process.exit(1); });
  child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
} catch {
  process.stderr.write('ADE konnte die isolierte Codex-Konfiguration nicht vorbereiten (' + stage + ').\\n');
  process.exit(1);
}
`;

function launchPosixCoordinatorCodex(cwd: string, env: Record<string, string>, args: string[]): ChildProcessWithoutNullStreams {
  return spawn(process.execPath, ['-e', POSIX_COORDINATOR_LAUNCHER, '--', ...args], {
    cwd, env: { ...env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'pipe',
  });
}
