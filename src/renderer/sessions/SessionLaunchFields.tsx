import { localizeAppMessage } from '../../shared/i18n/appMessages';
import { t as translate } from "../../shared/i18n";
import { useLocale } from "../i18n/language";
import type { SessionLaunchChoice, SessionLaunchOptions } from '../../shared/remote';
import { SESSION_LAUNCH_LABELS } from '../../shared/sessionLaunch';
import './sessionLaunch.css';

export function canLaunchChoice(choice: SessionLaunchChoice, options?: SessionLaunchOptions): boolean {
  return choice.mode === 'shell' || !!options?.choices.find((item) => item.mode === choice.mode)?.available
    && (choice.mode !== 'ollama' || options.models.includes(choice.model));
}

/** Same controls and choice contract in the desktop dialog and mobile terminal. */
export function SessionLaunchFields({ choice, onChange, options, disabled, loading }: {
  choice: SessionLaunchChoice; onChange: (choice: SessionLaunchChoice) => void;
  options?: SessionLaunchOptions; disabled: boolean; loading: boolean;
}) {
  useLocale();
  return <div className="session-launch-fields">
    <label>{translate("Start the session with")}<select aria-label={translate("Start the session with")} disabled={disabled} value={choice.mode} onChange={(event) => {
      const mode = event.target.value as SessionLaunchChoice['mode'];
      onChange(mode === 'ollama' ? { mode, model: options?.models[0] ?? '' } : { mode });
    }}>{Object.entries(SESSION_LAUNCH_LABELS).map(([mode, label]) => <option key={mode} value={mode}
      disabled={mode === 'agent' ? options?.choices.find((item) => item.mode === mode)?.available === false : mode !== 'shell' && !options?.choices.find((item) => item.mode === mode)?.available}>{label}</option>)}</select></label>
    {choice.mode === 'ollama' && <label>{translate("Ollama model")}<select aria-label={translate("Ollama model")} disabled={disabled || loading} value={choice.model}
      onChange={(event) => onChange({ mode: 'ollama', model: event.target.value })}>
      {!options?.models.includes(choice.model) && <option value={choice.model}>{translate("Re-select the model")}</option>}
      {options?.models.map((model) => <option key={model} value={model}>{model}</option>)}</select></label>}
    {loading && <p role="status">{translate("Checking launch options…")}</p>}
    {options && <p>{translate("Environment:")}{" "}{options.environment}</p>}
    {options?.choices.find((item) => item.mode === choice.mode)?.notice && <p>{localizeAppMessage(options.choices.find((item) => item.mode === choice.mode)!.notice)}</p>}
    {!loading && options && <details><summary>{translate("Availability of CLI")}</summary><ul>{options.choices.filter((item) => !item.available).map((item) =>
      <li key={item.mode}>{localizeAppMessage(item.notice)}</li>)}</ul><p>{translate("The detection checks installation and model list. Login and runtime errors appear in the terminal.")}</p></details>}
    <p>{translate("This selection is valid for the new session.")}</p>
  </div>;
}
