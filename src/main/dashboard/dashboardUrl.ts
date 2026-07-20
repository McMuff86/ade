/**
 * Pure dashboard-URL helpers (no Electron imports so contract tests can run
 * them directly). A dashboard is either a fixed URL or the output of a command
 * executed in the agent's home backend (e.g. `openclaw dashboard --no-open`,
 * which prints a freshly tokenized Control-UI link).
 */

import type { ExecutionBackendService } from '../execution/ExecutionBackendService';
import { NATIVE_EXECUTION_BACKEND, executionBackendPlatform } from '../../shared/executionBackends';
import type { Agent } from '../../shared/types';
import { agentHomeBackend, homeWorkspace } from '../repositories/RepositoryScopeService';

const URL_PATTERN = /https?:\/\/[^\s"'<>)\]]+/i;
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const COMMAND_TIMEOUT_MS = 30_000;

/** First http(s) URL in a command's output, or null. */
export function extractDashboardUrl(output: string): string | null {
  return URL_PATTERN.exec(output)?.[0] ?? null;
}

/**
 * Dashboards leave ADE only as ordinary web pages: https anywhere, http only
 * to the local machine, never with embedded credentials.
 */
export function assertAllowedDashboardUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`ade: dashboard URL is not a valid URL: ${value.slice(0, 200)}`);
  }
  if (url.username || url.password) {
    throw new Error('ade: dashboard URLs must not embed credentials');
  }
  if (url.protocol === 'https:') return url;
  if (url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname)) return url;
  throw new Error(`ade: dashboard URLs must use https (or http on localhost): ${url.origin}`);
}

/**
 * Resolve the agent's dashboard: the command wins over the fixed URL because
 * commands mint fresh tokens. The command runs in the agent's home backend —
 * interactive bash for POSIX (rc-file PATHs like ~/.npm-global/bin apply) and
 * the plain PowerShell host on Windows.
 */
export async function resolveDashboardUrl(
  agent: Agent,
  execution: ExecutionBackendService,
): Promise<URL> {
  const command = agent.dashboardCommand?.trim();
  if (command) {
    const backend = agentHomeBackend(agent);
    const posix = executionBackendPlatform(backend) === 'posix';
    const output = await execution.text(
      backend,
      posix ? '/bin/bash' : 'powershell.exe',
      posix ? ['-lic', command] : ['-NoLogo', '-NoProfile', '-Command', command],
      {
        cwd: backend === NATIVE_EXECUTION_BACKEND ? undefined : homeWorkspace(agent),
        timeoutMs: COMMAND_TIMEOUT_MS,
        maxBuffer: 256 * 1024,
      },
    );
    const found = extractDashboardUrl(output);
    if (!found) {
      throw new Error('ade: the dashboard command finished but printed no http(s) URL');
    }
    return assertAllowedDashboardUrl(found);
  }
  const fixed = agent.dashboardUrl?.trim();
  if (!fixed) throw new Error('ade: this agent has no dashboard URL or command configured');
  return assertAllowedDashboardUrl(fixed);
}
