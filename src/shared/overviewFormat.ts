/** Display helpers for Overview. Safe to import from main and renderer. */

export function formatRelativeTime(now: number, at: number): string {
  const delta = Math.max(0, now - at);
  if (delta < 45_000) return 'just now';
  if (delta < 90_000) return '1m';
  if (delta < 3_600_000) return `${Math.round(delta / 60_000)}m`;
  if (delta < 36 * 3_600_000) return `${Math.round(delta / 3_600_000)}h`;
  if (delta < 6 * 86_400_000) return `${Math.round(delta / 86_400_000)}d`;
  return new Date(at).toISOString().slice(0, 10);
}

export function formatTokenCount(value: number): string {
  if (value < 10_000) return String(value);
  if (value < 1_000_000) return `${(value / 1_000).toFixed(value < 100_000 ? 1 : 0)}k`;
  return `${(value / 1_000_000).toFixed(1)}M`;
}

export function formatCostUsd(value: number): string {
  if (value >= 1) return `$${value.toFixed(2)}`;
  if (value >= 0.01) return `$${value.toFixed(2)}`;
  return `$${value.toFixed(4)}`;
}
