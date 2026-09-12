import type { JSX } from 'react';
import type { DeviceResourceAccess } from '../../shared/remoteDevices';
import { useAppData } from '../stores/appdata';

export function resourceKey(value: DeviceResourceAccess = { mode: 'all' }): string {
  return JSON.stringify(value.mode === 'all' ? value : { mode: 'selected',
    repositoryIds: [...value.repositoryIds].sort(), agentIds: [...value.agentIds].sort() });
}

export function DeviceResourcePicker({ deviceId, value, onChange }: {
  deviceId: string; value: DeviceResourceAccess; onChange: (next: DeviceResourceAccess) => void;
}): JSX.Element {
  const repositories = useAppData((state) => state.repositories);
  const agents = useAppData((state) => state.agents);
  const loaded = useAppData((state) => state.loaded);
  return <fieldset className="st-device-resources">
    <legend>Projekte und Agenten freigeben</legend>
    <label><input type="radio" name={`resources-${deviceId}`} checked={value.mode === 'all'}
      onChange={() => onChange({ mode: 'all' })} />Alle, einschliesslich künftig hinzugefügter Projekte und Agenten</label>
    <label><input type="radio" name={`resources-${deviceId}`} checked={value.mode === 'selected'}
      onChange={() => onChange({ mode: 'selected', repositoryIds: [], agentIds: [] })} />Nur ausgewählte Projekte und Agenten</label>
    {value.mode === 'selected' && <>
      {!loaded && <p role="status">Projekt- und Agentenliste wird geladen…</p>}
      <button type="button" className="btn" disabled={!loaded} onClick={() => onChange({ mode: 'selected',
        repositoryIds: [...new Set([...value.repositoryIds, ...repositories.map((item) => item.id)])],
        agentIds: [...new Set([...value.agentIds, ...Object.keys(agents)])] })}>Alle derzeitigen auswählen</button>
      {(['repositoryIds', 'agentIds'] as const).map((kind) => {
        const entries = kind === 'repositoryIds' ? repositories : Object.values(agents);
        const ids = [...new Set([...entries.map((entry) => entry.id), ...value[kind]])];
        return <fieldset key={kind}><legend>{kind === 'repositoryIds' ? 'Projekte' : 'Agenten'}</legend>
          {loaded && ids.length === 0 && <p>Noch keine Einträge vorhanden.</p>}
          {ids.map((id) => <label key={id}><input type="checkbox" checked={value[kind].includes(id)}
            onChange={(event) => onChange({ ...value, [kind]: event.target.checked
              ? [...value[kind], id] : value[kind].filter((item) => item !== id) })} />
            {entries.find((entry) => entry.id === id)?.name ?? `Nicht mehr vorhanden (${id})`}</label>)}
        </fieldset>;
      })}
      <p className="st-device-hint">{value.repositoryIds.length} Projekte · {value.agentIds.length} Agenten ausgewählt.
        Neue Einträge bleiben gesperrt, bis du sie hier freigibst. Ohne Auswahl ist kein Projekt oder Agent erreichbar.</p>
    </>}
    <p className="st-device-hint">Die Auswahl begrenzt ADE-Ansichten und Aktionen. Ein freigegebenes Terminal läuft mit den Rechten deines PC-Benutzers.</p>
  </fieldset>;
}
