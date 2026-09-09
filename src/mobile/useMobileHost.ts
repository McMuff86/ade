import { useCallback, useEffect, useRef, useState } from 'react';
import type { MobileCatalog, MobileCommandResult, MobileHealth, MobileRunSummary, MobileSnapshot } from '../shared/remote';
import { MobileClient, MobileClientError } from './client';
import { clearDeviceDrafts, useDeviceDraft } from './deviceDrafts';

const client = new MobileClient();
export interface PendingCommand { path: string; payload?: unknown; key: string }
const messages: Record<string, string> = {
  pairing_expired: 'Dieser Code ist abgelaufen oder wurde bereits verwendet. In ADE am PC einen neuen Code erstellen.',
  unknown_device: 'Der Gerätezugriff wurde widerrufen oder ist nicht mehr verfügbar. Am PC erneut koppeln.',
  storage_unavailable: 'Der Browser kann den Geräteschlüssel nicht speichern. Privaten Modus verlassen und Gerätespeicher erlauben.',
  rate_limited: 'Zu viele Verbindungsversuche. Bitte eine Minute warten.',
  stale_timestamp: 'Die Gerätezeit weicht ab. Automatische Uhrzeit auf diesem Gerät aktivieren.',
  command_rejected: 'ADE hat den Auftrag abgewiesen. Agent, Repository und Run-Status am PC prüfen.',
  invalid_payload: 'Bitte Eingaben prüfen. ADE konnte diesen Auftrag nicht annehmen.',
};
function errorText(error: unknown): string {
  return error instanceof MobileClientError ? messages[error.code] ?? 'Die Verbindung konnte nicht bestätigt werden. Erneut verbinden.'
    : 'ADE ist gerade nicht erreichbar. Tailscale, Netzwerk und den eingeschalteten PC prüfen.';
}

/** One connection for all views. Changing navigation, theme or selection never restarts it. */
export function useMobileHost() {
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [paired, setPaired] = useState<boolean | null>(null);
  const [status, setStatus] = useState<'connecting' | 'online' | 'offline'>('connecting');
  const [catalog, setCatalog] = useState<MobileCatalog | null>(null);
  const [health, setHealth] = useState<MobileHealth | null>(null);
  const [runs, setRuns] = useState<MobileRunSummary[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [generation, setGeneration] = useState(0);
  const [identityVersion, setIdentityVersion] = useState(0);
  const [lastSeen, setLastSeen] = useState<number | null>(null);
  const [pending, setPending] = useDeviceDraft<PendingCommand | null>(deviceId, 'pending-task', null);
  const busyRef = useRef(false);
  const cursor = useRef<number | null>(null);
  const mounted = useRef(true);
  const epoch = useRef(0);

  const clearIdentity = useCallback(() => {
    if (client.deviceId) clearDeviceDrafts(client.deviceId);
    setDeviceId(null);
    epoch.current++; setIdentityVersion(epoch.current); cursor.current = null;
    setPending(null); setPaired(false); setRuns([]); setCatalog(null); setHealth(null); setLastSeen(null); setNotice('');
  }, []);
  const lostAccess = useCallback(async (reason: unknown): Promise<boolean> => {
    if (!(reason instanceof MobileClientError) || reason.code !== 'unknown_device') return false;
    clearIdentity(); setError(errorText(reason));
    await client.forget().catch(() => undefined); return true;
  }, [clearIdentity]);

  useEffect(() => {
    mounted.current = true;
    void client.restore().then((value) => { if (mounted.current) { setDeviceId(client.deviceId); setPaired(value); } })
      .catch((reason) => { setPaired(false); setError(errorText(reason)); });
    if ('serviceWorker' in navigator) void navigator.serviceWorker.register('/sw.js').catch(() => {
      setNotice('Offline-Appstart ist in diesem Browser nicht verfügbar. Online-Zugriff bleibt möglich.');
    });
    return () => { mounted.current = false; };
  }, []);

  const refresh = useCallback(async () => {
    const ownEpoch = epoch.current;
    const [nextHealth, nextCatalog, nextRuns] = await Promise.all([
      client.request<MobileHealth>('/api/v1/health'), client.request<MobileCatalog>('/api/v1/catalog'),
      client.request<MobileRunSummary[]>('/api/v1/runs'),
    ]);
    if (!mounted.current || ownEpoch !== epoch.current) return;
    setHealth(nextHealth); setCatalog(nextCatalog); setRuns(nextRuns); setLastSeen(Date.now());
  }, []);

  useEffect(() => {
    if (!paired) return;
    let disposed = false; let attempt = 0; let refreshing = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | null = null;
    const update = () => {
      if (refreshTimer || refreshing) return;
      refreshTimer = setTimeout(() => {
        refreshTimer = undefined; refreshing = true;
        void refresh().catch((reason) => { if (!disposed) { setStatus('offline'); void lostAccess(reason); } })
          .finally(() => { refreshing = false; });
      }, 150);
    };
    const connect = async (): Promise<void> => {
      if (disposed || document.hidden) return;
      controller?.abort(); controller = new AbortController();
      const ownController = controller; setStatus('connecting');
      try {
        await refresh();
        if (disposed || ownController.signal.aborted) return;
        setStatus('online'); attempt = 0;
        await client.stream(cursor.current, ownController.signal, (event, id, data) => {
          if (disposed || ownController.signal.aborted) return;
          cursor.current = id; setStatus('online'); setLastSeen(Date.now());
          if (event === 'snapshot') setRuns((data as MobileSnapshot).runs); else update();
        });
      } catch (reason) {
        if (disposed || ownController.signal.aborted) return;
        if (await lostAccess(reason)) return;
        if (reason instanceof MobileClientError && reason.code === 'stale_timestamp') setError(errorText(reason));
      }
      if (!disposed && !ownController.signal.aborted) {
        setStatus('offline');
        timer = setTimeout(() => { void connect(); }, Math.min(30_000, 1500 * 2 ** attempt++) + Math.random() * 500);
      }
    };
    const resume = () => {
      clearTimeout(timer); controller?.abort();
      if (!document.hidden && navigator.onLine) void connect(); else setStatus('offline');
    };
    window.addEventListener('online', resume); window.addEventListener('offline', resume);
    // Catalog changes need not append a run-journal event. Keep agent/project inventory fresh too.
    const catalogTimer = setInterval(() => { if (!document.hidden) update(); }, 15_000);
    document.addEventListener('visibilitychange', resume); void connect();
    return () => {
      disposed = true; controller?.abort(); clearTimeout(timer); clearTimeout(refreshTimer);
      clearInterval(catalogTimer);
      window.removeEventListener('online', resume); window.removeEventListener('offline', resume);
      document.removeEventListener('visibilitychange', resume);
    };
  }, [paired, generation, refresh, lostAccess]);

  const send = async (command: PendingCommand): Promise<MobileCommandResult | null> => {
    if (busyRef.current || status !== 'online') return null;
    if (!setPending(command)) { setError('Browser-Speicher nicht verfügbar. Auftrag wurde nicht gesendet.'); return null; }
    busyRef.current = true; setBusy(true); setError(''); setNotice('');
    const ownEpoch = epoch.current;
    try {
      const result = await client.request<MobileCommandResult>(command.path, 'POST', command.payload, command.key);
      if (ownEpoch !== epoch.current) return null;
      setPending(null); setRuns((current) => [result.run, ...current.filter((run) => run.id !== result.run.id)]);
      setNotice(result.replayed ? 'Bereits bestätigter Auftrag wiederhergestellt.' : 'ADE hat den Auftrag bestätigt.');
      void refresh().catch(() => undefined); return result;
    } catch (reason) {
      if (ownEpoch !== epoch.current || await lostAccess(reason)) return null;
      if (reason instanceof MobileClientError && [400, 403, 404, 409, 415, 422].includes(reason.status)) setPending(null);
      setError(errorText(reason)); return null;
    } finally { busyRef.current = false; setBusy(false); }
  };
  const pair = async (code: string, name: string): Promise<boolean> => {
    if (busyRef.current) return false;
    busyRef.current = true; setBusy(true); setError('');
    try { await client.pair(code, name); setDeviceId(client.deviceId); setPaired(true); return true; }
    catch (reason) { setError(errorText(reason)); return false; }
    finally { busyRef.current = false; setBusy(false); }
  };
  const disconnect = async () => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); clearIdentity();
    try { await client.disconnect(); } catch { /* Local identity is still cleared. */ }
    finally { busyRef.current = false; setBusy(false); }
  };
  const request = useCallback(async <T,>(path: string, method = 'GET', payload?: unknown, key = ''): Promise<T> => {
    const ownEpoch = epoch.current;
    try {
      const result = await client.request<T>(path, method, payload, key);
      if (ownEpoch !== epoch.current) throw new MobileClientError('unknown_device', 401);
      return result;
    } catch (reason) { if (ownEpoch === epoch.current) await lostAccess(reason); throw reason; }
  }, [lostAccess]);
  return { deviceId, paired, status, catalog, health, runs, error, notice, busy, lastSeen, pending, identityVersion, send, pair, disconnect, request, refresh,
    refreshNow: () => { void refresh().then(() => setError('')).catch((reason) => { setError(errorText(reason)); void lostAccess(reason); }); },
    canSubmit: status === 'online' && health?.commands === 'enabled' && !busy && !pending,
    reconnect: () => { setError(''); setGeneration((value) => value + 1); },
    dismissPending: () => { setPending(null); setNotice('Prüfe die Run-Liste, bevor du einen neuen Auftrag mit demselben Inhalt sendest.'); },
    dismissNotice: () => setNotice(''),
  };
}

export type MobileHost = ReturnType<typeof useMobileHost>;
