import { useRef, useState } from 'react';
import type { RunTaskSubmitInput } from '../../shared/types';
import { Modal } from '../onboarding/Modal';
import { useAppData } from '../stores/appdata';

/** Same main-owned single-task command as mobile; retry retains the exact payload/key. */
export function SingleTaskModal({ initialAgent, initialRepository, onClose, onSubmitted }: {
  initialAgent: string; initialRepository: string; onClose: () => void; onSubmitted: (runId: string) => void;
}) {
  const { agents, repositories } = useAppData();
  const [agentId, setAgentId] = useState(initialAgent);
  const [repositoryId, setRepositoryId] = useState(initialRepository || (repositories.length === 1 ? repositories[0]!.id : ''));
  const [prompt, setPrompt] = useState('');
  const [allowQuestions, setAllowQuestions] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef<RunTaskSubmitInput | null>(null);
  const sending = useRef(false);
  const submit = async () => {
    if (sending.current) return;
    sending.current = true; setBusy(true); setError('');
    pending.current ??= { agentId, repositoryId, prompt, allowQuestions, commandId: crypto.randomUUID() };
    try { const result = await window.ade.invoke('runTask:submit', pending.current); onSubmitted(result.run.id); }
    catch (reason) { setError(String(reason)); }
    finally { sending.current = false; setBusy(false); }
  };
  return <Modal title="Agent beauftragen" onClose={() => { if (!sending.current) onClose(); }} fallbackFocus={() => document.getElementById('mode-tab-work')}>
    <p>Einen Auftrag an einen Agenten im ausgewählten Projekt senden. Der Agent arbeitet auf deinem PC; der Fortschritt erscheint unter Aufträge und im Graph.</p>
    <fieldset disabled={busy || !!pending.current} className="work-task-fields">
      <label>Projekt<select aria-label="Projekt" value={repositoryId} onChange={event => setRepositoryId(event.target.value)}><option value="">Projekt wählen</option>{repositories.map(repo => <option key={repo.id} value={repo.id}>{repo.name}</option>)}</select></label>
      <label>Agent<select aria-label="Agent" value={agentId} onChange={event => setAgentId(event.target.value)}><option value="">Agent wählen</option>{Object.values(agents).map(agent => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select></label>
      <label>Anweisung<textarea aria-label="Anweisung" rows={7} maxLength={8000} value={prompt} onChange={event => setPrompt(event.target.value)} /></label>
      <label><input type="checkbox" checked={allowQuestions} onChange={event => setAllowQuestions(event.target.checked)} /> Rückfragen erlauben (Codex)</label>
    </fieldset>
    {(!repositories.length || !Object.keys(agents).length) && <p>Lege zuerst ein Projekt und einen Agenten in ADE an.</p>}
    {error && <p role="alert">{error} Ein erneuter Versuch verwendet denselben Auftrag. Prüfe vor einem neuen Auftrag die Run-Liste.</p>}
    <div className="modal-actions"><button disabled={busy} onClick={onClose}>Schliessen</button><button disabled={busy || !agentId || !repositoryId || !prompt.trim()} onClick={() => void submit()}>{busy ? 'Wird gesendet…' : pending.current ? 'Erneut versuchen' : 'Aufgabe senden'}</button></div>
  </Modal>;
}
