import { useEffect, useRef, useState } from 'react';
import { t } from '../shared/i18n';
import { useLocale } from '../renderer/i18n/language';
import type { MobilePushCommand, MobilePushPreferences, MobilePushStatus, MobilePushSubscription } from '../shared/remote';
import type { MobileHost } from './useMobileHost';
import { MobileClientError } from './client';

export function PushSettings({ host }: { host: MobileHost }) {
  const locale = useLocale();
  const [state, setState] = useState<MobilePushStatus | null>(null);
  const [preferences, setPreferences] = useState<MobilePushPreferences>({ question: true, error: true, result: true });
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [checking, setChecking] = useState(false); const [notice, setNotice] = useState('');
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>(() => typeof Notification === 'undefined' ? 'unsupported' : Notification.permission);
  // Local monotonic deadline derived from the host's relative cooldown.
  const [cooldownUntil, setCooldownUntil] = useState(0); const [, setTick] = useState(0);
  const epoch = useRef(0); const lock = useRef(false);
  const readRevision = useRef(0);
  const supported = window.isSecureContext && 'serviceWorker' in navigator && 'PushManager' in window && permission !== 'unsupported';
  const online = host.status === 'online';
  const apply = (value: MobilePushStatus) => {
    setState(value); setCooldownUntil(value.testRetryAfterMs > 0 ? performance.now() + value.testRetryAfterMs : 0);
  };
  const waitSeconds = cooldownUntil ? Math.max(1, Math.ceil((cooldownUntil - performance.now()) / 1000)) : 0;
  useEffect(() => {
    if (!cooldownUntil) return;
    const timer = setInterval(() => {
      if (performance.now() < cooldownUntil) { setTick(value => value + 1); return; }
      setCooldownUntil(0); setNotice(t('You can send another test now.'));
    }, 250);
    return () => clearInterval(timer);
  }, [cooldownUntil]);
  const refresh = async (own: number, explicit = false) => {
    if (lock.current) return;
    setChecking(true); setNotice(''); setLoadError('');
    setPermission(typeof Notification === 'undefined' ? 'unsupported' : Notification.permission);
    const revision = ++readRevision.current;
    try {
      const value = await host.request<MobilePushStatus>('/api/v1/notifications');
      if (own === epoch.current && revision === readRevision.current) {
        apply(value); setPreferences(value.preferences);
        if (explicit) setNotice(value.enabled ? t('Notification status checked: enabled. You can send a test.') : t('Notification status checked: not yet enabled. Use Enable notifications to try registration again.'));
      }
    } catch { if (own === epoch.current && revision === readRevision.current) { setState(null); setLoadError(t('Notification settings could not be loaded. Reconnect and try again.')); } }
    finally { if (own === epoch.current && revision === readRevision.current) setChecking(false); }
  };
  useEffect(() => {
    const own = ++epoch.current; setState(null); setCooldownUntil(0); setError(''); setLoadError(''); setNotice(''); setChecking(false);
    if (online) void refresh(own);
    return () => { epoch.current++; };
  }, [host.deviceId, host.identityVersion, online]);
  const act = async (operation: MobilePushCommand['operation']) => {
    if (lock.current || !online || !state?.available) return;
    lock.current = true; setBusy(true); setChecking(false); setError(''); setNotice(''); const own = epoch.current;
    let stage: 'permission' | 'worker' | 'subscription' | 'host' = operation === 'enable' ? 'permission' : 'host';
    readRevision.current++;
    try {
      // Permission request stays in the click gesture, before any network await.
      if (operation === 'enable') {
        const granted = await Notification.requestPermission();
        if (own !== epoch.current) return;
        setPermission(granted); if (granted !== 'granted') throw new Error('permission');
      }
      let registration: ServiceWorkerRegistration | undefined;
      if (operation === 'enable') {
        stage = 'worker';
        registration = await navigator.serviceWorker.getRegistration('/');
        if (!registration?.active || own !== epoch.current) throw new Error('worker');
        await new Promise<void>((resolve, reject) => {
          const channel = new MessageChannel();
          const timeout = setTimeout(() => { channel.port1.close(); reject(new Error('worker update required')); }, 3000);
          channel.port1.onmessage = event => { clearTimeout(timeout); channel.port1.close(); event.data?.version === 1 ? resolve() : reject(new Error('worker')); };
          registration!.active!.postMessage('ade-push-capability', [channel.port2]);
        });
      }
      if (own !== epoch.current) return;
      let command: MobilePushCommand = { operation: operation === 'test' ? 'test' : 'disable' };
      if (operation === 'enable') {
        stage = 'subscription';
        if (!state.publicKey) throw new Error('key');
        const old = await registration!.pushManager.getSubscription();
        if (own !== epoch.current) return;
        if (old) await old.unsubscribe();
        const subscription = await registration!.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: state.publicKey });
        if (own !== epoch.current) { await subscription.unsubscribe(); return; }
        const value = subscription.toJSON();
        if (!value.endpoint || !value.keys?.p256dh || !value.keys.auth) throw new Error('subscription');
        const wire: MobilePushSubscription = { endpoint: value.endpoint, keys: { p256dh: value.keys.p256dh, auth: value.keys.auth } };
        command = { operation: 'enable', subscription: wire, preferences, locale: locale === 'de' ? 'de' : 'en' };
      }
      stage = 'host';
      const value = await host.request<MobilePushStatus>('/api/v1/notifications/command', 'POST', command, crypto.randomUUID());
      if (own !== epoch.current) return;
      apply(value);
      if (operation === 'disable' && 'serviceWorker' in navigator) {
        // Host revocation is authoritative; browser cleanup must not turn it
        // into a reported failure or require a functioning worker beforehand.
        try { await (await (await navigator.serviceWorker.getRegistration('/'))?.pushManager.getSubscription())?.unsubscribe(); } catch { /* already disabled on host */ }
      }
    } catch (reason) {
      if (operation === 'test' && own === epoch.current && reason instanceof MobileClientError && reason.code === 'command_rejected') {
        // The host refuses a test during its cooldown or while one is in flight.
        // Re-read the authoritative wait instead of reporting a generic failure.
        try {
          const value = await host.request<MobilePushStatus>('/api/v1/notifications');
          if (own === epoch.current && value.enabled && value.testRetryAfterMs > 0) {
            apply(value); setNotice(t('A test was just sent. Wait {{count}} s before sending another; the last result is shown below.', { count: Math.ceil(value.testRetryAfterMs / 1000) }));
            return;
          }
        } catch { /* fall through to the generic, unchanged-work message */ }
      }
      if (own === epoch.current) {
        if (stage === 'permission') setError(t('Notification permission was not granted. Allow notifications in the browser site settings, then try enabling them again.'));
        else if (stage === 'worker') setError(t('The ADE background component is not ready for notifications. Close every ADE tab and the installed ADE app, reopen ADE, then enable notifications again. Reloading the status does not update this component.'));
        else if (stage === 'subscription') setError(t('The browser could not register with its push service. Check the tablet internet connection and browser notification permissions, then try enabling notifications again.'));
        else if (reason instanceof MobileClientError && reason.code === 'invalid_payload') setError(t('ADE could not accept this browser push subscription. Use Google Chrome on Android and try enabling notifications again.'));
        else setError(t('Notification change was not confirmed. Reload its status before trying again; work is unchanged.'));
      }
    }
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
    {online && !state && !loadError && !checking && <p role="status">{t('Loading notification settings…')}</p>}
    {state && !state.available && <p role="status">{t('Secure notification storage is unavailable on the PC.')}</p>}
    {state && <p role="status">{state.enabled ? t('Notifications enabled for this paired device.') : t('Notifications disabled for this paired device.')}</p>}
    <fieldset disabled={busy || !online || !state?.available || !supported}><legend>{t('Notify me about')}</legend>
      {(['question', 'error', 'result'] as const).map(kind => <label key={kind} className="m-push-choice"><input type="checkbox" checked={preferences[kind]} onChange={event => setPreferences({ ...preferences, [kind]: event.target.checked })} />
        {kind === 'question' ? t('Questions requiring my answer') : kind === 'error' ? t('Reported work errors') : t('Completed managed results')}</label>)}
    </fieldset>
    <div className="m-actions">
      <button disabled={busy || !online || !state?.available || !supported || permission === 'denied' || !Object.values(preferences).some(Boolean)} onClick={() => void act('enable')}>{state?.enabled ? t('Save notification selection') : t('Enable notifications on this device')}</button>
      <button disabled={busy || !online || !state?.enabled || waitSeconds > 0} aria-describedby={!state?.enabled ? 'push-test-help' : waitSeconds > 0 ? 'push-test-wait' : undefined} onClick={() => void act('test')}>{t('Send test notification')}</button>
      {state?.enabled && <button disabled={busy || !online} onClick={() => void act('disable')}>{t('Disable notifications')}</button>}
      <button disabled={busy || checking || !online} onClick={() => void refresh(epoch.current, true)}>{t('Reload notification status')}</button>
    </div>
    {state?.enabled && waitSeconds > 0 && <p id="push-test-wait" className="m-field-note">{t('Next test possible in {{count}} s. A short wait prevents repeated notifications.', { count: waitSeconds })}</p>}
    {!state?.enabled && <p id="push-test-help" className="m-field-note">{t('A test becomes available after ADE confirms registration for this device. Browser permission alone does not enable delivery.')}</p>}
    {notice && <p role="status">{notice}</p>}
    {(busy || checking) && <p role="status">{t('Checking notification settings…')}</p>}
    {state?.last && <p role="status">{state.last.outcome === 'accepted' ? t('The push provider accepted the last notice. Confirm arrival on your tablet; acceptance alone does not prove delivery.') : t('The last notification could not be confirmed. Check permissions and send a new test.')}</p>}
    {(loadError || error) && <p role="alert">{loadError || error}</p>}
  </section>;
}
