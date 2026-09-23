import { localizeAppMessage } from '../../shared/i18n/appMessages';
import { intlLocale } from '../../shared/i18n';
import { t as translate } from "../../shared/i18n";
import { useLocale } from "../i18n/language";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type JSX } from 'react';
import type { RemoteDeviceInventory, DeviceResourceAccess } from '../../shared/remoteDevices';
import { DeviceResourcePicker, resourceKey } from './DeviceResourcePicker';
import { REMOTE_ADMIN_SCOPES, type RemoteAdminScope } from '../../shared/remoteDevices';
import { REMOTE_SCOPE_LABELS, SETUP_INTENTS, addSetupScopes, type SetupIntent } from '../../shared/setup';

export function RemoteDevicesSection(): JSX.Element {
  useLocale();
  const [inventory, setInventory] = useState<RemoteDeviceInventory | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [grantDrafts, setGrantDrafts] = useState<Record<string, RemoteAdminScope[]>>({});
  const [resourceDrafts, setResourceDrafts] = useState<Record<string, DeviceResourceAccess>>({});
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
      setResourceDrafts(Object.fromEntries(next.devices.map((device) => [device.id, device.resourceAccess ?? { mode: 'all' }])));
    } catch { setError(translate("Could not load devices. Please try again.")); }
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
          ? await window.ade.invoke('remoteDevices:setAdminScopes', { deviceId: id, scopes: grantDrafts[id] ?? [], resourceAccess: resourceDrafts[id] ?? { mode: 'all' } })
          : await window.ade.invoke('remoteDevices:revoke', { deviceId: id });
      setInventory(next);
      setDrafts(Object.fromEntries(next.devices.map((device) => [device.id, device.name])));
      setGrantDrafts(Object.fromEntries(next.devices.map((device) => [device.id, device.adminScopes ?? []])));
      setResourceDrafts(Object.fromEntries(next.devices.map((device) => [device.id, device.resourceAccess ?? { mode: 'all' }])));
      setMessage(action === 'rename' ? translate("The device name is stored.") : action === 'permissions'
        ? translate("Administrative rights stored. The device reconnects.") : translate("Device access revoked. Connections were terminated."));
    } catch {
      setError(translate("Change could not be confirmed. Updating and rechecking devices."));
    } finally {
      pendingFocus.current = { id, action };
      setBusy(false);
    }
  };

  return (
    <section className="st-devices" aria-labelledby="remote-devices-title" data-testid="remote-devices">
      <div className="st-device-heading">
        <h3 id="remote-devices-title">{translate("Connected devices")}</h3>
        <button ref={refreshButton} type="button" className="btn" aria-disabled={busy}
          onClick={() => { if (!busy) void refresh(); }}>{translate("Refresh devices")}</button>
      </div>
      <p className="st-device-hint">{translate("Devices with access to ADE. Remove immediately revokes access and terminates their connections. Already started tasks continue.")}</p>
      {busy && <p role="status">{translate("Refreshing device management…")}</p>}
      {error && <p className="st-error" role="alert">{localizeAppMessage(error)}</p>}
      {inventory?.error && <p className="st-error" role="alert">{localizeAppMessage(inventory.error)}</p>}
      {message && <p role="status">{message}</p>}
      {inventory?.devices.length === 0 && <p>{translate("No devices connected yet. Couple a tablet or smartphone under \"Mobile Access\".")}</p>}
      {(inventory?.devices.filter((device) => device.revokedAt === null).length ?? 0) > 1 && <p className="st-device-hint" data-testid="remote-devices-multiple">{translate("Several devices are active. One that has not been active for days is usually an earlier pairing of the same tablet: remove it here; the tablet you use keeps working.")}</p>}
      <ul className="st-device-list">
        {inventory?.devices.map((device) => (
          <li key={device.id} className="st-device" data-device-id={device.id}>
            {device.revokedAt === null ? (
              <form className="st-device-form" onSubmit={(event) => { event.preventDefault(); void change(device.id, 'rename'); }}>
                <label>{translate("Device name")}<input aria-label={translate("Device name for {{value1}}", { value1: device.id })} value={drafts[device.id] ?? device.name}
                    ref={(node) => { if (node) nameInputs.current.set(device.id, node); else nameInputs.current.delete(device.id); }}
                    maxLength={80} disabled={busy || !inventory.available}
                    onChange={(event) => setDrafts((current) => ({ ...current, [device.id]: event.target.value }))} />
                </label>
                <button type="submit" className="btn" disabled={busy || !inventory.available || !drafts[device.id]?.trim()
                  || drafts[device.id]?.trim() === device.name}>{translate("Save name")}</button>
                <button type="button" className="btn" disabled={busy || !inventory.available}
                  aria-label={translate("Revoke access for {{value1}}", { value1: device.name })} onClick={() => void change(device.id, 'revoke')}>{translate("Remove device")}</button>
              </form>
            ) : <strong>{device.name}{" "}{translate("· Access revoked")}</strong>}
            {device.revokedAt === null && <fieldset disabled={busy || !inventory.available} className="st-device-grants">
              <legend>{translate("Administrative rights for:")}{" "}{device.name}</legend>
              <p className="st-device-hint">{translate("Terminal access allows shell commands and access to everything your Windows user can access. The workspace is the starting directory, not a sandbox. You can take back input control on the desktop at any time.")}</p>
              <div className="st-grant-presets" role="group" aria-label={translate("Preselect permissions for {{value1}}", { value1: device.name })}>
                {(Object.keys(SETUP_INTENTS) as SetupIntent[]).map((intent) => <button key={intent} type="button" className="btn" onClick={() => {
                  setGrantDrafts((current) => ({ ...current, [device.id]: addSetupScopes(current[device.id] ?? [], intent) }));
                }}>{SETUP_INTENTS[intent].preset}</button>)}
              </div><p className="st-device-hint">{translate("The pre-selection only adds to the buttons below. Check and share with “Save administrative rights.” Project work does not include push/PR.")}</p>
              {REMOTE_ADMIN_SCOPES.map((scope) => <label key={scope}><input type="checkbox"
                checked={(grantDrafts[device.id] ?? []).includes(scope)} onChange={(event) => {
                  const checked = event.target.checked;
                  setGrantDrafts((current) => ({ ...current, [device.id]: checked
                    ? [...current[device.id] ?? [], scope] : (current[device.id] ?? []).filter((item) => item !== scope) }));
                }} />{REMOTE_SCOPE_LABELS[scope]}</label>)}
              <DeviceResourcePicker deviceId={device.id} value={resourceDrafts[device.id] ?? { mode: 'all' }}
                onChange={(next) => setResourceDrafts((current) => ({ ...current, [device.id]: next }))} />
              <button type="button" className="btn" onClick={() => void change(device.id, 'permissions')}
                disabled={JSON.stringify([...(grantDrafts[device.id] ?? [])].sort()) === JSON.stringify([...(device.adminScopes ?? [])].sort())
                  && resourceKey(resourceDrafts[device.id]) === resourceKey(device.resourceAccess)}>{translate("Save administrative rights")}</button>
            </fieldset>}
            <p className="st-device-hint">{device.id}{" "}{translate("· Added")}{" "}{new Date(device.createdAt).toLocaleDateString(intlLocale())}
              {device.revokedAt === null && (device.lastSeenAt === undefined ? translate(" · Not active since this ADE version") : translate(" · Last active {{value1}}", { value1: new Date(device.lastSeenAt).toLocaleString(intlLocale(), { dateStyle: 'medium', timeStyle: 'short' }) }))}
              {device.revokedAt === null && device.lastSeenAt !== undefined && Date.now() - device.lastSeenAt > 3 * 86_400_000 && <strong>{translate(" · inactive for {{value1}} days", { value1: Math.floor((Date.now() - device.lastSeenAt) / 86_400_000) })}</strong>}
              {device.revokedAt !== null && translate(" · Revoked {{value1}}", { value1: new Date(device.revokedAt).toLocaleDateString(intlLocale()) })}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
