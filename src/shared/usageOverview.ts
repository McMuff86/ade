import type { SubscriptionUsage } from './remote';
import type { TokenCounts } from './usage';

/**
 * The usage overview shown on the Overview home (desktop and tablet): per
 * provider the account limits ADE can observe locally plus what native ADE
 * sessions of that provider consumed since local midnight. Account figures
 * are percentages and reset times only; identities, tokens and credentials
 * never enter this contract. It travels over the host API unchanged.
 */
export type UsageOverviewProvider = 'codex' | 'claude';
export interface ProviderDayUsage {
  /** `unsupported` when no native session of the provider was measured today. */
  status: 'recording' | 'waiting' | 'unsupported' | 'incomplete';
  sessions: number; events: number; tokens: TokenCounts;
  /** Local midnight the sums start at (epoch ms). */
  since: number;
}
export interface ProviderUsageOverview { provider: UsageOverviewProvider; account: SubscriptionUsage; today: ProviderDayUsage }
export interface UsageOverview {
  checkedAt: number;
  providers: ProviderUsageOverview[];
  /** Whether the PC is allowed to read Claude account limits through the Claude CLI sign-in (Settings → Usage). */
  claudeAccountEnabled: boolean;
}
export const USAGE_PROVIDER_LABELS: Record<UsageOverviewProvider, string> = { codex: 'Codex', claude: 'Claude Code' };
/** The window closest to its limit across every available account, for a one-number tile. */
export function tightestUsageWindow(overview: UsageOverview): { provider: UsageOverviewProvider; window: SubscriptionUsage['windows'][number] } | null {
  let best: { provider: UsageOverviewProvider; window: SubscriptionUsage['windows'][number] } | null = null;
  for (const item of overview.providers) for (const window of item.account.windows) if (!best || window.usedPercent > best.window.usedPercent) best = { provider: item.provider, window };
  return best;
}
