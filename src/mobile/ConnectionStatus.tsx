/**
 * One place that answers "is the PC reachable, and what should I do?".
 * The header pill states the situation in one word; the dialog explains it
 * and offers exactly the action that fits. Re-pairing is never suggested for
 * a network interruption (UX-05).
 */
import type { JSX } from 'react';
import { Dialog, Icon } from './ui';
import type { MobileHost } from './useMobileHost';
import type { compareBuilds } from '../shared/buildInfo';

type BuildComparison = ReturnType<typeof compareBuilds>;

export type ConnectionSituation = 'online' | 'reconnecting' | 'unreachable' | 'build';

export function connectionSituation(host: Pick<MobileHost, 'status' | 'paired'>, build: BuildComparison): ConnectionSituation {
  if (host.status === 'online') return build === 'different' ? 'build' : 'online';
  return host.status === 'connecting' ? 'reconnecting' : 'unreachable';
}

/** Short label; tests and the status bar rely on the exact word "Verbunden". */
export function connectionLabel(host: Pick<MobileHost, 'status' | 'paired'>): string {
  if (!host.paired) return 'Privater Zugriff';
  return host.status === 'online' ? 'Verbunden' : host.status === 'connecting' ? 'Verbinde…' : 'Offline';
}

export function ConnectionDialog({ host, build, onClose, onSettings, fallbackId }: {
  host: MobileHost; build: BuildComparison; onClose: () => void; onSettings: () => void; fallbackId: string;
}): JSX.Element {
  const situation = connectionSituation(host, build);
  const seen = host.lastSeen ? new Date(host.lastSeen).toLocaleTimeString() : null;
  return <Dialog title="Verbindung zum PC" onClose={onClose} fallbackId={fallbackId} className="m-connection-dialog">
    <dl className="m-connection-facts">
      <div><dt>Zustand</dt><dd data-situation={situation}>
        {situation === 'online' && 'Verbunden. Daten und Terminals kommen live vom PC.'}
        {situation === 'build' && 'Verbunden, aber Browser und PC verwenden unterschiedliche Builds.'}
        {situation === 'reconnecting' && 'Kurz unterbrochen. Die Verbindung wird wiederhergestellt.'}
        {situation === 'unreachable' && 'PC nicht erreichbar.'}
      </dd></div>
      <div><dt>Letzte Bestätigung</dt><dd>{seen ?? 'Noch keine Antwort in dieser Sitzung'}</dd></div>
      <div><dt>Kopplung</dt><dd>Bleibt bestehen. Ein Netzwerkwechsel braucht keine neue Kopplung; dieses Gerät meldet sich mit seinem gespeicherten Schlüssel wieder an.</dd></div>
    </dl>
    {situation === 'reconnecting' && <p>Angezeigte Daten können veraltet sein. Entwürfe bleiben auf diesem Gerät gespeichert und werden nach der Wiederverbindung übertragen.</p>}
    {situation === 'unreachable' && <>
      <p>Das hilft, in dieser Reihenfolge:</p>
      <ol className="m-connection-steps">
        <li>Tailscale auf diesem Gerät verbunden? Mobilfunk und fremdes WLAN brauchen die aktive Tailscale-Verbindung.</li>
        <li>PC eingeschaltet und ADE geöffnet? Nach einem PC-Neustart läuft der mobile Zugriff erst, wenn ADE wieder gestartet ist.</li>
        <li>Erst danach erneut verbinden. Den Browserspeicher nicht löschen; er enthält die Kopplung.</li>
      </ol>
    </>}
    {situation === 'build' && <p>Nach einem Neubau am PC muss ADE dort vollständig beendet und neu gestartet werden; das Schliessen des Fensters lässt den alten Stand weiterlaufen. Danach diese Seite neu laden.</p>}
    {host.error && <p className="m-alert" role="alert">{host.error}</p>}
    <div className="m-actions">
      {situation !== 'online' && situation !== 'build' && <button className="m-primary" onClick={() => { host.reconnect(); onClose(); }}><Icon name="refresh" />Erneut verbinden</button>}
      {situation === 'build' && <button className="m-primary" onClick={() => { onClose(); onSettings(); }}>Build-Stand ansehen</button>}
      <button onClick={onClose}>Schliessen</button>
    </div>
  </Dialog>;
}
