/**
 * First-run entry: projects and setup work without creating an agent category.
 */

import { useOnboarding } from './useOnboarding';
import './onboarding.css';

export function FirstRun({ onSetup, onProjects, allowCategory = true }: {
  onSetup: () => void; onProjects: () => void; allowCategory?: boolean;
}): React.ReactElement {
  const openNewCategory = useOnboarding((s) => s.openNewCategory);

  return (
    <div className="firstrun">
      <div className="firstrun-card">
        <h1 className="firstrun-title">Willkommen in ADE</h1>
        <div className="firstrun-sub">
          Öffne ein Projekt und wähle Codex, Claude, Grok oder die Shell.
          Ein Agent-Profil ist optional. Die Einrichtung führt dich durch Projektordner,
          CLI-Anmeldung und den optionalen Tablet-Zugang.
        </div>
        <div className="firstrun-actions"><button type="button" className="btn primary firstrun-cta" onClick={onSetup}>ADE jetzt einrichten</button>
          <button type="button" className="btn" onClick={onProjects}>Projekte ansehen</button></div>
        {allowCategory && <><p className="firstrun-sub">Für persönliche Agents kannst du zusätzlich eine Kategorie anlegen.</p>
        <button type="button" className="btn firstrun-cta" onClick={openNewCategory}>
          + New category
        </button></>}
      </div>
    </div>
  );
}
