import { localizeAppMessage } from '../../shared/i18n/appMessages';
import { t as translate } from "../../shared/i18n";
import { useLocale } from "../i18n/language";
import { useRef, useState } from 'react';
import type { RunTaskSubmitInput } from '../../shared/types';
import { Modal } from '../onboarding/Modal';
import { useAppData } from '../stores/appdata';

/** Same main-owned single-task command as mobile; retry retains the exact payload/key. */
export function SingleTaskModal({ initialAgent, initialRepository, onClose, onSubmitted }: {
  initialAgent: string; initialRepository: string; onClose: () => void; onSubmitted: (runId: string) => void;
}) {
  useLocale();
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
  return <Modal title={translate("Assign agent work")} onClose={() => { if (!sending.current) onClose(); }} fallbackFocus={() => document.getElementById('mode-tab-work')}>
    <p>{translate("Send an job to an agent in the selected project. The agent works on your PC; the progress appears under jobs and in the graph.")}</p>
    <fieldset disabled={busy || !!pending.current} className="work-task-fields">
      <label>{translate("Project")}<select aria-label={translate("Project")} value={repositoryId} onChange={event => setRepositoryId(event.target.value)}><option value="">{translate("Choose project")}</option>{repositories.map(repo => <option key={repo.id} value={repo.id}>{repo.name}</option>)}</select></label>
      <label>{translate("Agent")}<select aria-label={translate("Agent")} value={agentId} onChange={event => setAgentId(event.target.value)}><option value="">{translate("Choose agent")}</option>{Object.values(agents).map(agent => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select></label>
      <label>{translate("Instructions")}<textarea aria-label={translate("Instructions")} rows={7} maxLength={8000} value={prompt} onChange={event => setPrompt(event.target.value)} /></label>
      <label><input type="checkbox" checked={allowQuestions} onChange={event => setAllowQuestions(event.target.checked)} /> {" "}{translate("Allow for questions (Codex)")}</label>
    </fieldset>
    {(!repositories.length || !Object.keys(agents).length) && <p>{translate("First, create a project and an agent in ADE.")}</p>}
    {error && <p role="alert">{localizeAppMessage(error)} {" "}{translate("A re-attempt will use the same job. Check the run list before a new job.")}</p>}
    <div className="modal-actions"><button disabled={busy} onClick={onClose}>{translate("Close")}</button><button disabled={busy || !agentId || !repositoryId || !prompt.trim()} onClick={() => void submit()}>{busy ? translate("Sending… [57697264]") : pending.current ? translate("Try again") : translate("Send task")}</button></div>
  </Modal>;
}
