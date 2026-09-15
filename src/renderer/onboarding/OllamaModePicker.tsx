export function OllamaModePicker({ id, value, onChange }: {
  id: string; value: 'chat' | 'coding'; onChange(value: 'chat' | 'coding'): void;
}): React.ReactElement {
  return <div className="field">
    <label htmlFor={id}>Ollama verwenden als</label>
    <select id={id} value={value} aria-describedby={`${id}-hint`} onChange={event => onChange(event.target.value as 'chat' | 'coding')}>
      <option value="coding">Coding-Agent · Codex CLI mit Ollama</option>
      <option value="chat">Direkter Modellchat · Ollama</option>
    </select>
    <p className="repo-hint" id={`${id}-hint`}>{value === 'coding'
      ? 'Die Codex CLI liest und bearbeitet Dateien mit dem ausgewählten Ollama-Modell. Beide Programme müssen in dieser Umgebung installiert sein. Wähle ein Modell mit Werkzeugunterstützung. Für diese Ollama-Sitzungen ist die Verbrauchserfassung noch nicht angebunden.'
      : 'Direkter Chat mit dem Modell. Dieser Modus kann selbst keine Projektdateien lesen, ändern oder Tests ausführen.'}</p>
  </div>;
}
