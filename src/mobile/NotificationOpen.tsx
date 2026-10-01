import { useEffect, useRef, useState } from 'react';
import { t } from '../shared/i18n';
import type { MobileRunSummary } from '../shared/remote';
import type { MobileHost } from './useMobileHost';

/** A notification is a navigation hint, never authority or an offline command. */
export function NotificationOpen({ host, onRun }: { host: MobileHost; onRun(id: string): void }) {
  const [target, setTarget] = useState<string | null>(null); const [message, setMessage] = useState('');
  const callback = useRef(onRun); callback.current = onRun;
  useEffect(() => {
    const consume = () => {
      if (!location.hash.startsWith('#notice=')) return;
      const hash = location.hash; history.replaceState(null, '', location.pathname + location.search);
      if (hash === '#notice=test') { setMessage(t('Test notification opened. Your device still needs current ADE access to open work.')); return; }
      let decoded: string; try { decoded = decodeURIComponent(hash); } catch { return; }
      const match = /^#notice=run:([A-Za-z0-9_.:-]{1,128})$/.exec(decoded);
      if (match) { setTarget(match[1]); setMessage(t('Reconnect to check the notification target. No work will be started.')); }
    };
    consume(); window.addEventListener('hashchange', consume); return () => window.removeEventListener('hashchange', consume);
  }, []);
  useEffect(() => {
    if (!target || !host.paired || host.status !== 'online') return;
    let current = true;
    void host.request<MobileRunSummary[]>('/api/v1/runs').then(runs => {
      if (!current) return;
      const run = runs.find(run => run.id === target);
      if (!run) throw new Error('unavailable');
      host.acceptRun(run); setTarget(null); setMessage(''); callback.current(run.id);
    }).catch(() => { if (current) { setTarget(null); setMessage(t('This notification target is unavailable or no longer permitted. Check the current work overview.')); } });
    return () => { current = false; };
  }, [target, host.paired, host.status, host.deviceId, host.identityVersion]);
  return message ? <p role="status" className="m-notice">{message}</p> : null;
}
