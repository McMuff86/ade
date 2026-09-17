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
const STATES = { proposed: 'Vorschlag wartet auf deine Entscheidung', dismissed: 'Verworfen', dispatching: 'Ausführung wird bestätigt', applied: 'In ADE erfasst', uncertain: 'Ausführung nicht bestätigt' };
const TASKS: Record<string, string> = { queued: 'Wartet auf einen freien Platz', running: 'Codex arbeitet', completed: 'Abgeschlossen', failed: 'Fehlgeschlagen', cancelled: 'Abgebrochen' };
export function CoordinatorActions({ conversationId, port, online, canWrite, canConfirm }: { conversationId: string; port: CoordinatorActionsPort; online: boolean; canWrite: boolean; canConfirm: boolean }) {
  const [actions, setActions] = useState<CoordinatorActionSummary[] | null>(null); const [error, setError] = useState(''); const [reload, setReload] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    let live = true; let timer: ReturnType<typeof setTimeout> | undefined;
    setActions(null); setError('');
    const refresh = async () => {
      if (!online) return;
      try { const value = await port.list(conversationId); if (live) { setActions(value); setError(''); } }
      catch (reason) { if (live) { setActions(null); setError(reason instanceof Error ? reason.message : 'Aufträge konnten nicht geladen werden.'); } }
      finally { if (live) timer = setTimeout(() => { void refresh(); }, 2000); }
    };
    void refresh(); return () => { live = false; if (timer) clearTimeout(timer); };
  }, [conversationId, port, online, reload]);
  return <section className="conversation-actions" aria-label="Übergaben und Projektaufträge">
    <h3 ref={heading} tabIndex={-1}>Übergaben und Projektaufträge</h3>
    {!online && <p role="status">PC nicht verbunden. Aufträge nach Wiederverbindung prüfen.</p>}
    {error && <p role="alert">{error} <button type="button" disabled={!online} onClick={() => setReload(n => n + 1)}>Aufträge erneut laden</button></p>}
    {!actions && !error && online && <p role="status">Aufträge werden geladen…</p>}
    {actions?.length === 0 && <p>Noch keine Vorschläge. Bitte ADE um eine Übergabe oder einen Codex-Projektauftrag. Du entscheidest hier über Speichern oder Start.</p>}
    {actions?.map(action => <ActionCard key={action.id} action={action} port={port} online={online} canWrite={canWrite} canConfirm={canConfirm}
      changed={() => { heading.current?.focus(); setReload(n => n + 1); }} />)}
  </section>;
}
function ActionCard({ action, port, online, canWrite, canConfirm, changed }: { action: CoordinatorActionSummary; port: CoordinatorActionsPort; online: boolean; canWrite: boolean; canConfirm: boolean; changed(): void }) {
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
      } catch (reason) { if (active) { setDetail(null); setWork(null); setError(reason instanceof Error ? reason.message : 'Auftragsdetails konnten nicht geladen werden.'); } }
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
    catch (reason) { if (live.current) setError(reason instanceof Error ? reason.message : 'Entscheidung konnte nicht bestätigt werden. Auftragsstand erneut prüfen.'); }
    finally { lock.current = false; if (live.current) setBusy(false); }
  };
  return <article className="conversation-action" aria-label={`${action.kind === 'handoff' ? 'Übergabe' : 'Projektauftrag'} · ${action.projectName}`}>
    <h4 ref={header} tabIndex={-1}>{action.kind === 'handoff' ? 'Übergabe' : 'Codex-Projektauftrag'} · {action.projectName}</h4>
    {action.agentName && <p>Profil: {action.agentName}</p>}
    <p role="status">{STATES[action.state]}{action.taskStatus ? ` · ${TASKS[action.taskStatus] ?? action.taskStatus}` : ''}</p>
    {action.kind === 'task' && action.state === 'proposed' && <p>Startet eine eigene Codex-Aufgabe in diesem Projekt. Ergebnisse und Rückfragen erscheinen bei diesem Auftrag.</p>}
    {action.pendingQuestions > 0 && <p role="status">{action.pendingQuestions} offene Rückfrage{action.pendingQuestions === 1 ? '' : 'n'}.</p>}
    {action.error && <p role="alert">{action.error}</p>}{error && <p role="alert">{error}</p>}
    {(action.kind === 'handoff' || action.runId) && <button type="button" aria-expanded={expanded} disabled={!online} onClick={() => setExpanded(v => !v)}>
      {expanded ? 'Details schliessen' : action.kind === 'handoff' ? 'Übergabe prüfen' : 'Ergebnis und Rückfragen öffnen'}</button>}
    {expanded && action.kind === 'handoff' && !detail && !error && <p role="status">Übergabe wird geladen…</p>}
    {expanded && detail && <div className="conversation-text"><p>{detail.text}</p><p>Nächster Schritt: {detail.nextStep || 'Noch nicht festgelegt'}</p></div>}
    {expanded && action.runId && !work && !error && <p role="status">Ergebnis und Rückfragen werden geladen…</p>}
    {expanded && work && <>
      {work.task?.error && <p role="alert">{work.task.error}</p>}
      {work.task?.output?.text && <p className="conversation-text">{work.task.output.text}</p>}
      {work.task?.result && <ResultDetails result={work.task.result} idPrefix={`coordinator-${action.id}`} />}
      {!work.task?.result && !work.task?.output?.text && <p>Für diesen Auftrag liegt noch keine abgeschlossene Antwort vor.</p>}
      {work.questions.tasks.flatMap(task => task.questions.map(question => <QuestionCard key={question.id} question={question}
        runId={work.questions.runId} taskId={task.taskId} label={`${action.projectName} · ${task.agentName}`} port={port.questions}
        online={online} canAnswer={canWrite} onAnswered={changed} />))}
    </>}
    {action.state === 'proposed' && <div className="conversation-controls">
      <button type="button" disabled={busy || !online || !canWrite || !canConfirm || action.kind === 'handoff' && !detail}
        onClick={() => void command('confirm')}>{action.kind === 'handoff' ? 'Übergabe speichern' : 'Auftrag starten'}</button>
      <button type="button" disabled={busy || !online || !canWrite || !canConfirm} onClick={() => void command('dismiss')}>Vorschlag verwerfen</button>
    </div>}
    {action.state === 'uncertain' && <p>Der Auftrag wird nicht erneut gestartet. Prüfe den Run-Stand am PC.</p>}
  </article>;
}
