import type { Agent } from '../../shared/types';
import type { MobileAgentSummary } from '../../shared/remote';
import { redactForWire } from '../errors';

/** A fixed private URL only. Dashboard commands may mint credentials and stay desktop-only. */
export function mobileDashboard(agent: Pick<Agent, 'dashboardUrl' | 'dashboardCommand'>): MobileAgentSummary['dashboard'] {
  if (!agent.dashboardUrl && !agent.dashboardCommand) return undefined;
  const unavailable = { notice: 'Am PC im Agent-Profil eine private HTTPS-Dashboard-Adresse ohne Zugangsdaten hinterlegen.' };
  try {
    const url = new URL(agent.dashboardUrl ?? '');
    if (url.protocol !== 'https:' || !url.hostname.endsWith('.ts.net') || url.username || url.password || url.hash
      || [...url.searchParams].some(([key, value]) => key !== 'profile' || !/^[\w-]{1,80}$/.test(value))) return unavailable;
    const decoded = decodeURIComponent(url.href);
    if (/[\x00-\x20\x7f-\x9f]/.test(decoded) || redactForWire(decoded, 2048) !== decoded) return unavailable;
    return { url: url.href };
  } catch { return unavailable; }
}
