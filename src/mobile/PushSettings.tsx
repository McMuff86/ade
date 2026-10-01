import { useEffect, useRef, useState } from 'react';
import { t } from '../shared/i18n';
import { useLocale } from '../renderer/i18n/language';
import type { MobilePushCommand, MobilePushPreferences, MobilePushStatus, MobilePushSubscription } from '../shared/remote';
import type { MobileHost } from './useMobileHost';

export function PushSettings({ host }: { host: MobileHost }) {
  const locale = useLocale();
  const [state, setState] = useState<MobilePushStatus | null>(null);
  const [preferences, setPreferences] = useState<MobilePushPreferences>({ question: true, error: true, result: true });
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>(() => typeof Notification === 'undefined' ? 'unsupported' : Notification.permission);
  const epoch = useRef(0); const lock = useRef(false);
  const readRevision = useRef(0);
  const supported = window.isSecureContext && 'serviceWorker' in navigator && 'PushManager' in window && permission !== 'unsupported';
  const online = host.status === 'online';
  const refresh = async (own: number) => {
    const revision = ++readRevision.current;
    try {
      const value = await host.request<MobilePushStatus>('/api/v1/notifications');
      if (own === epoch.current && revision === readRevision.current) { setState(value); setPreferences(value.preferences); setError(''); }
    } catch { if (own === epoch.current && revision === readRevision.current) { setState(null); setError(t('Notification settings could not be loaded. Reconnect and try again.')); } }
  };
  useEffect(() => {
    const own = ++epoch.current; setState(null); setError('');
    if (online) void refresh(own);
    return () => { epoch.current++; };
  }, [host.deviceId, host.identityVersion, online]);
  const act = async (operation: MobilePushCommand['operation']) => {
    if (lock.current || !online || !state?.available) return;
    lock.current = true; setBusy(true); setError(''); const own = epoch.current;
    readRevision.current++;
    try {
      // Permission request stays in the click gesture, before any network await.
      if (operation === 'enable') {
        const granted = await Notification.requestPermission();
        if (own !== epoch.current) return;
        setPermission(granted); if (granted !== 'granted') throw new Error('permission');
      }
      const registration = await navigator.serviceWorker.getRegistration('/');
      if (!registration?.active || own !== epoch.current) throw new Error('worker');
      if (operation === 'enable') await new Promise<void>((resolve, reject) => {
        const channel = new MessageChannel();
        const timeout = setTimeout(() => { channel.port1.close(); reject(new Error('worker update required')); }, 3000);
        channel.port1.onmessage = event => { clearTimeout(timeout); channel.port1.close(); event.data?.version === 1 ? resolve() : reject(new Error('worker')); };
        registration.active!.postMessage('ade-push-capability', [channel.port2]);
      });
      if (own !== epoch.current) return;
      let command: MobilePushCommand = { operation: operation === 'test' ? 'test' : 'disable' };
      if (operation === 'enable') {
        if (!state.publicKey) throw new Error('key');
        const old = await registration.pushManager.getSubscription();
        if (own !== epoch.current) return;
        if (old) await old.unsubscribe();
        const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: state.publicKey });
        if (own !== epoch.current) { await subscription.unsubscribe(); return; }
        const value = subscription.toJSON();
        if (!value.endpoint || !value.keys?.p256dh || !value.keys.auth) throw new Error('subscription');
        const wire: MobilePushSubscription = { endpoint: value.endpoint, keys: { p256dh: value.keys.p256dh, auth: value.keys.auth } };
        command = { operation: 'enable', subscription: wire, preferences, locale: locale === 'de' ? 'de' : 'en' };
      }
      const value = await host.request<MobilePushStatus>('/api/v1/notifications/command', 'POST', command, crypto.randomUUID());
      if (own !== epoch.current) return;
      setState(value);
      if (operation === 'disable') await (await registration.pushManager.getSubscription())?.unsubscribe();
    } catch { if (own === epoch.current) setError(t('Notification change was not confirmed. Reload its status before trying again; work is unchanged.')); }
    finally { lock.current = false; setBusy(false); }
  };
  return <section className="m-settings-section" aria-label={t('Mobile notifications')}>
    <h3>{t('Mobile notifications')}</h3>
    <p>{t('Receive neutral notices for confirmed questions, errors and completed managed work. Prompts, code and project names stay out of notifications.')}</p>
    <p>{t('Android Chrome: allow notifications here and in Android settings. Add ADE to your home screen for easy access. The PC and ADE must keep running; both devices need internet. Tailscale is required to open details.')}</p>
    <p className="m-field-note">{t('Delivery uses the browser push provider (Google for Chrome). ADE stores the subscription encrypted on this PC. Terminal silence or a normal CLI exit does not trigger a completion notice.')}</p>
    {!supported && <p role="status">{t('This browser does not provide Web Push. Use current Android Chrome over HTTPS.')}</p>}
    {permission === 'denied' && <p role="status">{t('Notifications are blocked. Allow them in the browser site settings, then reload ADE.')}</p>}
    {!online && <p role="status">{t('PC offline. Reconnect to change notification settings; nothing is queued.')}</p>}
    {online && !state && !error && <p role="status">{t('Loading notification settings…')}</p>}
    {state && !state.available && <p role="status">{t('Secure notification storage is unavailable on the PC.')}</p>}
    {state && <p role="status">{state.enabled ? t('Notifications enabled for this paired device.') : t('Notifications disabled for this paired device.')}</p>}
    <fieldset disabled={busy || !online || !state?.available || !supported}><legend>{t('Notify me about')}</legend>
      {(['question', 'error', 'result'] as const).map(kind => <label key={kind} className="m-push-choice"><input type="checkbox" checked={preferences[kind]} onChange={event => setPreferences({ ...preferences, [kind]: event.target.checked })} />
        {kind === 'question' ? t('Questions requiring my answer') : kind === 'error' ? t('Reported work errors') : t('Completed managed results')}</label>)}
    </fieldset>
    <div className="m-actions">
      <button disabled={busy || !online || !state?.available || !supported || permission === 'denied' || !Object.values(preferences).some(Boolean)} onClick={() => void act('enable')}>{state?.enabled ? t('Save notification selection') : t('Enable notifications on this device')}</button>
      {state?.enabled && <><button disabled={busy || !online} onClick={() => void act('test')}>{t('Send test notification')}</button>
        <button disabled={busy || !online} onClick={() => void act('disable')}>{t('Disable notifications')}</button></>}
      <button disabled={busy || !online} onClick={() => void refresh(epoch.current)}>{t('Reload notification status')}</button>
    </div>
    {busy && <p role="status">{t('Checking notification settings…')}</p>}
    {state?.last && <p role="status">{state.last.outcome === 'accepted' ? t('The push provider accepted the last notice. Confirm arrival on your tablet; acceptance alone does not prove delivery.') : t('The last notification could not be confirmed. Check permissions and send a new test.')}</p>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
