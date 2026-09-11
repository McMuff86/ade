import { useCallback, useEffect, useLayoutEffect, useRef, useState, type JSX } from 'react';
import type { RuntimeDiagnosticsResult } from '../../shared/types';
import { Modal } from './Modal';
import { ProjectDefaultsSection } from '../settings/ProjectDefaultsSection';
import { MobileAccessSection } from '../settings/MobileAccessSection';
import { RemoteDevicesSection } from '../settings/RemoteDevicesSection';
import '../settings/settings.css';
import './setup.css';

const STEPS = ['Projektordner', 'CLI prüfen', 'Tablet verbinden', 'Freigaben prüfen'] as const;

/** Guides existing explicit actions; no fake progress flags or automatic grants. */
export function SetupModal({ onClose, onProjects }: { onClose: () => void; onProjects: () => void }): JSX.Element {
  const [step, setStep] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const previousStep = useRef(step);
  useLayoutEffect(() => { if (previousStep.current !== step) { previousStep.current = step; heading.current?.focus(); } }, [step]);
  return <Modal title="ADE einrichten" subtitle="Projekt öffnen, CLI wählen und bei Bedarf am Tablet weiterarbeiten. Ein Agent-Profil ist optional."
    onClose={onClose} className="setup-modal" fallbackFocus={() => document.getElementById('ade-setup')}>
    <nav className="setup-steps" aria-label="Einrichtungsschritte">{STEPS.map((label, index) => <button type="button" className="btn" key={label}
      aria-current={step === index ? 'step' : undefined} onClick={() => setStep(index)}>{index + 1}. {label}</button>)}</nav>
    <h3 tabIndex={-1} ref={heading} className="setup-step-title">{STEPS[step]}</h3>
    {step === 0 && <><p>Hier beginnen neue Projekte. Bereits vorhandene Ordner erscheinen unter Projekte; du entscheidest, welchen du öffnest.</p><ProjectDefaultsSection /></>}
    {step === 1 && <NativeCliReadiness onProjects={onProjects} />}
    {step === 2 && <><p>Optional: Für die Arbeit nur am PC kannst du diesen Schritt überspringen.</p><MobileAccessSection /></>}
    {step === 3 && <><p>Wähle dein gekoppeltes Gerät. Für Projekte brauchst du Dateilesen und Projekt-Workspaces, für die CLI Terminalzugriff.
      Branch/Git und Push/PR haben zusätzliche Freigaben. Wähle die benötigten Schalter und speichere sie bewusst.</p><RemoteDevicesSection /></>}
    <div className="setup-actions">
      <button type="button" className="btn" disabled={step === 0} onClick={() => setStep((current) => current - 1)}>Zurück</button>
      {step < STEPS.length - 1 && <button type="button" className="btn" onClick={() => setStep((current) => current + 1)}>Weiter</button>}
      <button type="button" className="btn primary" onClick={onProjects}>Zu den Projekten</button>
      <button type="button" className="btn" onClick={onClose}>Einrichtung schliessen</button>
    </div>
  </Modal>;
}

function NativeCliReadiness({ onProjects }: { onProjects: () => void }): JSX.Element {
  const [result, setResult] = useState<RuntimeDiagnosticsResult>();
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const live = useRef(true); const lock = useRef(false);
  const refresh = useCallback(async () => {
    if (lock.current) return; lock.current = true; setBusy(true); setError(''); setResult(undefined);
    try { const next = await window.ade.invoke('harness:diagnose'); if (live.current) setResult(next); }
    catch { if (live.current) setError('CLI-Prüfung konnte nicht abgeschlossen werden. Erneut prüfen; ein unbekannter Status bestätigt keine Anmeldung.'); }
    finally { lock.current = false; if (live.current) setBusy(false); }
  }, []);
  useEffect(() => { live.current = true; void refresh(); return () => { live.current = false; }; }, [refresh]);
  return <section aria-label="CLI-Bereitschaft" className="setup-cli">
    <p>Diese Prüfung gilt für die native Umgebung dieses PCs. WSL-Anmeldungen gehören zur jeweiligen Distribution.
      Es werden nur Verfügbarkeit und Anmeldestatus geprüft.</p>
    <button type="button" className="btn" disabled={busy} onClick={() => void refresh()}>{busy ? 'CLIs werden geprüft…' : 'CLI-Status erneut prüfen'}</button>
    {busy && <p role="status">Installierte CLIs und Anmeldung werden geprüft…</p>}
    {error && <p role="alert">{error}</p>}
    {result && <><p className="setup-note">Geprüft: {new Date(result.checkedAt).toLocaleTimeString()} · {result.platform}</p>
      <ul className="setup-cli-list">{(['codex', 'claude', 'grok'] as const).map((runtime) => {
        const item = result.items.find((candidate) => candidate.runtime === runtime);
        return <li key={runtime}><strong>{runtime === 'codex' ? 'Codex' : runtime === 'claude' ? 'Claude CLI' : 'Grok CLI'}</strong>
          <span>{!item || item.installed === null ? 'Verfügbarkeit unbekannt' : item.installed ? 'Installiert' : 'Nicht installiert'}
            {item?.version ? ` · ${item.version}` : ''}</span>
          <span>{item?.authStatus === 'authenticated' ? 'Angemeldet' : item?.authStatus === 'not-authenticated' ? 'Anmeldung fehlt'
            : item?.authStatus === 'not-required' ? 'Keine Anmeldung erforderlich' : 'Anmeldung nicht bestätigt'}</span>
          {item && <p>{item.message}</p>}</li>;
      })}</ul></>}
    <p>Fehlt eine CLI, installiere sie auf dem PC nach ihrer Herstelleranleitung und prüfe erneut.
      Zum Anmelden öffnest du ein Projekt und startest dort die gewünschte CLI; folge deren Anmeldung im Terminal.
      Vorhandene CLI-Anmeldungen werden weiterverwendet. Ohne Anmeldung kannst du bereits die Shell verwenden.</p>
    <button type="button" className="btn" onClick={onProjects}>Projekt für CLI-Anmeldung öffnen</button>
  </section>;
}
