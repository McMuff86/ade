import { localizeAppMessage } from '../../shared/i18n/appMessages';
import { intlLocale } from '../../shared/i18n';
import { t as translate } from "../../shared/i18n";
import { useLocale } from "../i18n/language";
import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import { formatTokenCount } from '../../shared/overviewFormat';
import { TOKEN_FIELDS, type TokenCounts } from '../../shared/usage';
import { tightestUsageWindow, USAGE_PROVIDER_LABELS, type ProviderUsageOverview, type UsageOverview } from '../../shared/usageOverview';
import './usage-overview.css';

/**
 * Usage on the Overview home, shared by desktop and tablet: a hero tile with
 * the window closest to its limit and a panel below the hero with every
 * provider's account windows and today's native-session tokens. The parent
 * owns the state through `useUsageOverview` so tile and panel can sit in
 * different parts of the layout; `load` is the only difference between the
 * two shells (IPC on the desktop, host API on the tablet).
 */
export interface UsageOverviewState {
  data: UsageOverview | null; error: string; busy: boolean; expanded: boolean;
  refresh(): Promise<void>; toggle(): void; collapse(): void;
}
export function useUsageOverview(load: () => Promise<UsageOverview>, online = true): UsageOverviewState {
  const [data, setData] = useState<UsageOverview | null>(null); const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const [expanded, setExpanded] = useState(false);
  const live = useRef(true); const locked = useRef(false); const loader = useRef(load); loader.current = load;
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const refresh = useCallback(async () => {
    if (locked.current || !online) return; locked.current = true; setBusy(true);
    try { const value = await loader.current(); if (live.current) { setData(value); setError(''); } }
    catch (reason) { if (live.current) setError(reason instanceof Error ? reason.message : translate("Usage data is not reachable. Check connection and session.")); }
    finally { locked.current = false; if (live.current) setBusy(false); }
  }, [online]);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { if (!expanded || !online) return; const timer = setInterval(() => { void refresh(); }, 60_000); return () => clearInterval(timer); }, [expanded, online, refresh]);
  return { data, error, busy, expanded, refresh, toggle: () => setExpanded(value => !value), collapse: () => setExpanded(false) };
}

const resetIn = (resetsAt: number, now: number): string => {
  const minutes = Math.max(0, Math.round((resetsAt - now) / 60_000));
  return minutes >= 60 ? translate("in {{value1}} h {{value2}} min", { value1: Math.floor(minutes / 60), value2: minutes % 60 }) : translate("in {{value1}} min", { value1: minutes });
};

/** The hero cell. `className` lets each shell keep its own tile styling. */
export function UsageOverviewTile({ usage, className, panelId }: { usage: UsageOverviewState; className: string; panelId: string }): JSX.Element {
  useLocale();
  const tightest = usage.data ? tightestUsageWindow(usage.data) : null;
  const caption = tightest ? `${USAGE_PROVIDER_LABELS[tightest.provider]} · ${tightest.window.label} · ${translate("Reset:")} ${new Date(tightest.window.resetsAt).toLocaleString(intlLocale(), { weekday: 'short', hour: '2-digit', minute: '2-digit' })}`
    : usage.error ? localizeAppMessage(usage.error) : usage.data ? translate("No account limits readable yet") : usage.busy ? translate("Checking usage…") : translate("Waiting for the PC");
  return <div className={className} data-testid="overview-usage">
    <span className="ov-stat-label m-eyebrow">{translate("Usage")}</span>
    <strong className="ov-stat-value" data-testid="overview-usage-value">{tightest ? `${Math.round(tightest.window.usedPercent)} %` : '—'}</strong>
    <small className="ov-stat-note">{caption}</small>
    <button type="button" className="usage-overview-toggle" aria-expanded={usage.expanded} aria-controls={panelId} onClick={usage.toggle}>{usage.expanded ? translate("Hide usage") : translate("Show usage")}</button>
  </div>;
}

function Tokens({ tokens }: { tokens: TokenCounts }): JSX.Element {
  useLocale();
  const labels: Record<keyof TokenCounts, string> = { input: translate("Input"), inputUncached: translate("Input (uncached)"), output: translate("Output"), cacheRead: translate("Cache read"), cacheWrite: translate("Cache write"), reasoning: translate("Reasoning") };
  const known = TOKEN_FIELDS.filter(field => tokens[field] !== null);
  if (!known.length) return <p className="usage-overview-note">{translate("No token figures were reported today.")}</p>;
  return <dl className="usage-overview-tokens">{known.map(field => <div key={field}><dt>{labels[field]}</dt><dd>{formatTokenCount(tokens[field]!)}</dd></div>)}</dl>;
}

function Provider({ item, now }: { item: ProviderUsageOverview; now: number }): JSX.Element {
  useLocale();
  const { account, today } = item;
  return <section className="usage-overview-provider" aria-label={USAGE_PROVIDER_LABELS[item.provider]}>
    <h3>{USAGE_PROVIDER_LABELS[item.provider]}</h3>
    <div className="usage-overview-account">
      <h4>{translate("Account limits")}</h4>
      {account.windows.map((window, index) => <div key={index} className="usage-overview-window">
        <span>{window.label}</span>
        <progress max={100} value={window.usedPercent} aria-label={translate("{{value1}}: used", { value1: window.label })} />
        <span>{Math.round(window.usedPercent)}{" "}{translate("% consumed")} · {translate("Reset:")}{" "}{new Date(window.resetsAt).toLocaleString(intlLocale(), { weekday: 'short', hour: '2-digit', minute: '2-digit' })} ({resetIn(window.resetsAt, now)})</span>
      </div>)}
      <p className="usage-overview-note">{localizeAppMessage(account.message)}{account.command && account.status !== 'available' ? <>{' '}{translate("In the ready CLI enter:")}{' '}<code>{account.command}</code></> : null}</p>
    </div>
    <div className="usage-overview-today">
      <h4>{translate("Today in ADE sessions")}</h4>
      {today.status === 'unsupported' ? <p className="usage-overview-note">{translate("No native {{value1}} session was measured today. Capture applies to sessions started through ADE.", { value1: USAGE_PROVIDER_LABELS[item.provider] })}</p>
        : <><p className="usage-overview-note">{translate("{{value1}} session(s) · {{value2}} request(s) since {{value3}}", { value1: today.sessions, value2: today.events, value3: new Date(today.since).toLocaleTimeString(intlLocale(), { hour: '2-digit', minute: '2-digit' }) })}{today.status === 'incomplete' ? ` · ${translate("Coverage incomplete")}` : ''}</p>
          <Tokens tokens={today.tokens} /></>}
    </div>
  </section>;
}

/** The expandable detail panel; render it right after the hero so it reads as part of the figures. */
export function UsageOverviewPanel({ usage, id, online = true }: { usage: UsageOverviewState; id: string; online?: boolean }): JSX.Element | null {
  useLocale();
  const [now, setNow] = useState(Date.now()); const root = useRef<HTMLElement>(null);
  useEffect(() => { if (!usage.expanded) return; setNow(Date.now()); const timer = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(timer); }, [usage.expanded, usage.data]);
  if (!usage.expanded) return null;
  return <section ref={root} id={id} className="usage-overview-panel" aria-label={translate("Usage")} onKeyDown={event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); usage.collapse(); document.querySelector<HTMLElement>('[aria-controls="' + id + '"]')?.focus(); }
  }}>
    <p className="usage-overview-note">{translate("Account limits are percentages of the provider's subscription windows; today's tokens come from native sessions started through ADE. Neither replaces the provider's own billing view.")}</p>
    {usage.error && <p role="alert" className="usage-overview-note">{localizeAppMessage(usage.error)}</p>}
    {usage.data?.providers.map(item => <Provider key={item.provider} item={item} now={now} />)}
    {usage.data && !usage.data.claudeAccountEnabled && <p className="usage-overview-note">{translate("Claude account limits appear here once “Read Claude account limits” is switched on under Settings → Usage on the PC.")}</p>}
    <div className="usage-overview-actions">
      <button type="button" disabled={usage.busy || !online} onClick={() => void usage.refresh()}>{usage.busy ? translate("Fetching usage…") : translate("Refresh usage")}</button>
      {usage.data && <span className="usage-overview-note">{translate("Status:")}{" "}{new Date(usage.data.checkedAt).toLocaleTimeString(intlLocale())}</span>}
    </div>
  </section>;
}
