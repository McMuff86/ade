import { intlLocale } from '../shared/i18n';
import { t as translate } from "../shared/i18n";
import { useLocale } from "../renderer/i18n/language";
import { useState, type JSX } from 'react';
import type { MobileHostState } from '../shared/remote';
import { BUILD_INFO, compareBuilds, isBuildInfo } from '../shared/buildInfo';
import { REMOTE_SCOPE_LABELS, SETUP_INTENTS, setupReadiness, type SetupIntent } from '../shared/setup';
import type { MobileHost } from './useMobileHost';

export function HostBuildStatus({ state, online }: { state: MobileHostState | null; online: boolean }): JSX.Element {
  useLocale();
  const comparison = compareBuilds(state?.build);
  const hostBuild = isBuildInfo(state?.build) ? state.build : undefined;
  return <section aria-label={translate("Build information")} className="m-build-status"><h4>{translate("Build information")}</h4>
    <dl><dt>{translate("PC")}</dt><dd>{state ? `Version ${state.version} · ${hostBuild?.sourceId ?? translate("Build not reported")}` : translate("Not yet known")}</dd>
      <dt>{translate("Browser")}</dt><dd>{BUILD_INFO?.sourceId ?? translate("Build not known")}</dd></dl>
    {hostBuild && <p className="m-field-note">{translate("PC build created:")}{" "}{new Date(hostBuild.builtAt).toLocaleString(intlLocale())}</p>}
    {!online ? <p role="status">{translate("PC not currently confirmed. Displayed PC status is from the last response.")}</p>
      : state && <p role="status">{comparison === 'same' ? translate("Browser and PC use the same source.")
        : comparison === 'different' ? translate("Browser and PC use different builds. Backup drafts first, then reload the page to Chrome. Remains the difference, update ADE to the PC and restart completely.")
          : translate("Build comparison not possible: A page does not report a build identifier, which does not confirm a current status or an outdated status.")}</p>}
  </section>;
}

export function MobileSetupStatus({ host, state, onNavigate }: {
  host: MobileHost; state: MobileHostState | null; onNavigate: (target: 'projects' | 'graph') => void;
}): JSX.Element {
  useLocale();
  const [intent, setIntent] = useState<SetupIntent>('project');
  const online = host.status === 'online';
  const readiness = setupReadiness(intent, state?.capabilities, host.catalog?.projectStart?.configured, online);
  return <section className="m-setup-status" aria-label={translate("Setup on this device")}><h3>{translate("Setup on this device")}</h3>
    <label htmlFor="mobile-setup-intent">{translate("Activities on this device")}</label><select id="mobile-setup-intent" value={intent} onChange={(event) => setIntent(event.target.value as SetupIntent)}>
      {(Object.keys(SETUP_INTENTS) as SetupIntent[]).map((key) => <option value={key} key={key}>{SETUP_INTENTS[key].label}</option>)}
    </select>
    <p>{translate("This device is paired. Manage its permissions in ADE on the PC under")}{" "}<strong>{translate("Setup → Check permissions")}</strong> {" "}{translate("or Settings → Connected devices.")}</p>
    {readiness.status === 'offline' ? <p role="status">{translate("Connect to the PC to check the current setup and permissions.")}</p>
      : readiness.status === 'unknown' ? <p role="status">{translate("Setup data is not yet fully known. Update status; update ADE on the PC for an older host.")}</p>
        : <><p role="status">{readiness.status === 'ready' ? translate("The required settings and device permissions are in place.") : translate("Some settings or permissions are still missing for this activity.")}</p>
          {readiness.root === 'missing' && <p>{translate("Save the root folder on the PC under Setup → Project folder. Already registered projects remain accessible.")}</p>}
          {readiness.missing.length > 0 && <><p>{translate("Enable these permissions for this device:")}</p><ul>{readiness.missing.map((scope) => <li key={scope}>{REMOTE_SCOPE_LABELS[scope]}</li>)}</ul>
            <p>{translate("On the PC you can “")}{SETUP_INTENTS[intent].preset}{translate("”. Review the selection and then choose “Save administrative rights”.")}</p></>}
        </>}
    {intent === 'project' && <p className="m-field-note">{translate("Check CLI installation and sign-in with “Diagnostics” further down in these settings (needs the “Run CLI diagnostics” permission) or on the PC under Setup → Check CLI. Existing permissions do not confirm that a CLI is signed in.")}</p>}
    <button disabled={!online} onClick={() => onNavigate(intent === 'results' ? 'graph' : 'projects')}>{intent === 'results' ? translate("Go to graph") : translate("Go to projects")}</button>
  </section>;
}
