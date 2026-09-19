import { t as translate } from "../../shared/i18n";
import { useLocale } from "../i18n/language";
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
  useLocale();
  const repositories = useAppData((state) => state.repositories);
  const agents = useAppData((state) => state.agents);
  const loaded = useAppData((state) => state.loaded);
  return <fieldset className="st-device-resources">
    <legend>{translate("Share projects and agents")}</legend>
    <label><input type="radio" name={`resources-${deviceId}`} checked={value.mode === 'all'}
      onChange={() => onChange({ mode: 'all' })} />{translate("All, including future added projects and agents")}</label>
    <label><input type="radio" name={`resources-${deviceId}`} checked={value.mode === 'selected'}
      onChange={() => onChange({ mode: 'selected', repositoryIds: [], agentIds: [] })} />{translate("Only selected projects and agents")}</label>
    {value.mode === 'selected' && <>
      {!loaded && <p role="status">{translate("Loading projects and agents… [50726f6a]")}</p>}
      <button type="button" className="btn" disabled={!loaded} onClick={() => onChange({ mode: 'selected',
        repositoryIds: [...new Set([...value.repositoryIds, ...repositories.map((item) => item.id)])],
        agentIds: [...new Set([...value.agentIds, ...Object.keys(agents)])] })}>{translate("Select all current ones")}</button>
      {(['repositoryIds', 'agentIds'] as const).map((kind) => {
        const entries = kind === 'repositoryIds' ? repositories : Object.values(agents);
        const ids = [...new Set([...entries.map((entry) => entry.id), ...value[kind]])];
        return <fieldset key={kind}><legend>{kind === 'repositoryIds' ? translate("Projects") : translate("Agents [4167656e]")}</legend>
          {loaded && ids.length === 0 && <p>{translate("There are no entries yet.")}</p>}
          {ids.map((id) => <label key={id}><input type="checkbox" checked={value[kind].includes(id)}
            onChange={(event) => onChange({ ...value, [kind]: event.target.checked
              ? [...value[kind], id] : value[kind].filter((item) => item !== id) })} />
            {entries.find((entry) => entry.id === id)?.name ?? translate("No longer available ({{value1}})", { value1: id })}</label>)}
        </fieldset>;
      })}
      <p className="st-device-hint">{value.repositoryIds.length} {" "}{translate("Projects ·")}{" "}{value.agentIds.length} {" "}{translate("Agents selected. New entries remain locked until you release them here. Without selection, no project or agent can be reached.")}</p>
    </>}
    <p className="st-device-hint">{translate("The choice limits ADE views and actions. A shared terminal runs with the rights of your PC user.")}</p>
  </fieldset>;
}
