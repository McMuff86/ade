import { useState, type JSX } from 'react';
import type { MobileHostState } from '../shared/remote';
import { BUILD_INFO, compareBuilds, isBuildInfo } from '../shared/buildInfo';
import { REMOTE_SCOPE_LABELS, SETUP_INTENTS, setupReadiness, type SetupIntent } from '../shared/setup';
import type { MobileHost } from './useMobileHost';

export function HostBuildStatus({ state, online }: { state: MobileHostState | null; online: boolean }): JSX.Element {
  const comparison = compareBuilds(state?.build);
  const hostBuild = isBuildInfo(state?.build) ? state.build : undefined;
  return <section aria-label="Build-Stand" className="m-build-status"><h4>Build-Stand</h4>
    <dl><dt>PC</dt><dd>{state ? `Version ${state.version} · ${hostBuild?.sourceId ?? 'Build nicht gemeldet'}` : 'Noch nicht bekannt'}</dd>
      <dt>Browser</dt><dd>{BUILD_INFO?.sourceId ?? 'Build nicht bekannt'}</dd></dl>
    {hostBuild && <p className="m-field-note">PC-Build erstellt: {new Date(hostBuild.builtAt).toLocaleString()}</p>}
    {!online ? <p role="status">PC nicht aktuell bestätigt. Angezeigter PC-Stand stammt aus der letzten Antwort.</p>
      : state && <p role="status">{comparison === 'same' ? 'Browser und PC verwenden denselben Quellstand.'
        : comparison === 'different' ? 'Browser und PC verwenden unterschiedliche Builds. Entwürfe zuerst sichern, dann die Seite in Chrome neu laden. Bleibt der Unterschied, ADE am PC aktualisieren und vollständig neu starten.'
          : 'Build-Vergleich nicht möglich: Eine Seite meldet keine Build-Kennung. Das bestätigt weder einen aktuellen noch einen veralteten Stand.'}</p>}
  </section>;
}

export function MobileSetupStatus({ host, state, onNavigate }: {
  host: MobileHost; state: MobileHostState | null; onNavigate: (target: 'projects' | 'graph') => void;
}): JSX.Element {
  const [intent, setIntent] = useState<SetupIntent>('project');
  const online = host.status === 'online';
  const readiness = setupReadiness(intent, state?.capabilities, host.catalog?.projectStart?.configured, online);
  return <section className="m-setup-status" aria-label="Einrichtung auf diesem Gerät"><h3>Einrichtung auf diesem Gerät</h3>
    <label htmlFor="mobile-setup-intent">Vorhaben auf diesem Gerät</label><select id="mobile-setup-intent" value={intent} onChange={(event) => setIntent(event.target.value as SetupIntent)}>
      {(Object.keys(SETUP_INTENTS) as SetupIntent[]).map((key) => <option value={key} key={key}>{SETUP_INTENTS[key].label}</option>)}
    </select>
    <p>Dieses Gerät ist gekoppelt. Freigaben werden in ADE am PC unter <strong>Einrichtung → Freigaben prüfen</strong> oder Settings → Verbundene Geräte verwaltet.</p>
    {readiness.status === 'offline' ? <p role="status">Verbindung zum PC herstellen, um Einrichtung und Freigaben aktuell zu prüfen.</p>
      : readiness.status === 'unknown' ? <p role="status">Einrichtungsdaten sind noch nicht vollständig bekannt. Status aktualisieren; bei einem älteren Host ADE am PC aktualisieren.</p>
        : <><p role="status">{readiness.status === 'ready' ? 'Die nötigen Einstellungen und Gerätefreigaben sind vorhanden.' : 'Für dieses Vorhaben fehlen noch Einstellungen oder Freigaben.'}</p>
          {readiness.root === 'missing' && <p>Am PC unter Einrichtung → Projektordner den Stammordner speichern. Bereits registrierte Projekte bleiben erreichbar.</p>}
          {readiness.missing.length > 0 && <><p>Für dieses Gerät fehlen diese Schalter:</p><ul>{readiness.missing.map((scope) => <li key={scope}>{REMOTE_SCOPE_LABELS[scope]}</li>)}</ul>
            <p>Am PC kannst du „{SETUP_INTENTS[intent].preset}“ verwenden. Auswahl prüfen und anschliessend „Verwaltungsrechte speichern“ wählen.</p></>}
        </>}
    {intent === 'project' && <p className="m-field-note">CLI-Installation und Anmeldung prüfst du separat in Einrichtung → CLI prüfen am PC. Vorhandene Freigaben bestätigen keine CLI-Anmeldung.</p>}
    <button disabled={!online} onClick={() => onNavigate(intent === 'results' ? 'graph' : 'projects')}>{intent === 'results' ? 'Zum Graph' : 'Zu den Projekten'}</button>
  </section>;
}
