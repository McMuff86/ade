import { useId } from 'react';
import { useAppData } from '../stores/appdata';

export function NavigationGroupField({ value, onChange, disabled }: { value: string; onChange: (value: string) => void; disabled: boolean }) {
  const id = useId();
  const groups = [...new Set(useAppData((state) => state.categories).flatMap((item) => item.navigationGroup ? [item.navigationGroup] : []))];
  return <div className="field"><label htmlFor={id}>Obergruppe</label>
    <input id={id} list={`${id}-options`} value={value} maxLength={80} disabled={disabled} autoComplete="off"
      placeholder="Keine Obergruppe" onChange={(event) => onChange(event.target.value)} />
    <datalist id={`${id}-options`}>{groups.map((group) => <option key={group} value={group} />)}</datalist>
    <p className="repo-hint">Vorhandene Obergruppe wählen oder einen Namen eingeben, z. B. Agent-Systeme. Leer entfernt die Zuordnung.</p>
  </div>;
}
