import { localizeAppMessage } from '../../shared/i18n/appMessages';
import { intlLocale } from '../../shared/i18n';
import { t as translate } from "../../shared/i18n";
import { localizedLabels } from "../../shared/i18n/labels";
import { useLocale } from "../i18n/language";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type JSX } from 'react';
import type { RuntimeDiagnosticsResult } from '../../shared/types';
import { BUILD_INFO } from '../../shared/buildInfo';
import { Modal } from './Modal';
import { ProjectDefaultsSection } from '../settings/ProjectDefaultsSection';
import { MobileAccessSection } from '../settings/MobileAccessSection';
import { RemoteDevicesSection } from '../settings/RemoteDevicesSection';
import '../settings/settings.css';
import './setup.css';

const STEPS = localizedLabels(() => ([translate("Project folder"), translate("Check CLI"), translate("Connect tablet"), translate("Check permissions")] as const));

/** Guides existing explicit actions; no fake progress flags or automatic grants. */
export function SetupModal({ onClose, onProjects }: { onClose: () => void; onProjects: () => void }): JSX.Element {
  useLocale();
  const [step, setStep] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const previousStep = useRef(step);
  useLayoutEffect(() => { if (previousStep.current !== step) { previousStep.current = step; heading.current?.focus(); } }, [step]);
  return <Modal title={translate("Set up ADE")} subtitle={translate("Open a project, choose a CLI and continue on your tablet when needed. An agent profile is optional.")}
    onClose={onClose} className="setup-modal" fallbackFocus={() => document.getElementById('ade-setup')}>
    <p className="setup-note" aria-label={translate("ADE-Build on PC")}>{BUILD_INFO ? translate("PC build {{value1}} · Built {{value2}}", { value1: BUILD_INFO.sourceId, value2: new Date(BUILD_INFO.builtAt).toLocaleString(intlLocale()) }) : translate("PC build not known (development start).")}</p>
    <nav className="setup-steps" aria-label={translate("Setup steps")}>{STEPS.map((label, index) => <button type="button" className="btn" key={index}
      aria-current={step === index ? 'step' : undefined} onClick={() => setStep(index)}>{index + 1}. {label}</button>)}</nav>
    <h3 tabIndex={-1} ref={heading} className="setup-step-title">{STEPS[step]}</h3>
    {step === 0 && <><p>{translate("This is where new projects start. Existing folders appear under Projects; you decide which one to open.")}</p><ProjectDefaultsSection /></>}
    {step === 1 && <NativeCliReadiness onProjects={onProjects} />}
    {step === 2 && <><p>{translate("Optional: For work only on the PC, you can skip this step.")}</p><MobileAccessSection /></>}
    {step === 3 && <><p>{translate("Choose your paired device. Projects require file reading and project workspace access; CLI work requires terminal access. Branch/Git and push/PR have additional permissions. Select the permissions you need and save them explicitly.")}</p><RemoteDevicesSection /></>}
    <div className="setup-actions">
      <button type="button" className="btn" disabled={step === 0} onClick={() => setStep((current) => current - 1)}>{translate("Back")}</button>
      {step < STEPS.length - 1 && <button type="button" className="btn" onClick={() => setStep((current) => current + 1)}>{translate("Next")}</button>}
      <button type="button" className="btn primary" onClick={onProjects}>{translate("Go to projects")}</button>
      <button type="button" className="btn" onClick={onClose}>{translate("Close setup")}</button>
    </div>
  </Modal>;
}

function NativeCliReadiness({ onProjects }: { onProjects: () => void }): JSX.Element {
  useLocale();
  const [result, setResult] = useState<RuntimeDiagnosticsResult>();
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const live = useRef(true); const lock = useRef(false);
  const refresh = useCallback(async () => {
    if (lock.current) return; lock.current = true; setBusy(true); setError(''); setResult(undefined);
    try { const next = await window.ade.invoke('harness:diagnose'); if (live.current) setResult(next); }
    catch { if (live.current) setError(translate("The CLI check could not be completed. Check again; an unknown status does not confirm sign-in.")); }
    finally { lock.current = false; if (live.current) setBusy(false); }
  }, []);
  useEffect(() => { live.current = true; void refresh(); return () => { live.current = false; }; }, [refresh]);
  return <section aria-label={translate("CLI readiness")} className="setup-cli">
    <p>{translate("This check applies to the native environment of this PC. WSL logins are part of the respective distribution. Only availability and login status are checked.")}</p>
    <button type="button" className="btn" disabled={busy} onClick={() => void refresh()}>{busy ? translate("Checking CLIs…") : translate("Check CLI status again")}</button>
    {busy && <p role="status">{translate("Checking installed CLIs and sign-in…")}</p>}
    {error && <p role="alert">{localizeAppMessage(error)}</p>}
    {result && <><p className="setup-note">{translate("Checked:")}{" "}{new Date(result.checkedAt).toLocaleTimeString(intlLocale())} · {result.platform}</p>
      <ul className="setup-cli-list">{(['codex', 'claude', 'grok'] as const).map((runtime) => {
        const item = result.items.find((candidate) => candidate.runtime === runtime);
        return <li key={runtime}><strong>{runtime === 'codex' ? translate("Codex") : runtime === 'claude' ? translate("Claude CLI") : translate("Grok CLI")}</strong>
          <span>{!item || item.installed === null ? translate("Availability unknown") : item.installed ? translate("Installed") : translate("Not installed [4e696368]")}
            {item?.version ? ` · ${item.version}` : ''}</span>
          <span>{item?.authStatus === 'authenticated' ? translate("Signed in") : item?.authStatus === 'not-authenticated' ? translate("Not signed in")
            : item?.authStatus === 'not-required' ? translate("No sign-in required") : translate("Sign-in not confirmed")}</span>
          {item && <p>{item.message}</p>}</li>;
      })}</ul></>}
    <p>{translate("If a CLI is missing, install it on the PC according to its manufacturer's manual and check again. To register, you open a project and start the desired CLI there; follow their sign-in in the terminal. Existing CLI registrations are reused. Without sign-in, you can already use the shell.")}</p>
    <button type="button" className="btn" onClick={onProjects}>{translate("Open project to sign in to CLI")}</button>
  </section>;
}
