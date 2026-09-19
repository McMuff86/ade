import { localizeAppMessage } from '../shared/i18n/appMessages';
import { intlLocale } from '../shared/i18n';
import { t as translate } from "../shared/i18n";
import { useLocale } from "../renderer/i18n/language";
/**
 * One place that answers "is the PC reachable, and what should I do?".
 * The header pill states the situation in one word; the dialog explains it
 * and offers exactly the action that fits. Re-pairing is never suggested for
 * a network interruption (UX-05).
 */
import type { JSX } from 'react';
import { Dialog, Icon } from './ui';
import type { MobileHost } from './useMobileHost';
import type { compareBuilds } from '../shared/buildInfo';

type BuildComparison = ReturnType<typeof compareBuilds>;

export type ConnectionSituation = 'online' | 'reconnecting' | 'unreachable' | 'build';

export function connectionSituation(host: Pick<MobileHost, 'status' | 'paired'>, build: BuildComparison): ConnectionSituation {
  if (host.status === 'online') return build === 'different' ? 'build' : 'online';
  return host.status === 'connecting' ? 'reconnecting' : 'unreachable';
}

/** Short label; tests and the status bar rely on the exact word "Verbunden". */
export function connectionLabel(host: Pick<MobileHost, 'status' | 'paired'>): string {
  if (!host.paired) return translate("Private access");
  return host.status === 'online' ? translate("Connected") : host.status === 'connecting' ? translate("Connecting…") : translate("Offline");
}

export function ConnectionDialog({ host, build, onClose, onSettings, fallbackId }: {
  host: MobileHost; build: BuildComparison; onClose: () => void; onSettings: () => void; fallbackId: string;
}): JSX.Element {
  useLocale();
  const situation = connectionSituation(host, build);
  const seen = host.lastSeen ? new Date(host.lastSeen).toLocaleTimeString(intlLocale()) : null;
  return <Dialog title={translate("Connection to PC")} onClose={onClose} fallbackId={fallbackId} className="m-connection-dialog">
    <dl className="m-connection-facts">
      <div><dt>{translate("Status")}</dt><dd data-situation={situation}>
        {situation === 'online' && translate("Connected. Data and terminals stream live from the PC.")}
        {situation === 'build' && translate("Connected, but browser and PC use different builds.")}
        {situation === 'reconnecting' && translate("Shortly interrupted. The connection is restored.")}
        {situation === 'unreachable' && translate("PC not reachable.")}
      </dd></div>
      <div><dt>{translate("Last confirmation")}</dt><dd>{seen ?? translate("No response in this session yet")}</dd></div>
      <div><dt>{translate("Pairing")}</dt><dd>{translate("Pairing is preserved. Switching networks does not require pairing again; this device signs back in with its saved key.")}</dd></div>
    </dl>
    {situation === 'reconnecting' && <p>{translate("Data displayed may be obsolete. Drafts remain stored on this device and are transferred after reconnection.")}</p>}
    {situation === 'unreachable' && <>
      <p>{translate("This helps, in this order:")}</p>
      <ol className="m-connection-steps">
        <li>{translate("Tailscale connected on this device? Mobile and external Wi-Fi need the active tailscale connection.")}</li>
        <li>{translate("PC turned on and ADE opened? After a PC restart, mobile access will not start until ADE has restarted.")}</li>
        <li>{translate("Then reconnect. Do not clear browser storage; it contains the pairing credentials.")}</li>
      </ol>
    </>}
    {situation === 'build' && <p>{translate("After building on the PC, fully quit and restart ADE there; closing the window leaves the old build running. Then reload this page.")}</p>}
    {host.error && <p className="m-alert" role="alert">{localizeAppMessage(host.error)}</p>}
    <div className="m-actions">
      {situation !== 'online' && situation !== 'build' && <button className="m-primary" onClick={() => { host.reconnect(); onClose(); }}><Icon name="refresh" />{translate("Reconnect")}</button>}
      {situation === 'build' && <button className="m-primary" onClick={() => { onClose(); onSettings(); }}>{translate("View build information")}</button>}
      <button onClick={onClose}>{translate("Close")}</button>
    </div>
  </Dialog>;
}
