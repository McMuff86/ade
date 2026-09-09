import { useEffect, useRef, useState } from 'react';
import type { ExecutionBackendId } from '../../shared/executionBackends';
import type { ModelRuntime, RuntimeModelCatalog, RuntimeModelOption } from '../../shared/runtimeModels';
import type { CodexReasoningEffort } from '../../shared/types';
import { CLAUDE_MODEL_PATTERN, CODEX_MODEL_PATTERN, OLLAMA_MODEL_PATTERN } from '../../shared/runtimes';
import { CODEX_REASONING_EFFORTS, GROK_REASONING_EFFORTS } from './agentOptions';
import './runtimeModels.css';

export function RuntimeModelPicker({ id, label, runtime, backend = 'native', value, onChange, effort, onEffortChange, newProfile = false }: {
  id: string; label: string; runtime: ModelRuntime; backend?: ExecutionBackendId; value: string; onChange: (value: string) => void;
  effort?: CodexReasoningEffort; onEffortChange?: (value: CodexReasoningEffort) => void; newProfile?: boolean;
}): React.ReactElement {
  const [catalog, setCatalog] = useState<RuntimeModelCatalog>();
  const [busy, setBusy] = useState(true); const [refresh, setRefresh] = useState(0); const [error, setError] = useState('');
  const [manual, setManual] = useState(''); const [manualError, setManualError] = useState('');
  const current = useRef({ value, effort, onChange, onEffortChange, newProfile });
  current.current = { value, effort, onChange, onEffortChange, newProfile };
  useEffect(() => {
    let live = true; setBusy(true); setError(''); setCatalog(undefined);
    void window.ade.invoke('harness:models', { runtime, backend }).then((result) => {
      if (!live) return; setCatalog(result);
      const state = current.current;
      if (state.newProfile && !state.value && result.models.length) {
        const chosen = result.models.find((model) => model.isDefault) ?? result.models[0]!;
        state.onChange(chosen.id);
        if (chosen.reasoningEfforts?.length && state.effort && !chosen.reasoningEfforts.includes(state.effort)) {
          state.onEffortChange?.(chosen.defaultReasoningEffort ?? chosen.reasoningEfforts[0]!);
        }
      }
    }).catch(() => { if (live) setError('Modellliste konnte nicht geladen werden. Erneut aktualisieren.'); })
      .finally(() => { if (live) setBusy(false); });
    return () => { live = false; };
  }, [runtime, backend, refresh]);
  const active = catalog?.runtime === runtime && catalog.backend === backend ? catalog : undefined;
  const models = active?.models ?? []; const selected = models.find((model) => model.id === value);
  const pick = (next: string) => {
    onChange(next); const option = models.find((model) => model.id === next);
    if (option?.reasoningEfforts?.length && effort && !option.reasoningEfforts.includes(effort)) {
      onEffortChange?.(option.defaultReasoningEffort ?? option.reasoningEfforts[0]!);
    }
  };
  const genericEfforts = runtime === 'grok' ? GROK_REASONING_EFFORTS : CODEX_REASONING_EFFORTS;
  const availableEfforts = selected?.reasoningEfforts ? genericEfforts.filter((item) => selected.reasoningEfforts!.includes(item.id)) : genericEfforts;
  const optionLabel = (model: RuntimeModelOption) => `${model.name}${model.resolvedModel ? ` · ${model.resolvedModel}` : model.name !== model.id ? ` · ${model.id}` : ''}${model.isDefault ? ' · Standard' : ''}`;
  return <div className="runtime-model-picker">
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select id={id} value={value} aria-describedby={`${id}-status`} onChange={(event) => pick(event.target.value)}>
        {(!value || runtime === 'claude' && !newProfile) && <option value="">{runtime === 'claude' && !newProfile ? 'CLI-Einstellung beibehalten' : busy ? 'Modelle werden geladen…' : 'Modell wählen'}</option>}
        {value && !selected && <option value={value}>{value} · {busy ? 'wird geprüft' : 'nicht bestätigt'}</option>}
        {models.map((model) => <option key={model.id} value={model.id}>{optionLabel(model)}</option>)}
      </select>
    </div>
    <div className="runtime-model-status" id={`${id}-status`} role="status">
      {busy ? 'Modelle werden aus deiner CLI-Anmeldung geladen…' : error || active?.message}
      <span>{backend === 'native' ? 'Native Umgebung dieses PCs' : backend}</span>
      {!busy && active?.checkedAt && <span>Geprüft um {new Date(active.checkedAt).toLocaleTimeString()}</span>}
    </div>
    {selected && <p className="runtime-model-status">Modell: {selected.resolvedModel ?? selected.id}</p>}
    {selected?.description && <p className="repo-hint">{selected.description}</p>}
    {!busy && value && !selected && <p className="repo-hint">Die ausgewählte Modell-ID bleibt erhalten. Ihre Verfügbarkeit konnte beim letzten Abruf nicht bestätigt werden.</p>}
    <button type="button" className="btn" disabled={busy} onClick={() => setRefresh((count) => count + 1)}>Modelle aktualisieren</button>
    {onEffortChange && effort && <div className="field runtime-model-effort">
      <label htmlFor={id.replace(/model$/, 'reasoning')}>REASONING EFFORT</label>
      <select id={id.replace(/model$/, 'reasoning')} value={effort} onChange={(event) => onEffortChange(event.target.value as CodexReasoningEffort)}>
        {!availableEfforts.some((item) => item.id === effort) && <option value={effort}>{effort} · nicht vom Modell gemeldet</option>}
        {availableEfforts.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
      </select>
    </div>}
    <details className="runtime-model-manual"><summary>Modell-ID manuell angeben</summary>
      <p className="repo-hint">Für eigene Modellnamen oder eine nicht erreichbare Modellliste. Manuelle Angaben sind nicht als verfügbar bestätigt.</p>
      <label htmlFor={`${id}-manual`}>Modell-ID</label>
      <div><input id={`${id}-manual`} value={manual} maxLength={runtime === 'ollama' ? 200 : 100} onChange={(event) => { setManual(event.target.value); setManualError(''); }} />
        <button type="button" className="btn" disabled={!manual.trim()} onClick={() => {
          const pattern = runtime === 'claude' ? CLAUDE_MODEL_PATTERN : runtime === 'ollama' ? OLLAMA_MODEL_PATTERN : CODEX_MODEL_PATTERN;
          if (!pattern.test(manual.trim())) { setManualError('Diese Modell-ID enthält ungültige Zeichen.'); return; }
          pick(manual.trim()); setManual(''); setManualError('');
        }}>Übernehmen</button></div>
      {manualError && <p role="alert">{manualError}</p>}
    </details>
  </div>;
}
