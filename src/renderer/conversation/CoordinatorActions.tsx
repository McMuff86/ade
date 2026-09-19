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
    {actions?.length === 0 && <p>{translate("No suggestions yet. Ask ADE for a handover or Codex project assignment. You'll decide whether to save or start here.")}</p>}
    {actions?.map(action => <ActionCard key={action.id} action={action} port={port} online={online} canWrite={canWrite} canConfirm={canConfirm}
      changed={() => { heading.current?.focus(); setReload(n => n + 1); }} />)}
  </section>;
}
function ActionCard({ action, port, online, canWrite, canConfirm, changed }: { action: CoordinatorActionSummary; port: CoordinatorActionsPort; online: boolean; canWrite: boolean; canConfirm: boolean; changed(): void }) {
  useLocale();
  const [detail, setDetail] = useState<CoordinatorActionDetail | null>(null); const [work, setWork] = useState<CoordinatorActionWork | null>(null);
  const [expanded, setExpanded] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const live = useRef(true); const lock = useRef(false); const header = useRef<HTMLHeadingElement>(null);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  useEffect(() => {
    let active = true; let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = async () => {
      if (!online || !expanded) return;
      try {
        if (action.kind === 'handoff') { const value = await port.detail(action.conversationId, action.id); if (active) setDetail(value); }
        else if (action.runId) { const value = await port.work(action.conversationId, action.id); if (active) setWork(value); }
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
  return <article className="conversation-action" aria-label={`${action.kind === 'handoff' ? translate("Handoff") : translate("Project job")} · ${action.projectName}`}>
    <h4 ref={header} tabIndex={-1}>{action.kind === 'handoff' ? translate("Handoff") : translate("Codex project job")} · {action.projectName}</h4>
    {action.agentName && <p>{translate("Profile:")}{" "}{action.agentName}</p>}
    <p role="status">{STATES[action.state]}{action.taskStatus ? ` · ${TASKS[action.taskStatus] ?? action.taskStatus}` : ''}</p>
    {action.kind === 'task' && action.state === 'proposed' && <p>{translate("Starts your own Codex task in this project. Results and queries appear in this task.")}</p>}
    {action.pendingQuestions > 0 && <p role="status">{action.pendingQuestions} {" "}{translate("open question")}{action.pendingQuestions === 1 ? '' : 'n'}.</p>}
    {action.error && <p role="alert">{localizeAppMessage(action.error)}</p>}{error && <p role="alert">{localizeAppMessage(error)}</p>}
    {(action.kind === 'handoff' || action.runId) && <button type="button" aria-expanded={expanded} disabled={!online} onClick={() => setExpanded(v => !v)}>
      {expanded ? translate("Close details") : action.kind === 'handoff' ? translate("Review handoff") : translate("Open result and questions")}</button>}
    {expanded && action.kind === 'handoff' && !detail && !error && <p role="status">{translate("Loading handoff…")}</p>}
    {expanded && detail && <div className="conversation-text"><p>{detail.text}</p><p>{translate("Next step:")}{" "}{detail.nextStep || translate("Not yet established")}</p></div>}
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
      <button type="button" disabled={busy || !online || !canWrite || !canConfirm || action.kind === 'handoff' && !detail}
        onClick={() => void command('confirm')}>{action.kind === 'handoff' ? translate("Save handoff") : translate("Start job")}</button>
      <button type="button" disabled={busy || !online || !canWrite || !canConfirm} onClick={() => void command('dismiss')}>{translate("Discard proposal")}</button>
    </div>}
    {action.state === 'uncertain' && <p>{translate("The job is not restarted. Check the run status on the PC.")}</p>}
  </article>;
}
