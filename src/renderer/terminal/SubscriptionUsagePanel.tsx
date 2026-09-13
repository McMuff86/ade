import { useEffect, useRef, useState } from 'react';
import type { SubscriptionUsage } from '../../shared/remote';
import './subscription-usage.css';

export function SubscriptionUsagePanel({ load, online = true }: { load: () => Promise<SubscriptionUsage>; online?: boolean }) {
  const [opened, setOpened] = useState(false); const [busy, setBusy] = useState(false);
  const [usage, setUsage] = useState<SubscriptionUsage>(); const [error, setError] = useState('');
  const live = useRef(true); const locked = useRef(false);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const refresh = async () => {
    if (locked.current || !online) return; locked.current = true; setBusy(true); setError('');
    try { const result = await load(); if (live.current) setUsage(result); }
    catch { if (live.current) { setUsage(undefined); setError('Nutzungsdaten sind nicht erreichbar. Verbindung und Sitzung prüfen.'); } }
    finally { locked.current = false; if (live.current) setBusy(false); }
  };
  return <details className="terminal-usage" open={opened} onToggle={(event) => {
    setOpened(event.currentTarget.open); if (event.currentTarget.open && !usage) void refresh();
  }}>
    <summary>Abo-Nutzung</summary>
    {opened && <section aria-label="Abo-Nutzung" aria-busy={busy}>
      <p>Abo-Limits sind vom Kontextfenster und von API-Kosten getrennt.</p>
      {!online && <p role="status">PC nicht verbunden. Werte können veraltet sein.</p>}
      {busy && <p role="status">Nutzung wird abgefragt…</p>}{error && <p role="alert">{error}</p>}
      {usage && <>
        <p>{usage.message}</p>
        {usage.windows.map((window, index) => <div key={index}>
          <strong>{window.windowMinutes % 1440 === 0 ? `${window.windowMinutes / 1440} Tage` : window.windowMinutes % 60 === 0 ? `${window.windowMinutes / 60} Stunden` : `${window.windowMinutes} Minuten`}: {Math.round(window.remainingPercent)} % übrig</strong>
          <progress max={100} value={window.usedPercent} aria-label={`${window.label}: verbraucht`} />
          <span>Reset: {new Date(window.resetsAt).toLocaleString()}</span>
        </div>)}
        {usage.command && <p>In der bereiten CLI eingeben: <code>{usage.command}</code>. ADE sendet diesen Befehl erst durch deine Terminal-Eingabe.</p>}
        <p>Stand: {new Date(usage.checkedAt).toLocaleString()} · {usage.source === 'codex-account' ? 'Codex-Kontoabfrage; höchstens einmal pro Minute.' : 'Anzeige in der Anbieter-CLI.'}</p>
      </>}
      <button disabled={busy || !online} onClick={() => void refresh()}>Nutzung aktualisieren</button>
    </section>}
  </details>;
}
