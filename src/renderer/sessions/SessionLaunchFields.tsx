import type { SessionLaunchChoice, SessionLaunchOptions } from '../../shared/remote';
import { SESSION_LAUNCH_LABELS } from '../../shared/sessionLaunch';
import './sessionLaunch.css';

export function canLaunchChoice(choice: SessionLaunchChoice, options?: SessionLaunchOptions): boolean {
  return choice.mode === 'shell' || choice.mode === 'agent' || !!options?.choices.find((item) => item.mode === choice.mode)?.available
    && (choice.mode !== 'ollama' || options.models.includes(choice.model));
}

/** Same controls and choice contract in the desktop dialog and mobile terminal. */
export function SessionLaunchFields({ choice, onChange, options, disabled, loading }: {
  choice: SessionLaunchChoice; onChange: (choice: SessionLaunchChoice) => void;
  options?: SessionLaunchOptions; disabled: boolean; loading: boolean;
}) {
  return <div className="session-launch-fields">
    <label>Sitzung starten mit<select aria-label="Sitzung starten mit" disabled={disabled} value={choice.mode} onChange={(event) => {
      const mode = event.target.value as SessionLaunchChoice['mode'];
      onChange(mode === 'ollama' ? { mode, model: options?.models[0] ?? '' } : { mode });
    }}>{Object.entries(SESSION_LAUNCH_LABELS).map(([mode, label]) => <option key={mode} value={mode}
      disabled={mode !== 'shell' && mode !== 'agent' && !options?.choices.find((item) => item.mode === mode)?.available}>{label}</option>)}</select></label>
    {choice.mode === 'ollama' && <label>Ollama-Modell<select aria-label="Ollama-Modell" disabled={disabled || loading} value={choice.model}
      onChange={(event) => onChange({ mode: 'ollama', model: event.target.value })}>
      {!options?.models.includes(choice.model) && <option value={choice.model}>Modell neu auswählen</option>}
      {options?.models.map((model) => <option key={model} value={model}>{model}</option>)}</select></label>}
    {loading && <p role="status">Startmöglichkeiten werden geprüft…</p>}
    {options && <p>Umgebung: {options.environment}</p>}
    {options?.choices.find((item) => item.mode === choice.mode)?.notice && <p>{options.choices.find((item) => item.mode === choice.mode)!.notice}</p>}
    {!loading && options && <details><summary>Verfügbarkeit der CLIs</summary><ul>{options.choices.filter((item) => !item.available).map((item) =>
      <li key={item.mode}>{item.notice}</li>)}</ul><p>Die Erkennung prüft Installation und Modellliste. Anmeldung und Laufzeitfehler erscheinen im Terminal.</p></details>}
    <p>Diese Auswahl gilt nur für die neue Sitzung. Das Agent-Profil bleibt erhalten.</p>
  </div>;
}
