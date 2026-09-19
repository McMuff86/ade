import { intlLocale } from '../../shared/i18n';
import { t as translate } from "../../shared/i18n";
import { useLocale } from "../i18n/language";
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
  useLocale();
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
    }).catch(() => { if (live) setError(translate("Could not load the model list. Refresh again.")); })
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
        {(!value || runtime === 'claude' && !newProfile) && <option value="">{runtime === 'claude' && !newProfile ? translate("Keep CLI setting") : busy ? translate("Loading models…") : translate("Choose model")}</option>}
        {value && !selected && <option value={value}>{value} · {busy ? translate("checking") : translate("Not confirmed")}</option>}
        {models.map((model) => <option key={model.id} value={model.id}>{optionLabel(model)}</option>)}
      </select>
    </div>
    <div className="runtime-model-status" id={`${id}-status`} role="status">
      {busy ? runtime === 'ollama' ? translate("Loading available models from Ollama…") : translate("Loading models from your CLI account…") : error || active?.message}
      <span>{backend === 'native' ? translate("Native environment of this PC") : backend}</span>
      {!busy && active?.checkedAt && <span>{translate("Checked at")}{" "}{new Date(active.checkedAt).toLocaleTimeString(intlLocale())}</span>}
    </div>
    {selected && <p className="runtime-model-status">{translate("Model:")}{" "}{selected.resolvedModel ?? selected.id}</p>}
    {selected?.description && <p className="repo-hint">{selected.description}</p>}
    {!busy && value && !selected && <p className="repo-hint">{translate("The selected model ID is retained. Its availability could not be confirmed at the last retrieval.")}</p>}
    <button type="button" className="btn" disabled={busy} onClick={() => setRefresh((count) => count + 1)}>{translate("Refresh models")}</button>
    {onEffortChange && effort && <div className="field runtime-model-effort">
      <label htmlFor={id.replace(/model$/, 'reasoning')}>{translate("Reasoning effort")}</label>
      <select id={id.replace(/model$/, 'reasoning')} value={effort} onChange={(event) => onEffortChange(event.target.value as CodexReasoningEffort)}>
        {!availableEfforts.some((item) => item.id === effort) && <option value={effort}>{effort} {" "}{translate("· Not reported by the model")}</option>}
        {availableEfforts.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
      </select>
    </div>}
    <details className="runtime-model-manual"><summary>{translate("Specify model ID manually")}</summary>
      <p className="repo-hint">{translate("For own model names or an unavailable model list. Manual information is not confirmed as available.")}</p>
      <label htmlFor={`${id}-manual`}>{translate("Model ID")}</label>
      <div><input id={`${id}-manual`} value={manual} maxLength={runtime === 'ollama' ? 200 : 100} onChange={(event) => { setManual(event.target.value); setManualError(''); }} />
        <button type="button" className="btn" disabled={!manual.trim()} onClick={() => {
          const pattern = runtime === 'claude' ? CLAUDE_MODEL_PATTERN : runtime === 'ollama' ? OLLAMA_MODEL_PATTERN : CODEX_MODEL_PATTERN;
          if (!pattern.test(manual.trim())) { setManualError(translate("This model ID contains invalid characters.")); return; }
          pick(manual.trim()); setManual(''); setManualError('');
        }}>{translate("Apply")}</button></div>
      {manualError && <p role="alert">{manualError}</p>}
    </details>
  </div>;
}
