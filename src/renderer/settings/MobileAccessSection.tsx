import { useCallback, useEffect, useLayoutEffect, useRef, useState, type JSX } from 'react';
import QRCode from 'qrcode';
import type { MobileAccessStatus, MobilePairingChallenge } from '../../shared/mobileAccess';

export function MobileAccessSection(): JSX.Element {
  const [status, setStatus] = useState<MobileAccessStatus | null>(null);
  const [pairing, setPairing] = useState<MobilePairingChallenge | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const refreshButton = useRef<HTMLButtonElement>(null);
  const pairButton = useRef<HTMLButtonElement>(null);
  const codeInput = useRef<HTMLInputElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const actionBusy = useRef(false);
  const focusAfter = useRef<'pair' | 'refresh' | null>(null);

  useLayoutEffect(() => {
    if (busy || !focusAfter.current) return;
    (focusAfter.current === 'pair' ? pairButton.current : refreshButton.current)?.focus();
    focusAfter.current = null;
  }, [busy, status, pairing]);
  const refresh = useCallback(async (): Promise<void> => {
    try { setStatus(await window.ade.invoke('mobileAccess:status')); }
    catch { setError('Verbindungsstatus konnte nicht geladen werden. Erneut prüfen.'); }
  }, []);
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => { void refresh(); }, 20_000);
    return () => { clearInterval(timer); void window.ade.invoke('mobileAccess:cancelPair').catch(() => undefined); };
  }, [refresh]);
  useEffect(() => {
    if (!pairing) return;
    if (canvas.current) void QRCode.toCanvas(canvas.current, pairing.url, { width: 224, margin: 4, errorCorrectionLevel: 'M' })
      .catch(() => setError('QR-Code konnte nicht angezeigt werden. Den Pairing-Code verwenden.'));
    codeInput.current?.focus();
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [pairing]);

  const enable = async (enabled: boolean): Promise<void> => {
    if (actionBusy.current) return;
    actionBusy.current = true; setBusy(true); setError(''); setPairing(null);
    try { setStatus(await window.ade.invoke('mobileAccess:setEnabled', { enabled })); }
    catch { setError('Verbindung konnte nicht geändert werden. Status erneut prüfen.'); }
    finally { actionBusy.current = false; focusAfter.current = 'refresh'; setBusy(false); }
  };
  const pair = async (): Promise<void> => {
    if (actionBusy.current) return;
    actionBusy.current = true; setBusy(true); setError('');
    try { setPairing(await window.ade.invoke('mobileAccess:pair')); setNow(Date.now()); }
    catch { setError('Pairing konnte nicht gestartet werden. Verbindung erneut prüfen.'); }
    finally { actionBusy.current = false; setBusy(false); }
  };
  const expired = pairing !== null && pairing.expiresAt <= now;
  return <section className="st-mobile" aria-labelledby="mobile-access-title" data-testid="mobile-access">
    <div className="st-device-heading"><h3 id="mobile-access-title">Mobiler Zugriff</h3>
      <button type="button" className="btn" ref={refreshButton} disabled={busy} onClick={() => void refresh()}>Verbindung prüfen</button></div>
    <p className="st-device-hint">ADE auf Tablet und Smartphone nutzen. Tailscale auf dem PC und Mobilgerät mit demselben Konto verbinden.
      Der PC muss eingeschaltet und angemeldet bleiben. Bei aktivem mobilen Zugriff läuft ADE nach dem Schliessen des Fensters im Infobereich weiter.
      Dort lässt sich ADE wieder öffnen oder vollständig beenden.</p>
    {!status && <p role="status">Tailscale-Verbindung wird geprüft…</p>}
    {status && <p role="status"><strong>{status.listening ? status.https === 'verified' ? 'HTTPS-Verbindung bestätigt.' : 'Private Freigabe eingerichtet.' : status.enabled ? 'Verbindung noch nicht bereit.' : 'Mobiler Zugriff ist ausgeschaltet.'}</strong> {status.message}</p>}
    {error && <p className="st-error" role="alert">{error}</p>}
    {busy && <p role="status">Verbindung wird eingerichtet…</p>}
    <div className="st-mobile-actions">
      <button className="btn" type="button" disabled={busy} onClick={() => void enable(true)}>{status?.enabled ? 'Verbindung erneut aktivieren' : 'Mit Tailscale aktivieren'}</button>
      {status?.enabled && <button className="btn" type="button" disabled={busy} onClick={() => void enable(false)}>Mobilen Zugriff ausschalten</button>}
      <button className="btn" type="button" ref={pairButton} disabled={busy || !status?.listening} onClick={() => void pair()}>Tablet oder Smartphone koppeln</button>
    </div>
    {status?.listening && status.url && <label className="st-mobile-address">Adresse auf dem Mobilgerät öffnen
      <input readOnly value={status.url} onFocus={(event) => event.target.select()} aria-label="Mobile ADE-Adresse" /></label>}
    {pairing && <div className="st-mobile-pair" aria-label="Gerät koppeln">
      {!expired && <canvas ref={canvas} role="img" aria-label="Einmaligen ADE-Pairing-Code mit der Kamera des Mobilgeräts scannen" />}
      <div><p>{expired ? 'Dieser Pairing-Code ist abgelaufen. Bitte einen neuen erstellen.' : 'QR-Code mit dem Mobilgerät scannen. In der geöffneten ADE-Seite den Gerätenamen eingeben und verbinden.'}</p>
        {!expired && <><label>Pairing-Code · gültig bis {new Date(pairing.expiresAt).toLocaleTimeString()}
          <input readOnly ref={codeInput} value={pairing.code} onFocus={(event) => event.target.select()} aria-label="Einmaliger Pairing-Code" /></label>
          <label>Einmaliger Pairing-Link<input readOnly value={pairing.url} onFocus={(event) => event.target.select()} aria-label="Einmaliger Pairing-Link" /></label></>}
        <button className="btn" type="button" onClick={() => { void window.ade.invoke('mobileAccess:cancelPair'); focusAfter.current = 'pair'; setPairing(null); }}>Pairing schliessen</button>
      </div>
    </div>}
  </section>;
}
