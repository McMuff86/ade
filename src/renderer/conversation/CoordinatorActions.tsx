import { localizeAppMessage } from '../../shared/i18n/appMessages';
import { t as translate } from "../../shared/i18n";
import { localizedLabels } from "../../shared/i18n/labels";
import { useLocale } from "../i18n/language";
import { useEffect, useRef, useState } from 'react';
import type { CoordinatorActionCommand, CoordinatorActionDetail, CoordinatorActionReceipt, CoordinatorActionSummary, CoordinatorActionWork } from '../../shared/coordinatorActions';
import { ResultDetails } from '../graph/ResultDetails';
import { QuestionCard, type RunQuestionsPort } from '../graph/RunQuestionsPanel';

export interface CoordinatorActionsPort {
  list(conversationId: string): Promise<CoordinatorActionSummary[]>;
  detail(conversationId: string, actionId: string): Promise<CoordinatorActionDetail>;
  work(conversationId: string, actionId: string): Promise<CoordinatorActionWork>;
  command(input: CoordinatorActionCommand): Promise<CoordinatorActionReceipt>;
  questions: RunQuestionsPort;
}
const STATES = localizedLabels(() => ({ proposed: translate("Proposal waiting for your decision"), dismissed: translate("Rejected"), dispatching: translate("Execution is confirmed"), applied: translate("Recorded in ADE"), uncertain: translate("Execution not confirmed") }));
const TASKS: Record<string, string> = localizedLabels(() => ({ queued: translate("Waiting for an available slot"), running: translate("Codex is working"), completed: translate("Completed"), failed: translate("Failed"), cancelled: translate("Aborted") }));
export function CoordinatorActions({ conversationId, port, online, canWrite, canConfirm }: { conversationId: string; port: CoordinatorActionsPort; online: boolean; canWrite: boolean; canConfirm: boolean }) {
  useLocale();
  const [actions, setActions] = useState<CoordinatorActionSummary[] | null>(null); const [error, setError] = useState(''); const [reload, setReload] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    let live = true; let timer: ReturnType<typeof setTimeout> | undefined;
    setActions(null); setError('');
    const refresh = async () => {
      if (!online) return;
      try { const value = await port.list(conversationId); if (live) { setActions(value); setError(''); } }
      catch (reason) { if (live) { setActions(null); setError(reason instanceof Error ? reason.message : translate("Jobs could not be loaded.")); } }
      finally { if (live) timer = setTimeout(() => { void refresh(); }, 2000); }
    };
    void refresh(); return () => { live = false; if (timer) clearTimeout(timer); };
  }, [conversationId, port, online, reload]);
  return <section className="conversation-actions" aria-label={translate("Handoffs and project jobs")}>
    <h3 ref={heading} tabIndex={-1}>{translate("Handoffs and project jobs")}</h3>
    {!online && <p role="status">{translate("PC not connected. Check jobs after reconnection.")}</p>}
    {error && <p role="alert">{localizeAppMessage(error)} <button type="button" disabled={!online} onClick={() => setReload(n => n + 1)}>{translate("Reload jobs")}</button></p>}
    {!actions && !error && online && <p role="status">{translate("Loading jobs…")}</p>}
    {actions?.length === 0 && <p>{translate('Ask ADE to create a project from this conversation, save a handoff or prepare a project job. Your proposal will appear here.')}</p>}
    {actions?.map(action => <ActionCard key={action.id} action={action} port={port} online={online} canWrite={canWrite} canConfirm={canConfirm}
      changed={() => { heading.current?.focus(); setReload(n => n + 1); }} />)}
  </section>;
}
function ActionCard({ action, port, online, canWrite, canConfirm, changed }: { action: CoordinatorActionSummary; port: CoordinatorActionsPort; online: boolean; canWrite: boolean; canConfirm: boolean; changed(): void }) {
  useLocale();
  const [detail, setDetail] = useState<CoordinatorActionDetail | null>(null); const [work, setWork] = useState<CoordinatorActionWork | null>(null);
  const [expanded, setExpanded] = useState(action.kind === 'project'); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const live = useRef(true); const lock = useRef(false); const header = useRef<HTMLHeadingElement>(null);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  useEffect(() => {
    let active = true; let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = async () => {
      if (!online || !expanded) return;
      try {
        if (action.kind === 'handoff' || action.kind === 'project') { const value = await port.detail(action.conversationId, action.id); if (active) setDetail(value); }
        if (action.runId) { const value = await port.work(action.conversationId, action.id); if (active) setWork(value); }
        if (active) setError('');
      } catch (reason) { if (active) { setDetail(null); setWork(null); setError(reason instanceof Error ? reason.message : translate("Job details could not be loaded.")); } }
      finally { if (active && action.runId && ['queued', 'running'].includes(action.taskStatus ?? '')) timer = setTimeout(() => { void refresh(); }, 2000); }
    };
    void refresh(); return () => { active = false; if (timer) clearTimeout(timer); };
  }, [action.id, action.state, action.taskStatus, action.pendingQuestions, port, online, expanded]);
  const command = async (operation: 'confirm' | 'dismiss') => {
    if (lock.current || !online || !canWrite || !canConfirm) return;
    lock.current = true; setBusy(true); setError(''); header.current?.focus();
    // Action content and identity live on the host. This deterministic key also
    // survives browser reload after a lost command acknowledgement.
    try { await port.command({ operation, conversationId: action.conversationId, actionId: action.id, commandId: `action-${operation}-${action.id}` }); if (live.current) changed(); }
    catch (reason) { if (live.current) setError(reason instanceof Error ? reason.message : translate("The decision could not be confirmed. Check the job status again.")); }
    finally { lock.current = false; if (live.current) setBusy(false); }
  };
  const title = action.kind === 'project' ? translate('Project from conversation') : action.kind === 'handoff' ? translate('Handoff') : translate('Codex project job');
  return <article className="conversation-action" aria-label={`${title} · ${action.projectName}`} aria-busy={busy}>
    <h4 ref={header} tabIndex={-1}>{title} · {action.projectName}</h4>
    {action.agentName && <p>{translate("Profile:")}{" "}{action.agentName}</p>}
    {action.permissionMode && <p>{translate('Permission mode: {{mode}}', { mode: action.permissionMode === 'bypass' ? 'Bypass' : action.permissionMode })}</p>}
    <p role="status">{STATES[action.state]}{action.taskStatus ? ` · ${TASKS[action.taskStatus] ?? action.taskStatus}` : ''}</p>
    {action.kind === 'task' && action.state === 'proposed' && <p>{translate("Starts your own Codex task in this project. Results and queries appear in this task.")}</p>}
    {action.kind === 'project' && <p>{translate('Creates a new project with PROJECT.md and AGENTS.md, ready for coordinated project work.')}</p>}
    {action.startsWork && action.kind === 'project' && <p>{translate('Also starts the first task described in PROJECT.md with this profile. Results and questions appear here.')}</p>}
    {action.kind === 'task' && action.coordinatesProject && <p>{translate('Confirmation also sets this project to Coordinate. The existing checkout and branch are preserved; the job uses its own workspace.')}</p>}
    {action.kind === 'project' && action.state === 'applied' && <p role="status">{translate('Project created. You can open it under Projects or continue this context in a new conversation.')}</p>}
    {busy && <p role="status">{translate('Applying proposal…')}</p>}
    {action.pendingQuestions > 0 && <p role="status">{action.pendingQuestions}{" "}{translate("open question")}{action.pendingQuestions === 1 ? '' : 'n'}.</p>}
    {action.error && <p role="alert">{localizeAppMessage(action.error)}</p>}{error && <p role="alert">{localizeAppMessage(error)}</p>}
    {(action.kind !== 'task' || action.runId) && <button type="button" aria-expanded={expanded} disabled={!online} onClick={() => setExpanded(v => !v)}>
      {expanded ? translate("Close details") : action.kind === 'project' ? translate('Review project files') : action.kind === 'handoff' ? translate("Review handoff") : translate("Open result and questions")}</button>}
    {expanded && action.kind !== 'task' && !detail && !error && <p role="status">{translate('Loading proposal…')}</p>}
    {expanded && detail && action.kind === 'handoff' && <div className="conversation-text"><p>{detail.text}</p><p>{translate("Next step:")}{" "}{detail.nextStep || translate("Not yet established")}</p></div>}
    {expanded && detail?.project && <div className="conversation-project-preview">
      <p>{detail.project.githubRepo ? translate('Private GitHub repository in your signed-in account: {{name}}. The two files are committed and pushed.', { name: detail.project.githubRepo }) : translate('Local Git repository. No GitHub repository requested.')}</p>
      <details open><summary>PROJECT.md</summary><pre>{detail.project.context}</pre></details>
      <details><summary>AGENTS.md</summary><pre>{detail.project.agentsMd}</pre></details>
    </div>}
    {expanded && action.runId && !work && !error && <p role="status">{translate("Loading result and questions…")}</p>}
    {expanded && work && <>
      {work.task?.error && <p role="alert">{localizeAppMessage(work.task.error)}</p>}
      {work.task?.output?.text && <p className="conversation-text">{work.task.output.text}</p>}
      {work.task?.result && <ResultDetails result={work.task.result} idPrefix={`coordinator-${action.id}`} />}
      {!work.task?.result && !work.task?.output?.text && <p>{translate("There is still no completed response to this request.")}</p>}
      {work.questions.tasks.flatMap(task => task.questions.map(question => <QuestionCard key={question.id} question={question}
        runId={work.questions.runId} taskId={task.taskId} label={`${action.projectName} · ${task.agentName}`} port={port.questions}
        online={online} canAnswer={canWrite} onAnswered={changed} />))}
    </>}
    {action.state === 'proposed' && <div className="conversation-controls">
      <button type="button" disabled={busy || !online || !canWrite || !canConfirm || action.kind !== 'task' && !detail}
        onClick={() => void command('confirm')}>{action.kind === 'project' ? action.startsWork ? translate('Create project and start work') : translate('Create project from context') : action.kind === 'handoff' ? translate("Save handoff") : translate("Start job")}</button>
      <button type="button" disabled={busy || !online || !canWrite || !canConfirm} onClick={() => void command('dismiss')}>{translate("Discard proposal")}</button>
    </div>}
    {action.state === 'uncertain' && <p>{translate("The job is not restarted. Check the run status on the PC.")}</p>}
  </article>;
}
