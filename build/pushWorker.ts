/** Appended to the public-shell service worker. Keep this dependency-free so the
 * exact shipped handlers can be exercised in the worker contract test. */
export const PUSH_WORKER = String.raw`
const pushId = value => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,128}$/.test(value);
self.addEventListener('message', event => {
  if (event.data === 'ade-push-capability' && event.ports[0]) event.ports[0].postMessage({ version: 1 });
});
self.addEventListener('push', event => {
  let value;
  try { value = event.data.json(); } catch { return; }
  if (!value || value.version !== 1 || !['question','error','result','test'].includes(value.kind)
    || !['de','en'].includes(value.locale) || !/^[a-f0-9]{32}$/.test(value.tag)
    || !(value.runId === null && value.kind === 'test' || pushId(value.runId))
    || Object.keys(value).sort().join(',') !== 'kind,locale,runId,tag,version') return;
  const de = value.locale === 'de';
  const body = value.kind === 'test' ? (de ? 'Die ADE-Testnachricht ist angekommen.' : 'Your ADE test notification arrived.')
    : value.kind === 'result' ? (de ? 'In ADE liegt ein Ergebnis zur Prüfung bereit.' : 'A result is ready for review in ADE.')
    : (de ? 'ADE benötigt deine Aufmerksamkeit.' : 'ADE needs your attention.');
  // The host already bounds duplicates (30 s per kind/run, persisted). A later
  // confirmed notice replaces the tray entry with the same tag and must alert
  // again; renotify false would replace it silently.
  event.waitUntil(self.registration.showNotification('ADE', { body, tag: 'ade-' + value.tag, icon: '/icon.svg',
    renotify: true, data: { version: 1, runId: value.runId } }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const data = event.notification.data;
  if (!data || data.version !== 1 || !(data.runId === null || pushId(data.runId))) return;
  const url = new URL('/', self.location.origin);
  url.hash = data.runId === null ? 'notice=test' : 'notice=run:' + encodeURIComponent(data.runId);
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async clients => {
    const client = clients.find(client => new URL(client.url).origin === url.origin);
    if (client) { const navigated = await client.navigate(url.href); if (navigated) { await navigated.focus(); return; } }
    await self.clients.openWindow(url.href);
  }));
});
`;
