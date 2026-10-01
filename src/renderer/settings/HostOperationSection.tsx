import { useCallback, useEffect, useRef, useState } from 'react';
import { t } from '../../shared/i18n';
import { useLocale } from '../i18n/language';
import type { HostOperationChange, HostOperationStatus } from '../../shared/hostOperation';

export function HostOperationSection() {
  useLocale();
  const [status, setStatus] = useState<HostOperationStatus | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = useRef(false); const mounted = useRef(true);
  const refresh = useCallback(async () => {
    if (pending.current) return;
    try {
      const next = await window.ade.invoke('hostOperation:get');
      if (mounted.current && !pending.current) { setStatus(next); setError(''); }
    } catch { if (mounted.current) setError(t('Operating settings could not be read.')); }
  }, []);
  useEffect(() => {
    mounted.current = true; void refresh();
    const timer = window.setInterval(() => { if (!document.hidden) void refresh(); }, 2000);
    return () => { mounted.current = false; clearInterval(timer); };
  }, [refresh]);
  const change = async (setting: HostOperationChange['setting'], enabled: boolean) => {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError('');
    try { const next = await window.ade.invoke('hostOperation:change', { setting, enabled }); if (mounted.current) setStatus(next); }
    catch { if (mounted.current) setError(t('The setting could not be applied. Refresh to check the current state.')); }
    finally { pending.current = false; if (mounted.current) setBusy(false); }
  };
  return <div className="st-body st-host-operation" data-testid="host-operation">
    <p>{t('ADE runs after desktop login. Quitting ADE or shutting down the computer ends mobile access. Interrupted work is never restarted automatically.')}</p>
    {!status && !error && <p role="status">{t('Loading operating settings…')}</p>}
    {error && <p role="alert">{error}</p>}
    {status && <>
      <label className="st-scope-all"><input type="checkbox" checked={status.autostart} disabled={busy || !status.autostartSupported}
        onChange={event => void change('autostart', event.target.checked)} />{t('Open ADE at desktop login')}</label>
      {!status.autostartSupported && <p>{t('Login autostart is unavailable in this deployment.')}</p>}
      {status.autostartError && <p role="alert">{t('Autostart could not be read. Check the local desktop configuration.')}</p>}
      <label className="st-scope-all"><input type="checkbox" checked={status.keepInTray} disabled={busy}
        onChange={event => void change('keepInTray', event.target.checked)} />{t('Keep ADE in the tray when closing the window')}</label>
      <p>{t('Mobile access already keeps ADE in the tray. Open ADE again from the tray or by launching it normally.')}</p>
      <label className="st-scope-all"><input type="checkbox" checked={status.keepAwake} disabled={busy}
        onChange={event => void change('keepAwake', event.target.checked)} />{t('Request sleep prevention during open sessions and active work')}</label>
      <p>{t('The screen may turn off or lock. An open terminal counts until it ends, including while waiting for input. System policy or manual sleep can still suspend this computer.')}</p>
      <p role="status" data-testid="sleep-prevention">{status.sleepPrevention === 'requested' ? t('Sleep prevention requested for active work.')
        : status.sleepPrevention === 'idle' ? t('No active work; sleep prevention released.')
          : status.sleepPrevention === 'error' ? t('Sleep prevention failed. This computer may sleep.') : t('Sleep prevention is off.')}</p>
    </>}
    <button type="button" disabled={busy} onClick={() => void refresh()}>{t('Refresh operating status')}</button>
  </div>;
}
