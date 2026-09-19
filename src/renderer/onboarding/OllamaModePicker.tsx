import { t as translate } from "../../shared/i18n";
import { useLocale } from "../i18n/language";
export function OllamaModePicker({ id, value, onChange, harness, onHarnessChange }: {
  id: string; value: 'chat' | 'coding'; onChange(value: 'chat' | 'coding'): void;
  harness: 'codex' | 'qwen-code'; onHarnessChange(value: 'codex' | 'qwen-code'): void;
}): React.ReactElement {
  useLocale();
  return <><div className="field">
    <label htmlFor={id}>{translate("Use Ollama as")}</label>
    <select id={id} value={value} aria-describedby={`${id}-hint`} onChange={event => onChange(event.target.value as 'chat' | 'coding')}>
      <option value="coding">{translate("Coding agent")}</option>
      <option value="chat">{translate("Direct model chat · Ollama")}</option>
    </select>
    <p className="repo-hint" id={`${id}-hint`}>{value === 'coding'
      ? translate("The selected coding harness reads and edits files using your Ollama model. Choose a model that supports tools.")
      : translate("Direct chat with the model. This mode itself cannot read, modify or test project files.")}</p>
  </div>
    {value === 'coding' && <div className="field">
      <label htmlFor={`${id}-harness`}>{translate("Coding harness")}</label>
      <select id={`${id}-harness`} value={harness} aria-describedby={`${id}-harness-hint`}
        onChange={event => onHarnessChange(event.target.value as 'codex' | 'qwen-code')}>
        <option value="codex">{translate("Codex CLI · Ollama")}</option>
        <option value="qwen-code">{translate("Qwen Code · Ollama")}</option>
      </select>
      <p className="repo-hint" id={`${id}-harness-hint`}>{harness === 'codex'
        ? translate("Requires Codex CLI and Ollama in the selected environment. Existing coding profiles still use Codex CLI.")
        : translate("Requires Qwen code and Ollama in the selected environment. Connects Qwen code to the local Ollama service (port 11434).")} {" "}{translate("For interactive Ollama sessions, usage recording is not yet connected.")}</p>
    </div>}
  </>;
}
