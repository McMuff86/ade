import { t as translate } from "../../shared/i18n";
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { isAbsolute } from 'node:path';
import { assertNoLinks } from '../repositories/pathDiscipline';

/** Experimental tool protocol and feature inventory are pinned independently
 * from the operator's model choice. A CLI upgrade needs new native evidence. */
export const COORDINATOR_CODEX_CONTRACT = 'codex-0.154.0-ade-v2';
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
const refused = () => new Error(translate("This Codex connection does not confirm the pinned ADE coordinator policy. No conversation turn was started."));
export function assertCoordinatorCodexVersion(initialized: unknown): void {
  if (!record(initialized) || typeof initialized.userAgent !== 'string' || initialized.userAgent.match(/\d+\.\d+\.\d+/)?.[0] !== '0.154.0') throw refused();
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
  if (process.platform !== 'win32' || !isAbsolute(cwd)) throw new Error(translate("The ADE coordinator currently requires native Windows."));
  assertNoLinks(cwd);
  const args = COORDINATOR_CODEX_OVERRIDES.flatMap(value => ['-c', value]);
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
