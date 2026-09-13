import { useEffect, useRef, useState } from 'react';
import type { SubscriptionUsage } from '../../shared/remote';
import './subscription-usage.css';

export function SubscriptionUsagePanel({ load, online = true, compact = false }: { load: () => Promise<SubscriptionUsage>; online?: boolean; compact?: boolean }) {
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
    catch { if (live.current) { setUsage(undefined); setError('Nutzungsdaten sind nicht erreichbar. Verbindung und Sitzung prüfen.'); } }
    finally { locked.current = false; if (live.current) setBusy(false); }
  };
  useEffect(() => { if (compact && online) void refresh(); }, [compact, online]);
  const provider = usage?.provider === 'codex' ? 'Codex' : usage?.provider === 'claude' ? 'Claude Code' : usage?.provider === 'grok' ? 'Grok Build' : 'CLI';
  const mode = usage?.authentication === 'api-key-present' ? 'API-Zugang vorhanden' : usage?.authentication === 'subscription-account' ? 'Abo-Konto erkannt' : 'Anmeldung unbestätigt';
  return <details className={`terminal-usage ${compact ? 'terminal-usage-compact' : ''}`} open={opened} onKeyDown={(event) => {
    if (compact && opened && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpened(false); event.currentTarget.querySelector('summary')?.focus(); }
  }} onToggle={(event) => {
    setOpened(event.currentTarget.open); if (event.currentTarget.open && !usage) void refresh();
  }}>
    <summary aria-label="Abo-Nutzung">{compact ? `${provider} · ${usage ? mode : busy ? 'Nutzung wird geprüft…' : 'Nutzung / Anmeldung'}` : 'Abo-Nutzung'}</summary>
    {opened && <section aria-label="Abo-Nutzung" aria-busy={busy}>
      <p>Abo-Limits sind vom Kontextfenster und von API-Kosten getrennt.</p>
      {!online && <p role="status">PC nicht verbunden. Werte können veraltet sein.</p>}
      {busy && <p role="status">Nutzung wird abgefragt…</p>}{error && <p role="alert">{error}</p>}
      {usage && <>
        <p><strong>{provider} · {mode}</strong></p>
        {usage.source === 'codex-account' && usage.windows.length > 0 && <p>Das lokale Codex-Konto liefert diese Abo-Limits. Sie zeigen kein API-Guthaben und bestätigen nicht die Anmeldung der laufenden CLI-Sitzung.</p>}
        {!usage.authentication && <p>ADE kann die aktive Anmeldung dieser CLI nicht automatisch bestätigen. Ein fehlender API-Key beweist kein Abo.</p>}
        <p>{usage.message}</p>
        {usage.windows.map((window, index) => <div key={index}>
          <strong>{window.windowMinutes % 1440 === 0 ? `${window.windowMinutes / 1440} Tage` : window.windowMinutes % 60 === 0 ? `${window.windowMinutes / 60} Stunden` : `${window.windowMinutes} Minuten`}: {Math.round(window.remainingPercent)} % übrig</strong>
          <span>{Math.round(window.usedPercent)} % verbraucht</span>
          <progress max={100} value={window.usedPercent} aria-label={`${window.label}: verbraucht`} />
          <span>Reset: {new Date(window.resetsAt).toLocaleString()} · {window.resetsAt <= now ? 'Zeitpunkt erreicht; Nutzung erneut abfragen.' : `in ${Math.floor((window.resetsAt - now) / 3600000)} Std. ${Math.ceil((window.resetsAt - now) / 60000) % 60} Min.`}</span>
        </div>)}
        {usage.command && <p>In der bereiten CLI eingeben: <code>{usage.command}</code>. ADE sendet diesen Befehl erst durch deine Terminal-Eingabe.</p>}
        <p>Stand: {new Date(usage.checkedAt).toLocaleString()} · {usage.source === 'codex-account' ? 'Codex-Kontoabfrage; höchstens einmal pro Minute.' : 'Anzeige in der Anbieter-CLI.'}</p>
        {now - usage.checkedAt > 120_000 && <p role="status">Werte sind älter als zwei Minuten. Nutzung aktualisieren.</p>}
      </>}
      <button disabled={busy || !online} onClick={() => void refresh()}>Nutzung aktualisieren</button>
    </section>}
  </details>;
}
