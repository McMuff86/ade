import { localizeAppMessage } from '../../shared/i18n/appMessages';
import { intlLocale } from '../../shared/i18n';
import { t as translate } from "../../shared/i18n";
import { useLocale } from "../i18n/language";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type JSX } from 'react';
import type { MobileAccessStatus, MobilePairingChallenge } from '../../shared/mobileAccess';

export function MobileAccessSection(): JSX.Element {
  useLocale();
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
    try { setStatus(await window.ade.invoke('mobileAccess:status')); setError(''); }
    catch { setError(translate("Connection status could not be loaded. Check again.")); }
  }, []);
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => { void refresh(); }, 20_000);
    return () => { clearInterval(timer); void window.ade.invoke('mobileAccess:cancelPair').catch(() => undefined); };
  }, [refresh]);
  useEffect(() => {
    if (!pairing) return;
    let live = true;
    void import('qrcode').then(QRCode => {
      if (live && canvas.current) return QRCode.toCanvas(canvas.current, pairing.url, { width: 224, margin: 4, errorCorrectionLevel: 'M' });
    }).catch(() => { if (live) setError(translate("QR code could not be displayed. Use the pairing code.")); });
    codeInput.current?.focus();
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => { live = false; clearInterval(timer); };
  }, [pairing]);

  const enable = async (enabled: boolean): Promise<void> => {
    if (actionBusy.current) return;
    actionBusy.current = true; setBusy(true); setError(''); setPairing(null);
    try { setStatus(await window.ade.invoke('mobileAccess:setEnabled', { enabled })); }
    catch { setError(translate("Connection could not be changed. Check status again.")); }
    finally { actionBusy.current = false; focusAfter.current = 'refresh'; setBusy(false); }
  };
  const pair = async (): Promise<void> => {
    if (actionBusy.current) return;
    actionBusy.current = true; setBusy(true); setError('');
    try { setPairing(await window.ade.invoke('mobileAccess:pair')); setNow(Date.now()); }
    catch { await refresh(); setPairing(null); setError(translate("Pairing could not be started. Check connection status above.")); }
    finally { actionBusy.current = false; setBusy(false); }
  };
  const expired = pairing !== null && pairing.expiresAt <= now;
  return <section className="st-mobile" aria-labelledby="mobile-access-title" data-testid="mobile-access">
    <div className="st-device-heading"><h3 id="mobile-access-title">{translate("Mobile access")}</h3>
      <button type="button" className="btn" ref={refreshButton} disabled={busy} onClick={() => void refresh()}>{translate("Check connection")}</button></div>
    <p className="st-device-hint">{translate("Use ADE on tablet and smartphone; connect Tailscale on PC and mobile device to the same account; the PC must remain on and logged in; with active mobile access, ADE will continue to run after closing the window in the info area, where ADE can be reopened or completely terminated; use the same address at home and on the go; use Tailscale on both devices; connect already paired devices in the same browser; a new code is required only for a new pairing.")}</p>
    {!status && <p role="status">{translate("Checking Tailscale connection…")}</p>}
    {status && <p role="status"><strong>{status.listening ? status.https === 'verified' ? translate("HTTPS connection confirmed.") : translate("Private access configured.") : status.enabled ? translate("Connection not yet ready.") : translate("Mobile access is turned off.")}</strong> {localizeAppMessage(status.message)}</p>}
    {error && <p className="st-error" role="alert">{localizeAppMessage(error)}</p>}
    {busy && <p role="status">{translate("Setting up connection…")}</p>}
    <div className="st-mobile-actions">
      <button className="btn" type="button" disabled={busy} onClick={() => void enable(true)}>{status?.enabled ? translate("Activate the connection again") : translate("Activate with Tailscale")}</button>
      {status?.enabled && <button className="btn" type="button" disabled={busy} onClick={() => void enable(false)}>{translate("Turn off mobile access")}</button>}
      <button className="btn" type="button" ref={pairButton} disabled={busy || !status?.listening} onClick={() => void pair()}>{translate("Pair tablet or smartphone")}</button>
    </div>
    {status?.listening && status.url && <label className="st-mobile-address">{translate("Open address on mobile device")}<input readOnly value={status.url} onFocus={(event) => event.target.select()} aria-label={translate("Mobile ADE address")} /></label>}
    {pairing && <div className="st-mobile-pair" aria-label={translate("Pair device")}>
      {!expired && <canvas ref={canvas} role="img" aria-label={translate("Scan the one-time ADE pairing code with your mobile device's camera")} />}
      <div><p>{expired ? translate("This pairing code has expired. Please create a new one.") : translate("Scan the QR code with the mobile device. Enter and connect the device name in the open ADE page.")}</p>
        {!expired && <><label>{translate("Pairing code · valid until")}{" "}{new Date(pairing.expiresAt).toLocaleTimeString(intlLocale())}
          <input readOnly ref={codeInput} value={pairing.code} onFocus={(event) => event.target.select()} aria-label={translate("One-time pairing code")} /></label>
          <label>{translate("One-time pairing link")}<input readOnly value={pairing.url} onFocus={(event) => event.target.select()} aria-label={translate("One-time pairing link")} /></label></>}
        <button className="btn" type="button" onClick={() => { void window.ade.invoke('mobileAccess:cancelPair'); focusAfter.current = 'pair'; setPairing(null); }}>{translate("Close pairing")}</button>
      </div>
    </div>}
  </section>;
}
