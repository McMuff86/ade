import { t as translate } from "../../shared/i18n";
import { useLocale } from "../i18n/language";
import { useId } from 'react';
import { useAppData } from '../stores/appdata';

export function NavigationGroupField({ value, onChange, disabled }: { value: string; onChange: (value: string) => void; disabled: boolean }) {
  useLocale();
  const id = useId();
  const groups = [...new Set(useAppData((state) => state.categories).flatMap((item) => item.navigationGroup ? [item.navigationGroup] : []))];
  return <div className="field"><label htmlFor={id}>{translate("Parent group")}</label>
    <input id={id} list={`${id}-options`} value={value} maxLength={80} disabled={disabled} autoComplete="off"
      placeholder={translate("No parent group")} onChange={(event) => onChange(event.target.value)} />
    <datalist id={`${id}-options`}>{groups.map((group) => <option key={group} value={group} />)}</datalist>
    <p className="repo-hint">{translate("Choose an existing parent group or enter a name, for example Agent Systems. Leave empty to remove the assignment.")}</p>
  </div>;
}
