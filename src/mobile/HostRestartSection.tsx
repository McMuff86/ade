import { localizeAppMessage } from '../shared/i18n/appMessages';
import { t as translate } from "../shared/i18n";
import { useLocale } from "../renderer/i18n/language";
import { useEffect, useRef, useState, type JSX } from 'react';
import type { MobileHostState, MobileRestartResult } from '../shared/remote';
import type { MobileHost } from './useMobileHost';
import { MobileClientError } from './client';
import { Dialog } from './ui';
import { HostBuildStatus, MobileSetupStatus } from './SetupStatus';

export function HostRestartSection({ host, onNavigate }: { host: MobileHost; onNavigate: (target: 'projects' | 'graph') => void }): JSX.Element {
  useLocale();
  const [state, setState] = useState<MobileHostState | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [pending, setPending] = useState<{ instanceId: string; key: string; at: number } | null>(null);
  const mounted = useRef(true);
  const sending = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    let disposed = false; let querying = false;
    setConfirmed(false);
    const refresh = async () => {
      if (querying || host.status !== 'online') return; querying = true;
      try {
        const next = await host.request<MobileHostState>('/api/v1/host');
        if (disposed) return;
        setState(next); setConfirmed(true);
        if (!pending || Date.now() - pending.at <= 60_000) setError('');
        if (pending && next.instanceId !== pending.instanceId) {
          setPending(null); setNotice(translate("ADE has been restarted and is reachable again.")); setError('');
        } else if (pending && Date.now() - pending.at > 60_000) {
          setError(translate("The restart is not yet confirmed. Check host state; no further restart is triggered automatically."));
        }
      } catch (reason) {
        if (disposed) return;
        setConfirmed(false);
        if (!pending) setError(reason instanceof MobileClientError && reason.status === 404
          ? translate("This host does not yet offer the remote restart. update ADE on the PC and restart normally once.")
          : translate("Host state could not be loaded. connection is checked again."));
      } finally { querying = false; }
    };
    void refresh(); const timer = setInterval(() => void refresh(), 3000);
    return () => { disposed = true; clearInterval(timer); };
  }, [host.request, host.status, host.identityVersion, pending, refreshVersion]);

  const restart = async () => {
    if (sending.current || !state) return;
    const command = pending ?? { instanceId: state.instanceId, key: crypto.randomUUID(), at: Date.now() };
    sending.current = true; setBusy(true); setPending(command); setConfirm(false); setError('');
    try {
      await host.request<MobileRestartResult>('/api/v1/host/restart', 'POST', { instanceId: command.instanceId }, command.key);
      if (mounted.current) setNotice(translate("ADE has accepted the restart. Reconnection is being checked…"));
    } catch (reason) {
      if (!mounted.current) return;
      if (reason instanceof MobileClientError && [400, 403, 404, 409, 422].includes(reason.status)) {
        setPending(null); setError(reason.code === 'scope_not_granted'
          ? translate("This device must not restart ADE. Release administrative right on the PC.") : reason.message);
      } else setError(translate("Answer not confirmed: the same question can be re-examined."));
    } finally { sending.current = false; if (mounted.current) setBusy(false); }
  };
  return <section className="m-settings-section" aria-labelledby="host-restart-title"><h3 id="host-restart-title">{translate("ADE on PC")}</h3>
    <button disabled={host.status !== 'online' || busy} onClick={() => { setRefreshVersion((current) => current + 1); void host.refresh().catch(() => undefined); }}>{translate("Refresh setup status")}</button>
    <HostBuildStatus state={state} online={host.status === 'online' && confirmed} />
    <MobileSetupStatus host={host} state={confirmed ? state : null} onNavigate={onNavigate} />
    {!state && !error && host.status === 'online' && <p role="status">{translate("Loading host status…")}</p>}
    {state && <><p>{host.status !== 'online' || !confirmed ? translate("PC status not yet confirmed") : state.restart === 'pending' ? translate("Restart prepared") : translate("Reachable")}</p>
      {!state.canRestart && <p>{translate("To allow restarting, enable this device's permission under Settings → Connected devices on the PC.")}</p>}
      {state.blockers.length > 0 && <ul>{state.blockers.map((item) => <li key={item}>{localizeAppMessage(item)}</li>)}</ul>}
      <button onClick={(event) => { event.currentTarget.focus(); setConfirm(true); }} disabled={!confirmed || !state.canRestart || state.blockers.length > 0
        || state.restart === 'pending' || !!pending || busy || host.busy || !!host.pending || host.status !== 'online'}>{translate("Restart ADE")}</button></>}
    {notice && <p role="status">{localizeAppMessage(notice)}</p>}{error && <p role="alert">{localizeAppMessage(error)}</p>}
    {pending && <button disabled={busy || host.status !== 'online'} onClick={() => void restart()}>{translate("Check restart request again")}</button>}
    {confirm && <Dialog title={translate("Restart ADE on the PC?")} onClose={() => setConfirm(false)} fallbackId="mobile-title">
      <p>{translate("The connection is briefly interrupted. ADE starts with the same profile; the device coupling is maintained.")}</p>
      <p>{translate("Ongoing processes and host actions are checked again before the restart.")}</p>
      <button onClick={() => setConfirm(false)}>{translate("Cancel")}</button><button className="m-primary" onClick={() => void restart()}>{translate("Confirm restart")}</button>
    </Dialog>}
  </section>;
}
