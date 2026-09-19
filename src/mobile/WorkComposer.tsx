import { localizeAppMessage } from '../shared/i18n/appMessages';
import { intlLocale } from '../shared/i18n';
import { t as translate } from "../shared/i18n";
import { useLocale } from "../renderer/i18n/language";
import type { JSX } from 'react';
import type { MobileCatalog } from '../shared/remote';
import { Avatar } from '../renderer/rail/Avatar';
import { runtimeVisual } from '../renderer/graph/runtimeGlyphs';
import { Dialog } from './ui';
import type { MobileHost, PendingCommand } from './useMobileHost';

export interface WorkDraft { mode: 'task' | 'run'; repositoryId: string; agentIds: string[]; name: string; prompt: string; minutes: number; cost: string; allowQuestions?: boolean }
export const emptyDraft = (): WorkDraft => ({ mode: 'task', repositoryId: '', agentIds: [], name: '', prompt: '', minutes: 30, cost: '' });

export function PendingNotice({ host, onRetry }: { host: MobileHost; onRetry: (command: PendingCommand) => void }): JSX.Element | null {
  useLocale();
  if (!host.pending || host.busy) return null;
  return <section className="m-uncertain" aria-label={translate("Unconfirmed request")}><h3>{translate("Answer still unclear")}</h3>
    <p>{translate("The job could have already been accepted, and a re-attempt uses the same task ID.")}</p>
    <div className="m-actions"><button disabled={host.status !== 'online'} onClick={() => { if (host.pending) onRetry(host.pending); }}>{translate("Check this request again")}</button>
      <button onClick={host.dismissPending}>{translate("Check the Run List Yourself")}</button></div>
  </section>;
}

export function WorkComposer({ draft, setDraft, catalog, host, onSend, onClose }: {
  draft: WorkDraft; setDraft: (draft: WorkDraft) => void; catalog: MobileCatalog | null; host: MobileHost;
  onSend: (command: PendingCommand) => void; onClose: () => void;
}): JSX.Element {
  useLocale();
  const run = draft.mode === 'run';
  const patch = (value: Partial<WorkDraft>) => setDraft({ ...draft, ...value });
  const limit = run ? 1000 : 8000;
  const disabled = !host.canSubmit || !draft.repositoryId || !draft.prompt.trim() || draft.prompt.length > limit
    || (run ? draft.agentIds.length < 2 || !draft.name.trim() : draft.agentIds.length === 0);
  return <Dialog title={run ? translate("New Run") : translate("Assign agent work")} onClose={onClose} fallbackId="mobile-title" className="m-composer-dialog">
    <p className="m-dialog-intro">{run ? translate("Put together agents, set goal and budget, then start the prepared run.") : translate("Choose project and agent. The job runs on your PC; the progress appears under jobs.")}</p>
    {host.error && <p className="m-alert" role="alert">{localizeAppMessage(host.error)}</p>}
    {host.status !== 'online' && <p className="m-notice" role="status">{translate("Offline. Your draft is preserved; reconnect to send.")}</p>}
    <PendingNotice host={host} onRetry={onSend} />
    {!catalog ? <p role="status">{translate("Loading projects and agents…")}</p> : !catalog.repositories.length || !catalog.agents.length
      ? <p className="m-empty-copy">{translate("On the PC first set up a repository and an agent in ADE.")}</p>
      : <form onSubmit={(event) => {
        event.preventDefault(); if (disabled) return;
        const payload = !run ? { agentId: draft.agentIds[0], repositoryId: draft.repositoryId, prompt: draft.prompt,
          ...(draft.name.trim() ? { name: draft.name.trim() } : {}) }
          : { name: draft.name.trim(), goal: draft.prompt, repositoryId: draft.repositoryId,
            participants: draft.agentIds.map((agentId, index) => ({ agentId, role: index === 0 ? 'orchestrator' : index === 1 ? 'lead' : 'worker',
              ...(index > 0 ? { teamId: 'mobile-team', teamName: translate("Mobile team") } : {}) })),
            budget: { maxConcurrentTasks: Math.min(2, draft.agentIds.length), maxTaskMinutes: draft.minutes, maxCostUsd: draft.cost ? Number(draft.cost) : null } };
        onSend({ path: run ? '/api/v1/runs' : '/api/v1/tasks', payload: { ...payload, ...(draft.allowQuestions ? { allowQuestions: true } : {}) }, key: crypto.randomUUID() });
      }}>
        <fieldset disabled={host.busy || !!host.pending}><legend>{translate("Job type")}</legend>
          <div className="m-mode-choice"><label><input type="radio" name="mode" checked={!run} onChange={() => patch({ mode: 'task', agentIds: draft.agentIds.slice(0, 1) })} />{translate("Individual task")}</label>
            <label><input type="radio" name="mode" checked={run} onChange={() => patch({ mode: 'run' })} />{translate("Managed Run")}</label></div>
          <label>{translate("Repository")}<select aria-label={translate("Repository")} value={draft.repositoryId} onChange={(event) => patch({ repositoryId: event.target.value })} required>
            {catalog.repositories.map((repo) => <option key={repo.id} value={repo.id}>{repo.name}{repo.verified ? '' : translate(" · Unchecked")}</option>)}</select></label>
          {!run ? <label>{translate("Agent")}<select aria-label={translate("Agent")} value={draft.agentIds[0] ?? ''} onChange={(event) => patch({ agentIds: [event.target.value] })} required>
            <option value="" disabled>{translate("Choose agent")}</option>{catalog.agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name} · {runtimeVisual(agent.runtime).label}</option>)}</select></label>
            : <fieldset className="m-roster"><legend>{translate("Agents · Order determines the roles")}</legend>{catalog.agents.map((agent) => {
              const index = draft.agentIds.indexOf(agent.id);
              return <label className="m-roster-agent" key={agent.id}><input type="checkbox" aria-label={agent.name} checked={index >= 0}
                onChange={(event) => patch({ agentIds: event.target.checked ? [...draft.agentIds, agent.id] : draft.agentIds.filter((id) => id !== agent.id) })} />
                <Avatar name={agent.name} runtime={agent.runtime} size={28} /><span><strong>{agent.name}</strong><small>{runtimeVisual(agent.runtime).label}</small></span>
                <span className="m-role">{index === 0 ? translate("1 · Coordination") : index === 1 ? '2 · Lead' : index > 1 ? `${index + 1} · Worker` : ''}</span></label>;
            })}</fieldset>}
          <label><input type="checkbox" checked={draft.allowQuestions === true} onChange={(event) => patch({ allowQuestions: event.target.checked })} />{translate("Allow questions (native Codex agents)")}</label>
          <label>{run ? translate("Run name") : translate("Name (optional)")}<input value={draft.name} onChange={(event) => patch({ name: event.target.value })} maxLength={80} required={run} /></label>
          <label>{run ? translate("Objective") : translate("Task")}<textarea aria-label={run ? translate("Objective") : translate("Task")} value={draft.prompt} onChange={(event) => patch({ prompt: event.target.value })}
            rows={5} maxLength={limit} required placeholder={translate("What should ADE do for you?")} /></label>
          <p className={draft.prompt.length > limit ? 'm-error-copy' : 'm-field-note'}>{draft.prompt.length.toLocaleString(intlLocale())} / {limit.toLocaleString(intlLocale())} {" "}{translate("Characters")}{draft.prompt.length > limit ? translate(" · Please shorten the text; your draft has been preserved.") : ''}</p>
          {run && <div className="m-budget-fields"><label>{translate("Minutes per task")}<input type="number" min={1} max={1440} required value={draft.minutes} onChange={(event) => patch({ minutes: Number(event.target.value) })} /></label>
            <label>{translate("Cost limit USD (optional)")}<input type="number" min="0.01" step="0.01" value={draft.cost} onChange={(event) => patch({ cost: event.target.value })} /></label></div>}
          {run && draft.agentIds.length < 2 && <p className="m-field-note">{translate("Choose at least two agents: coordination and implementation.")}</p>}
          <div className="m-actions"><button className="m-primary" disabled={disabled}>{host.busy ? translate("Confirming…") : run ? translate("Prepare the Run") : translate("Start task")}</button>
            <button type="button" onClick={onClose}>{translate("Keep draft and close")}</button></div>
        </fieldset>
      </form>}
  </Dialog>;
}
