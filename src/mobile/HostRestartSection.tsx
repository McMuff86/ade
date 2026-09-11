import { useEffect, useRef, useState, type JSX } from 'react';
import type { MobileHostState, MobileRestartResult } from '../shared/remote';
import type { MobileHost } from './useMobileHost';
import { MobileClientError } from './client';
import { Dialog } from './ui';
import { HostBuildStatus, MobileSetupStatus } from './SetupStatus';

export function HostRestartSection({ host, onNavigate }: { host: MobileHost; onNavigate: (target: 'projects' | 'graph') => void }): JSX.Element {
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
          setPending(null); setNotice('ADE wurde neu gestartet und ist wieder erreichbar.'); setError('');
        } else if (pending && Date.now() - pending.at > 60_000) {
          setError('Der Neustart ist noch nicht bestätigt. Host-Zustand prüfen; es wird kein weiterer Neustart automatisch ausgelöst.');
        }
      } catch (reason) {
        if (disposed) return;
        setConfirmed(false);
        if (!pending) setError(reason instanceof MobileClientError && reason.status === 404
          ? 'Dieser Host bietet den Fernneustart noch nicht an. ADE am PC aktualisieren und einmal normal neu starten.'
          : 'Host-Zustand konnte nicht geladen werden. Verbindung wird erneut geprüft.');
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
      if (mounted.current) setNotice('ADE hat den Neustart angenommen. Wiederverbindung wird geprüft…');
    } catch (reason) {
      if (!mounted.current) return;
      if (reason instanceof MobileClientError && [400, 403, 404, 409, 422].includes(reason.status)) {
        setPending(null); setError(reason.code === 'scope_not_granted'
          ? 'Dieses Gerät darf ADE nicht neu starten. Verwaltungsrecht am PC freigeben.' : reason.message);
      } else setError('Antwort nicht bestätigt. Dieselbe Anfrage kann erneut geprüft werden.');
    } finally { sending.current = false; if (mounted.current) setBusy(false); }
  };
  return <section className="m-settings-section" aria-labelledby="host-restart-title"><h3 id="host-restart-title">ADE auf dem PC</h3>
    <button disabled={host.status !== 'online' || busy} onClick={() => { setRefreshVersion((current) => current + 1); void host.refresh().catch(() => undefined); }}>Einrichtungsstatus aktualisieren</button>
    <HostBuildStatus state={state} online={host.status === 'online' && confirmed} />
    <MobileSetupStatus host={host} state={confirmed ? state : null} onNavigate={onNavigate} />
    {!state && !error && host.status === 'online' && <p role="status">Host-Zustand wird geladen…</p>}
    {state && <><p>{host.status !== 'online' || !confirmed ? 'PC nicht aktuell bestätigt' : state.restart === 'pending' ? 'Neustart vorbereitet' : 'Erreichbar'}</p>
      {!state.canRestart && <p>Zum Neustarten dieses Gerät am PC unter Settings → Verbundene Geräte freigeben.</p>}
      {state.blockers.length > 0 && <ul>{state.blockers.map((item) => <li key={item}>{item}</li>)}</ul>}
      <button onClick={(event) => { event.currentTarget.focus(); setConfirm(true); }} disabled={!confirmed || !state.canRestart || state.blockers.length > 0
        || state.restart === 'pending' || !!pending || busy || host.busy || !!host.pending || host.status !== 'online'}>ADE neu starten</button></>}
    {notice && <p role="status">{notice}</p>}{error && <p role="alert">{error}</p>}
    {pending && <button disabled={busy || host.status !== 'online'} onClick={() => void restart()}>Neustart-Anfrage erneut prüfen</button>}
    {confirm && <Dialog title="ADE auf dem PC neu starten?" onClose={() => setConfirm(false)} fallbackId="mobile-title">
      <p>Die Verbindung wird kurz unterbrochen. ADE startet mit demselben Profil; die Gerätekopplung bleibt erhalten.</p>
      <p>Laufende Prozesse und Host-Aktionen werden vor dem Neustart erneut geprüft.</p>
      <button onClick={() => setConfirm(false)}>Abbrechen</button><button className="m-primary" onClick={() => void restart()}>Neustart bestätigen</button>
    </Dialog>}
  </section>;
}
