import { t as translate } from "../../shared/i18n";
import { useLocale } from "../i18n/language";
/**
 * First-run entry: projects and setup work without creating an agent category.
 */

import { useOnboarding } from './useOnboarding';
import './onboarding.css';

export function FirstRun({ onSetup, onProjects, allowCategory = true }: {
  onSetup: () => void; onProjects: () => void; allowCategory?: boolean;
}): React.ReactElement {
  useLocale();
  const openNewCategory = useOnboarding((s) => s.openNewCategory);

  return (
    <div className="firstrun">
      <div className="firstrun-card">
        <h1 className="firstrun-title">{translate("Welcome to ADE")}</h1>
        <div className="firstrun-sub">
          {translate("Open a project and select Codex, Claude, Grok, or the Shell. An agent profile is optional. The setup will guide you through the project folder, CLI login, and the optional tablet access.")}</div>
        <div className="firstrun-actions"><button type="button" className="btn primary firstrun-cta" onClick={onSetup}>{translate("Set up ADE now")}</button>
          <button type="button" className="btn" onClick={onProjects}>{translate("View projects")}</button></div>
        {allowCategory && <><p className="firstrun-sub">{translate("For personal agents, you can also create a category.")}</p>
        <button type="button" className="btn firstrun-cta" onClick={openNewCategory}>
          {translate("+ New category")}</button></>}
      </div>
    </div>
  );
}
