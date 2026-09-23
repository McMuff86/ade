import type { RuntimeDiagnostic, RuntimeDiagnosticsResult } from '../../shared/types';
import { redactForWire } from '../errors';

/**
 * Diagnostics for the host API wire: the same items the desktop modal shows,
 * with every free-text field passed through the wire funnel (credentials and
 * absolute host paths removed, bounded). Structured fields (status, runtime,
 * transport, installed) are safe as they are; custom command text is already
 * withheld by the diagnostics service.
 */
export function diagnosticsForWire(result: RuntimeDiagnosticsResult): RuntimeDiagnosticsResult {
  const short = (value: string) => redactForWire(value, 120);
  return {
    checkedAt: result.checkedAt,
    platform: result.platform,
    items: result.items.map((item): RuntimeDiagnostic => ({
      agentId: item.agentId, agentName: short(item.agentName), runtime: item.runtime, label: short(item.label),
      ...(item.executionBackend === undefined ? {} : { executionBackend: short(item.executionBackend) as RuntimeDiagnostic['executionBackend'] }),
      command: short(item.command), installed: item.installed,
      ...(item.version === undefined ? {} : { version: short(item.version) }),
      authStatus: item.authStatus, authDetail: redactForWire(item.authDetail), taskTransport: item.taskTransport, status: item.status, message: redactForWire(item.message),
    })),
  };
}
