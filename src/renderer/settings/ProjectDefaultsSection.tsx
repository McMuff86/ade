import { localizeAppMessage } from '../../shared/i18n/appMessages';
import { t as translate } from "../../shared/i18n";
import { useLocale } from "../i18n/language";
import { useEffect, useRef, useState, type JSX } from 'react';
import type { ProjectDefaultsView } from '../../shared/projectDefaults';

export function ProjectDefaultsSection(): JSX.Element {
  useLocale();
  const [value, setValue] = useState<ProjectDefaultsView>();
  const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false); const lock = useRef(false);
  useEffect(() => { void window.ade.invoke('projectDefaults:get').then(setValue)
    .catch(() => setError(translate("Could not load project settings. Reopen settings."))); }, []);
  const action = async (operation: () => Promise<void>) => {
    if (lock.current) return; lock.current = true; setBusy(true); setError(''); setNotice('');
    try { await operation(); } catch (reason) { setError((reason instanceof Error ? reason.message : translate("Setting could not be saved.")).replace(/^Error invoking remote method '[^']+':\s*/i, '').slice(0, 500)); }
    finally { lock.current = false; setBusy(false); }
  };
  return <section className="st-card" data-testid="project-defaults" aria-labelledby="project-defaults-title">
    <h3 id="project-defaults-title">{translate("Project root folder")}</h3>
    <p>{translate("Choose the root folder on this PC. Each new project gets its own folder and a local Git repository.")}</p>
    {!value && !error && <p role="status">{translate("Loading project settings…")}</p>}
    {value && <form onSubmit={(event) => { event.preventDefault(); void action(async () => {
      const saved = await window.ade.invoke('projectDefaults:save', { rootPath: value.rootPath.trim(), agentId: value.agentId });
      setValue(saved); setNotice(translate("Start of the project saved. Open on the tablet \"New project\"."));
    }); }}>
      <label>{translate("Project root folder")}<input aria-label={translate("Project root folder")} value={value.rootPath} disabled={busy} maxLength={4096}
        onChange={(event) => { setValue({ ...value, rootPath: event.target.value }); setNotice(''); }} /></label>
      <button type="button" className="btn" disabled={busy} onClick={() => void action(async () => {
        const result = await window.ade.invoke('dialog:pickFolder'); if (result.path) setValue({ ...value, rootPath: result.path });
      })}>{translate("Select project folders")}</button>
      <p>{translate("Native environment of this PC. Select Branch and CLI in the open project; an agent profile is optional. Check login under Harnesses.")}</p>
      <button className="btn primary" disabled={busy || !value.rootPath.trim()}>{translate("Save the project start")}</button>
    </form>}
    {error && <p role="alert">{localizeAppMessage(error)}</p>}{notice && <p role="status">{localizeAppMessage(notice)}</p>}
  </section>;
}
