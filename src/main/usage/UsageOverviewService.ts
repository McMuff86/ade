import { t as translate } from "../../shared/i18n";
import type { SubscriptionUsage } from '../../shared/remote';
import { unknownTokens } from '../../shared/usage';
import type { ProviderDayUsage, ProviderUsageOverview, UsageOverview, UsageOverviewProvider } from '../../shared/usageOverview';
import { cachedCodexAccountUsage } from '../settings/CodexAccountUsage';
import { cachedClaudeAccountUsage } from '../settings/ClaudeAccountUsage';
import type { NativeUsageService } from './NativeUsageService';

/**
 * Builds the Overview's usage figures: the locally observable account limits
 * per provider (Codex through its app-server account read, Claude through the
 * CLI sign-in when the operator allowed it) and today's native-session sums
 * from the usage journal. Every probe is cached by its own module, so the
 * Overview polling never multiplies CLI launches or account requests.
 */
export class UsageOverviewService {
  constructor(private readonly deps: {
    nativeUsage: () => Pick<NativeUsageService, 'providerConsumption'> | null;
    claudeEnabled: () => boolean;
    codexAccount?: () => Promise<SubscriptionUsage>;
    claudeAccount?: () => Promise<SubscriptionUsage>;
    now?: () => number;
  }) {}
  /** Local midnight, so "today" matches what the operator means on this PC. */
  static startOfDay(now: number): number { const at = new Date(now); at.setHours(0, 0, 0, 0); return at.getTime(); }
  async overview(): Promise<UsageOverview> {
    const now = (this.deps.now ?? Date.now)(); const since = UsageOverviewService.startOfDay(now); const claudeEnabled = this.deps.claudeEnabled();
    const today = (provider: UsageOverviewProvider): ProviderDayUsage =>
      this.deps.nativeUsage()?.providerConsumption(provider, since) ?? { status: 'unsupported', sessions: 0, events: 0, tokens: unknownTokens(), since };
    const claudeDisabled: SubscriptionUsage = { provider: 'claude', source: 'cli', status: 'unavailable', checkedAt: now, windows: [], command: '/usage',
      message: translate("Claude account limits are switched off. Allow them on the PC under Settings → Usage, or run /usage in Claude Code.") };
    const [codex, claude] = await Promise.all([
      (this.deps.codexAccount ?? cachedCodexAccountUsage)(),
      claudeEnabled ? (this.deps.claudeAccount ?? cachedClaudeAccountUsage)() : Promise.resolve(claudeDisabled),
    ]);
    const providers: ProviderUsageOverview[] = [
      { provider: 'codex', account: { ...codex, command: '/status' }, today: today('codex') },
      { provider: 'claude', account: claude, today: today('claude') },
    ];
    return { checkedAt: now, providers, claudeAccountEnabled: claudeEnabled };
  }
}
