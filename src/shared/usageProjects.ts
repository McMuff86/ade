import type { TokenCounts, UsageCostKind, UsageProvider } from './usage';

/**
 * Tokens per project and per session for the Projects room (desktop and
 * tablet). Sums come from the usage journal of native ADE sessions; a window
 * counts requests by their own time, so a session running past midnight is
 * split honestly. Only ids and numbers travel; names are resolved by the
 * shell from its catalog. Unknown token fields stay `null`, never zero.
 */
export type UsageRange = 'today' | '7d' | '30d';
export const USAGE_RANGES: readonly UsageRange[] = ['today', '7d', '30d'];
export interface UsageProjectsQuery { range: UsageRange }
export interface UsageCostSummary { usd: number; events: number; eventsWithoutCost: number; kinds: UsageCostKind[]; complete: boolean }
export interface ProjectSessionUsage {
  id: string; terminalSessionId?: string; agentId?: string; provider: UsageProvider;
  startedAt: number; endedAt?: number; models: string[]; events: number; tokens: TokenCounts; cost: UsageCostSummary | null;
}
export interface ProjectUsage {
  /** `null` groups sessions without a project (personal agent folders). */
  repositoryId: string | null;
  status: 'recording' | 'waiting' | 'unsupported' | 'incomplete';
  sessions: number; events: number; tokens: TokenCounts; cost: UsageCostSummary | null;
  providers: Array<{ provider: UsageProvider; sessions: number; events: number; tokens: TokenCounts }>;
  items: ProjectSessionUsage[];
}
export interface UsageProjectsResult { range: UsageRange; since: number; checkedAt: number; projects: ProjectUsage[] }

/** Start of the window: local midnight for today, otherwise whole days back from local midnight. */
export function usageRangeSince(range: UsageRange, now: number): number {
  const day = new Date(now); day.setHours(0, 0, 0, 0);
  return day.getTime() - (range === '7d' ? 6 : range === '30d' ? 29 : 0) * 86_400_000;
}
export const validUsageProjectsQuery = (value: unknown): value is UsageProjectsQuery =>
  !!value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 1 && (USAGE_RANGES as readonly unknown[]).includes((value as { range?: unknown }).range);
/** A project's total tokens for a card: input, output and reasoning, or null when nothing is known. */
export function projectTokenTotal(tokens: TokenCounts): number | null {
  const parts = [tokens.input, tokens.output, tokens.reasoning].filter((value): value is number => value !== null);
  return parts.length ? parts.reduce((sum, value) => sum + value, 0) : null;
}
