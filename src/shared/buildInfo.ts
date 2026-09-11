import type { MobileBuildInfo } from './remote';

declare const __ADE_BUILD_INFO__: unknown;

export function isBuildInfo(value: unknown): value is MobileBuildInfo {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return Object.keys(item).sort().join(',') === 'builtAt,sourceId'
    && typeof item.sourceId === 'string' && /^[a-f0-9]{20}$/.test(item.sourceId)
    && typeof item.builtAt === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(item.builtAt) && Number.isFinite(Date.parse(item.builtAt));
}
const compiled = typeof __ADE_BUILD_INFO__ === 'undefined' ? undefined : __ADE_BUILD_INFO__;
/** Direct tsx tests/development without build injection report unknown, never a fake release. */
export const BUILD_INFO: Readonly<MobileBuildInfo> | undefined = isBuildInfo(compiled) ? Object.freeze({ ...compiled }) : undefined;

export function compareBuilds(host: unknown, browser: unknown = BUILD_INFO): 'same' | 'different' | 'unknown' {
  return !isBuildInfo(host) || !isBuildInfo(browser) ? 'unknown' : host.sourceId === browser.sourceId ? 'same' : 'different';
}
