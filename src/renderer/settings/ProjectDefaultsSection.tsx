import { useEffect, useRef, useState, type JSX } from 'react';
import type { ProjectDefaultsView } from '../../shared/projectDefaults';
import { useAppData } from '../stores/appdata';

export function ProjectDefaultsSection(): JSX.Element {
  const agents = useAppData((state) => state.agents);
  const [value, setValue] = useState<ProjectDefaultsView>();
  const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false); const lock = useRef(false);
  useEffect(() => { void window.ade.invoke('projectDefaults:get').then(setValue)
    .catch(() => setError('Projekt-Einstellungen konnten nicht geladen werden. Settings erneut öffnen.')); }, []);
  const action = async (operation: () => Promise<void>) => {
    if (lock.current) return; lock.current = true; setBusy(true); setError(''); setNotice('');
    try { await operation(); } catch (reason) { setError((reason instanceof Error ? reason.message : 'Einstellung konnte nicht gespeichert werden.').replace(/^Error invoking remote method '[^']+':\s*/i, '').slice(0, 500)); }
    finally { lock.current = false; setBusy(false); }
  };
  return <section className="st-card" data-testid="project-defaults" aria-labelledby="project-defaults-title">
    <h3 id="project-defaults-title">Neue Projekte vom Tablet</h3>
    <p>Wähle einmal den Stammordner auf diesem PC. Jedes neue Projekt erhält dort einen eigenen Ordner und ein lokales Git-Repository.</p>
    {!value && !error && <p role="status">Projekt-Einstellungen werden geladen…</p>}
    {value && <form onSubmit={(event) => { event.preventDefault(); void action(async () => {
      const saved = await window.ade.invoke('projectDefaults:save', { rootPath: value.rootPath.trim(), agentId: value.agentId });
      setValue(saved); setNotice('Projektstart gespeichert. Am Tablet „Neues Projekt“ öffnen.');
    }); }}>
      <label>Projekt-Stammordner<input aria-label="Projekt-Stammordner" value={value.rootPath} disabled={busy} maxLength={4096}
        onChange={(event) => { setValue({ ...value, rootPath: event.target.value }); setNotice(''); }} /></label>
      <button type="button" className="btn" disabled={busy} onClick={() => void action(async () => {
        const result = await window.ade.invoke('dialog:pickFolder'); if (result.path) setValue({ ...value, rootPath: result.path });
      })}>Projektordner auswählen</button>
      <label>Codex-Startprofil<select aria-label="Codex-Startprofil" value={value.agentId ?? ''} disabled={busy}
        onChange={(event) => { setValue({ ...value, agentId: event.target.value || null }); setNotice(''); }}>
        <option value="">Am Tablet wählen / neues Codex-Profil</option>
        {Object.values(agents).filter((agent) => agent.runtime === 'codex' && (!agent.homeExecutionBackend || agent.homeExecutionBackend === 'native'))
          .map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
      </select></label>
      <p>Native Umgebung dieses PCs. Vorhandene Projekte behalten ihren Speicherort. Das gewählte Profil behält Modell und Berechtigungen; Anmeldung unter Harnesses prüfen.</p>
      <button className="btn primary" disabled={busy || !value.rootPath.trim()}>Projektstart speichern</button>
    </form>}
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
  </section>;
}
