import { localizeAppMessage } from '../../shared/i18n/appMessages';
import { intlLocale } from '../../shared/i18n';
import { t as translate } from "../../shared/i18n";
import { useLocale } from "../i18n/language";
import { useEffect, useRef, useState } from 'react';
import type { SubscriptionUsage } from '../../shared/remote';
import { SessionConsumptionView } from './SessionConsumptionView';
import './subscription-usage.css';

export function SubscriptionUsagePanel({ load, online = true, compact = false }: { load: () => Promise<SubscriptionUsage>; online?: boolean; compact?: boolean }) {
  useLocale();
  const [opened, setOpened] = useState(false); const [busy, setBusy] = useState(false);
  const [usage, setUsage] = useState<SubscriptionUsage>(); const [error, setError] = useState('');
  const [now, setNow] = useState(Date.now());
  useEffect(() => { if (!opened) return; setNow(Date.now()); const timer = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(timer); }, [opened]);
  const live = useRef(true); const locked = useRef(false);
  const loadRef = useRef(load); loadRef.current = load;
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const refresh = async () => {
    if (locked.current || !online) return; locked.current = true; setBusy(true); setError('');
    try { const result = await loadRef.current(); if (live.current) setUsage(result); }
    catch { if (live.current) { setUsage(undefined); setError(translate("Usage data is not reachable. Check connection and session.")); } }
    finally { locked.current = false; if (live.current) setBusy(false); }
  };
  useEffect(() => { if (compact && online) void refresh(); }, [compact, online]);
  useEffect(() => {
    if (!opened || !online) return;
    const timer = setInterval(() => { void refresh(); }, 10_000); return () => clearInterval(timer);
  }, [opened, online]);
  const provider = usage?.provider === 'codex' ? translate("Codex") : usage?.provider === 'claude' ? translate("Claude Code") : usage?.provider === 'grok' ? translate("Grok Build") : 'CLI';
  const mode = usage?.authentication === 'api-key-present' ? translate("API access available") : usage?.authentication === 'subscription-account' ? translate("Subscription Account Recognized") : translate("Sign-in unconfirmed");
  return <details className={`terminal-usage ${compact ? 'terminal-usage-compact' : ''}`} open={opened} onKeyDown={(event) => {
    if (compact && opened && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpened(false); event.currentTarget.querySelector('summary')?.focus(); }
  }} onToggle={(event) => {
    setOpened(event.currentTarget.open); if (event.currentTarget.open && !usage) void refresh();
  }}>
    <summary aria-label={translate("Subscription use")}>{compact ? `${opened ? translate("Hide usage") : translate("Show usage")} · ${provider}${usage && !opened ? ` · ${mode}` : busy && !opened ? ` · ${translate("Checking usage…")}` : ''}` : translate("Subscription use")}</summary>
    {opened && <section aria-label={translate("Subscription use")} aria-busy={busy}>
      <p>{translate("Subscription limits are separate from the context window and API costs.")}</p>
      {!online && <p role="status">{translate("PC not connected. Values may be obsolete.")}</p>}
      {busy && <p role="status">{translate("Fetching usage…")}</p>}{error && <p role="alert">{localizeAppMessage(error)}</p>}
      {usage && <>
        {usage.consumption && <SessionConsumptionView value={usage.consumption} />}
        <p><strong>{provider} · {mode}</strong></p>
        {usage.source === 'codex-account' && usage.windows.length > 0 && <p>{translate("The local Codex account delivers these subscription limits; they do not show API credit and do not confirm the login of the current CLI session.")}</p>}
        {!usage.authentication && <p>{translate("ADE cannot automatically confirm the active sign-in of this CLI. A missing API key does not prove a subscription.")}</p>}
        <p>{usage.message}</p>
        {usage.windows.map((window, index) => <div key={index}>
          <strong>{window.windowMinutes % 1440 === 0 ? `${window.windowMinutes / 1440} Tage` : window.windowMinutes % 60 === 0 ? `${window.windowMinutes / 60} Stunden` : translate("{{value1}} minutes", { value1: window.windowMinutes })}: {Math.round(window.remainingPercent)}{" "}{translate("% remaining")}</strong>
          <span>{Math.round(window.usedPercent)}{" "}{translate("% consumed")}</span>
          <progress max={100} value={window.usedPercent} aria-label={translate("{{value1}}: used", { value1: window.label })} />
          <span>{translate("Reset:")}{" "}{new Date(window.resetsAt).toLocaleString(intlLocale())} · {window.resetsAt <= now ? translate("Time reached; retrieve usage.") : translate("in {{value1}} h {{value2}} min", { value1: Math.floor((window.resetsAt - now) / 3600000), value2: Math.ceil((window.resetsAt - now) / 60000) % 60 })}</span>
        </div>)}
        {usage.command && <p>{translate("In the ready CLI enter:")}{" "}<code>{usage.command}</code>{translate("ADE sends this command only through your terminal input.")}</p>}
        <p>{translate("Status:")}{" "}{new Date(usage.checkedAt).toLocaleString(intlLocale())} · {usage.source === 'codex-account' ? translate("Codex account interrogation; maximum once per minute.") : translate("Display in the provider CLI.")}</p>
        {now - usage.checkedAt > 120_000 && <p role="status">{translate("Values are older than two minutes. Update usage.")}</p>}
      </>}
      <button disabled={busy || !online} onClick={() => void refresh()}>{translate("Refresh usage")}</button>
    </section>}
  </details>;
}
