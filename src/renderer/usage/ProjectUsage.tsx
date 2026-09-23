import { localizeAppMessage } from '../../shared/i18n/appMessages';
import { intlLocale } from '../../shared/i18n';
import { t as translate } from "../../shared/i18n";
import { useLocale } from "../i18n/language";
import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import { formatCostUsd, formatTokenCount } from '../../shared/overviewFormat';
import { TOKEN_FIELDS, type TokenCounts } from '../../shared/usage';
import { USAGE_PROVIDER_LABELS } from '../../shared/usageOverview';
import { projectTokenTotal, USAGE_RANGES, type ProjectUsage as ProjectUsageValue, type UsageProjectsResult, type UsageRange } from '../../shared/usageProjects';
import './usage-overview.css';

/**
 * Tokens per project on the project cards, shared by desktop and tablet. One
 * range switch (7 days by default, per device preference) governs every card;
 * each card carries a usage line with tokens, sessions and costs and can open
 * a breakdown by provider and session. `load` is the shell's transport.
 */
export interface ProjectUsageState {
  range: UsageRange; setRange(range: UsageRange): void;
  data: UsageProjectsResult | null; busy: boolean; error: string; refresh(): Promise<void>;
  expanded: string | null; toggle(repositoryId: string): void; collapse(): void;
  agentName?: (id: string) => string;
}
const RANGE_KEY = 'ade:usage-range';
export const rangeLabel = (range: UsageRange): string => range === 'today' ? translate("Today") : range === '7d' ? translate("7 days") : translate("30 days");
export function useProjectUsage(load: (range: UsageRange) => Promise<UsageProjectsResult>, online = true, agentName?: (id: string) => string): ProjectUsageState {
  const [range, setRangeState] = useState<UsageRange>(() => { try { const stored = localStorage.getItem(RANGE_KEY); return (USAGE_RANGES as readonly string[]).includes(stored ?? '') ? stored as UsageRange : '7d'; } catch { return '7d'; } });
  const [data, setData] = useState<UsageProjectsResult | null>(null); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [expanded, setExpanded] = useState<string | null>(null);
  const live = useRef(true); const loader = useRef(load); loader.current = load; const version = useRef(0);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const refresh = useCallback(async () => {
    if (!online) return; const own = ++version.current; setBusy(true);
    try { const value = await loader.current(range); if (live.current && own === version.current) { setData(value); setError(''); } }
    catch (reason) { if (live.current && own === version.current) setError(reason instanceof Error ? reason.message : translate("Usage data is not reachable. Check connection and session.")); }
    finally { if (live.current && own === version.current) setBusy(false); }
  }, [online, range]);
  useEffect(() => { void refresh(); }, [refresh]);
  const setRange = (next: UsageRange) => { setRangeState(next); try { localStorage.setItem(RANGE_KEY, next); } catch { /* the choice still applies for this page */ } };
  return { range, setRange, data, busy, error, refresh, expanded, toggle: (id) => setExpanded(value => value === id ? null : id), collapse: () => setExpanded(null), agentName };
}

export function ProjectUsageRangeSwitch({ usage }: { usage: ProjectUsageState }): JSX.Element {
  useLocale();
  return <div className="project-workspace-actions project-usage-range" role="group" aria-label={translate("Usage period")}>
    {USAGE_RANGES.map(range => <button key={range} type="button" aria-pressed={usage.range === range} onClick={() => usage.setRange(range)}>{rangeLabel(range)}</button>)}
  </div>;
}

const summary = (project: ProjectUsageValue | undefined, range: UsageRange): string => {
  if (!project || project.status === 'unsupported') return translate("No ADE sessions in this period");
  const total = projectTokenTotal(project.tokens);
  const parts = [total === null ? translate("Tokens unknown") : translate("{{value1}} tokens", { value1: formatTokenCount(total) }), translate("{{count}} session(s)", { count: project.sessions })];
  if (project.cost) parts.push(`${formatCostUsd(project.cost.usd)}${project.cost.complete ? '' : ` ${translate("(partly estimated)")}`}`);
  if (project.status === 'incomplete') parts.push(translate("coverage incomplete"));
  return `${rangeLabel(range)}: ${parts.join(' · ')}`;
};

/** One card's usage line plus the breakdown toggle. */
export function ProjectUsageLine({ usage, repositoryId }: { usage: ProjectUsageState; repositoryId: string }): JSX.Element {
  useLocale();
  const project = usage.data?.projects.find(item => item.repositoryId === repositoryId);
  const open = usage.expanded === repositoryId; const panelId = `project-usage-${repositoryId}`;
  return <div className="project-usage" data-testid="project-usage" data-repository={repositoryId}>
    <p className="project-usage-line"><span className="project-usage-label">{translate("Usage")}</span>{' '}{usage.data ? summary(project, usage.range) : usage.error ? localizeAppMessage(usage.error) : translate("Checking usage…")}</p>
    {project && project.status !== 'unsupported' && <button type="button" className="usage-overview-toggle" aria-expanded={open} aria-controls={panelId} onClick={() => usage.toggle(repositoryId)}>{open ? translate("Hide breakdown") : translate("Breakdown")}</button>}
    {open && project && <ProjectUsageBreakdown id={panelId} project={project} usage={usage} />}
  </div>;
}

function tokenCells(tokens: TokenCounts): string {
  const value = (field: keyof TokenCounts) => tokens[field] === null ? '—' : formatTokenCount(tokens[field]!);
  return `${value('input')} / ${value('output')} / ${value('cacheRead')}`;
}
function ProjectUsageBreakdown({ id, project, usage }: { id: string; project: ProjectUsageValue; usage: ProjectUsageState }): JSX.Element {
  useLocale();
  return <section id={id} tabIndex={-1} className="usage-overview-panel project-usage-breakdown" aria-label={translate("Usage breakdown")} onKeyDown={event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); usage.collapse(); document.querySelector<HTMLElement>(`[aria-controls="${id}"]`)?.focus(); }
  }}>
    <p className="usage-overview-note">{translate("Native sessions started through ADE in this period; requests count by their own time. Tokens as input / output / cache read.")}</p>
    <dl className="usage-overview-tokens">{TOKEN_FIELDS.filter(field => project.tokens[field] !== null).map(field => <div key={field}><dt>{field === 'input' ? translate("Input") : field === 'inputUncached' ? translate("Input (uncached)") : field === 'output' ? translate("Output") : field === 'cacheRead' ? translate("Cache read") : field === 'cacheWrite' ? translate("Cache write") : translate("Reasoning")}</dt><dd>{formatTokenCount(project.tokens[field]!)}</dd></div>)}
      {project.cost && <div><dt>{translate("Costs")}</dt><dd>{formatCostUsd(project.cost.usd)} · {project.cost.kinds.map(kind => kind === 'provider-reported' ? translate("reported") : kind === 'provider-estimate' ? translate("provider estimate") : translate("configured estimate")).join(', ')}{project.cost.eventsWithoutCost ? ` · ${translate("{{count}} request(s) without cost", { count: project.cost.eventsWithoutCost })}` : ''}</dd></div>}
    </dl>
    <ul className="project-usage-providers">{project.providers.map(item => <li key={item.provider}><strong>{USAGE_PROVIDER_LABELS[item.provider as keyof typeof USAGE_PROVIDER_LABELS] ?? item.provider}</strong> · {translate("{{count}} session(s)", { count: item.sessions })} · {tokenCells(item.tokens)}</li>)}</ul>
    <table className="project-usage-sessions"><caption>{translate("Sessions")}</caption>
      <thead><tr><th>{translate("Start")}</th><th>{translate("Agent")}</th><th>{translate("Provider")}</th><th>{translate("Model")}</th><th>{translate("Tokens")}</th><th>{translate("Costs")}</th></tr></thead>
      <tbody>{project.items.map(item => <tr key={item.id}>
        <td>{new Date(item.startedAt).toLocaleString(intlLocale(), { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</td>
        <td>{item.agentId ? usage.agentName?.(item.agentId) ?? item.agentId : translate("no agent profile")}</td>
        <td>{USAGE_PROVIDER_LABELS[item.provider as keyof typeof USAGE_PROVIDER_LABELS] ?? item.provider}</td>
        <td>{item.models.join(', ') || '—'}</td>
        <td>{tokenCells(item.tokens)}</td>
        <td>{item.cost ? formatCostUsd(item.cost.usd) : '—'}</td>
      </tr>)}</tbody>
    </table>
  </section>;
}
