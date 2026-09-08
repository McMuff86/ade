import { useCallback, useEffect, useLayoutEffect, useRef, useState, type JSX } from 'react';
import type { RemoteDeviceInventory } from '../../shared/remoteDevices';
import { REMOTE_ADMIN_SCOPES, type RemoteAdminScope } from '../../shared/remoteDevices';

const scopeLabels: Record<RemoteAdminScope, string> = {
  'host:restart': 'ADE neu starten', 'catalog:write': 'Agents und Projekte erstellen', 'repositories:write': 'Git abrufen und Workspaces aktualisieren',
};

export function RemoteDevicesSection(): JSX.Element {
  const [inventory, setInventory] = useState<RemoteDeviceInventory | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [grantDrafts, setGrantDrafts] = useState<Record<string, RemoteAdminScope[]>>({});
  const refreshButton = useRef<HTMLButtonElement>(null);
  const nameInputs = useRef(new Map<string, HTMLInputElement>());
  const pendingFocus = useRef<{ id: string; action: 'rename' | 'revoke' | 'permissions' } | null>(null);

  useLayoutEffect(() => {
    if (busy || !pendingFocus.current) return;
    const { id, action } = pendingFocus.current;
    pendingFocus.current = null;
    // Focus only after React has committed the enabled controls/new inventory.
    (action === 'rename' ? nameInputs.current.get(id) : refreshButton.current)?.focus();
  }, [busy, inventory, error]);

  const refresh = useCallback(async (): Promise<void> => {
    setBusy(true);
    setError('');
    try {
      const next = await window.ade.invoke('remoteDevices:list');
      setInventory(next);
      setDrafts(Object.fromEntries(next.devices.map((device) => [device.id, device.name])));
      setGrantDrafts(Object.fromEntries(next.devices.map((device) => [device.id, device.adminScopes ?? []])));
    } catch { setError('Geräte konnten nicht geladen werden. Bitte erneut versuchen.'); }
    finally { setBusy(false); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const change = async (id: string, action: 'rename' | 'revoke' | 'permissions'): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const next = action === 'rename'
        ? await window.ade.invoke('remoteDevices:rename', { deviceId: id, name: drafts[id]!.trim() })
        : action === 'permissions'
          ? await window.ade.invoke('remoteDevices:setAdminScopes', { deviceId: id, scopes: grantDrafts[id] ?? [] })
          : await window.ade.invoke('remoteDevices:revoke', { deviceId: id });
      setInventory(next);
      setDrafts(Object.fromEntries(next.devices.map((device) => [device.id, device.name])));
      setGrantDrafts(Object.fromEntries(next.devices.map((device) => [device.id, device.adminScopes ?? []])));
      setMessage(action === 'rename' ? 'Gerätename gespeichert.' : action === 'permissions'
        ? 'Verwaltungsrechte gespeichert. Das Gerät verbindet sich erneut.' : 'Gerätezugriff widerrufen. Verbindungen wurden beendet.');
    } catch {
      setError('Änderung konnte nicht bestätigt werden. Geräte aktualisieren und erneut prüfen.');
    } finally {
      pendingFocus.current = { id, action };
      setBusy(false);
    }
  };

  return (
    <section className="st-devices" aria-labelledby="remote-devices-title" data-testid="remote-devices">
      <div className="st-device-heading">
        <h3 id="remote-devices-title">Verbundene Geräte</h3>
        <button ref={refreshButton} type="button" className="btn" aria-disabled={busy}
          onClick={() => { if (!busy) void refresh(); }}>Geräte aktualisieren</button>
      </div>
      <p className="st-device-hint">Geräte mit Zugriff auf ADE. Entfernen widerruft den Zugriff sofort und beendet
        ihre Verbindungen. Bereits gestartete Aufgaben laufen weiter.</p>
      {busy && <p role="status">Geräteverwaltung wird aktualisiert…</p>}
      {error && <p className="st-error" role="alert">{error}</p>}
      {inventory?.error && <p className="st-error" role="alert">{inventory.error}</p>}
      {message && <p role="status">{message}</p>}
      {inventory?.devices.length === 0 && <p>Noch keine Geräte verbunden. Unter „Mobiler Zugriff“ ein Tablet oder Smartphone koppeln.</p>}
      <ul className="st-device-list">
        {inventory?.devices.map((device) => (
          <li key={device.id} className="st-device" data-device-id={device.id}>
            {device.revokedAt === null ? (
              <form className="st-device-form" onSubmit={(event) => { event.preventDefault(); void change(device.id, 'rename'); }}>
                <label>Gerätename
                  <input aria-label={`Gerätename für ${device.id}`} value={drafts[device.id] ?? device.name}
                    ref={(node) => { if (node) nameInputs.current.set(device.id, node); else nameInputs.current.delete(device.id); }}
                    maxLength={80} disabled={busy || !inventory.available}
                    onChange={(event) => setDrafts((current) => ({ ...current, [device.id]: event.target.value }))} />
                </label>
                <button type="submit" className="btn" disabled={busy || !inventory.available || !drafts[device.id]?.trim()
                  || drafts[device.id]?.trim() === device.name}>Name speichern</button>
                <button type="button" className="btn" disabled={busy || !inventory.available}
                  aria-label={`Zugriff für ${device.name} widerrufen`} onClick={() => void change(device.id, 'revoke')}>Gerät entfernen</button>
              </form>
            ) : <strong>{device.name} · Zugriff widerrufen</strong>}
            {device.revokedAt === null && <fieldset disabled={busy || !inventory.available} className="st-device-grants">
              <legend>Verwaltungsrechte für {device.name}</legend>
              {REMOTE_ADMIN_SCOPES.map((scope) => <label key={scope}><input type="checkbox"
                checked={(grantDrafts[device.id] ?? []).includes(scope)} onChange={(event) => {
                  const checked = event.target.checked;
                  setGrantDrafts((current) => ({ ...current, [device.id]: checked
                    ? [...current[device.id] ?? [], scope] : (current[device.id] ?? []).filter((item) => item !== scope) }));
                }} />{scopeLabels[scope]}</label>)}
              <button type="button" className="btn" onClick={() => void change(device.id, 'permissions')}
                disabled={JSON.stringify([...(grantDrafts[device.id] ?? [])].sort()) === JSON.stringify([...(device.adminScopes ?? [])].sort())}>Verwaltungsrechte speichern</button>
            </fieldset>}
            <p className="st-device-hint">{device.id} · Hinzugefügt {new Date(device.createdAt).toLocaleDateString()}
              {device.revokedAt !== null && ` · Widerrufen ${new Date(device.revokedAt).toLocaleDateString()}`}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
