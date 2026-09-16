export function OllamaModePicker({ id, value, onChange, harness, onHarnessChange }: {
  id: string; value: 'chat' | 'coding'; onChange(value: 'chat' | 'coding'): void;
  harness: 'codex' | 'qwen-code'; onHarnessChange(value: 'codex' | 'qwen-code'): void;
}): React.ReactElement {
  return <><div className="field">
    <label htmlFor={id}>Ollama verwenden als</label>
    <select id={id} value={value} aria-describedby={`${id}-hint`} onChange={event => onChange(event.target.value as 'chat' | 'coding')}>
      <option value="coding">Coding-Agent</option>
      <option value="chat">Direkter Modellchat · Ollama</option>
    </select>
    <p className="repo-hint" id={`${id}-hint`}>{value === 'coding'
      ? 'Der gewählte Coding-Harness liest und bearbeitet Dateien mit deinem Ollama-Modell. Wähle ein Modell mit Werkzeugunterstützung.'
      : 'Direkter Chat mit dem Modell. Dieser Modus kann selbst keine Projektdateien lesen, ändern oder Tests ausführen.'}</p>
  </div>
    {value === 'coding' && <div className="field">
      <label htmlFor={`${id}-harness`}>Coding-Harness</label>
      <select id={`${id}-harness`} value={harness} aria-describedby={`${id}-harness-hint`}
        onChange={event => onHarnessChange(event.target.value as 'codex' | 'qwen-code')}>
        <option value="codex">Codex CLI · Ollama</option>
        <option value="qwen-code">Qwen Code · Ollama</option>
      </select>
      <p className="repo-hint" id={`${id}-harness-hint`}>{harness === 'codex'
        ? 'Benötigt Codex CLI und Ollama in der gewählten Umgebung. Bestehende Coding-Profile verwenden weiterhin Codex CLI.'
        : 'Benötigt Qwen Code und Ollama in der gewählten Umgebung. Verbindet Qwen Code mit dem dortigen lokalen Ollama-Dienst (Port 11434).'} Für interaktive Ollama-Sitzungen ist die Verbrauchserfassung noch nicht angebunden.</p>
    </div>}
  </>;
}
