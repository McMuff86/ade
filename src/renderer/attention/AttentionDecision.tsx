import { useEffect, useMemo, useRef, useState, type JSX } from 'react';
import { t } from '../../shared/i18n';
import { localizeAppMessage } from '../../shared/i18n/appMessages';
import { useLocale } from '../i18n/language';
import type { AttentionAction, AttentionActionBlock, AttentionRow } from '../../shared/attention';
import type { RunQuestionsView } from '../../shared/runQuestions';
import { QuestionCard, type QuestionDraft, type RunQuestionsPort } from '../graph/RunQuestionsPanel';
import { deliverInstruction, releaseInstruction, type AttentionDrafts, type DraftSlot, type InstructDraft, type InstructSend } from './attentionDrafts';

/** Surface adapters for the decision actions. Every call reuses an existing,
 * idempotent contract; a surface without `instruct` hands instructions to its terminal. */
export interface AttentionActionsPort {
  questions: RunQuestionsPort;
  cancel(runId: string, key: string): Promise<unknown>;
  instruct?(sessionId: string, text: string, commandId: string): Promise<{ accepted: true; replayed: boolean }>;
  takeInput?(sessionId: string): Promise<unknown>;
  /** Close a recorded interruption by its row id; the key makes a retry safe. */
  dismiss?(rowId: string, key: string): Promise<unknown>;
}

const blockLabel = (reason: AttentionActionBlock) => ({
  'read-only': t('This device may view this work but not change it.'),
  'prompt-unsupported': t('This session has no protected prompt path. Use its terminal directly.'),
  'prompt-not-ready': t('The CLI cannot take an instruction right now. Check its terminal.'),
  'other-device': t('Another device controls input. Take input first.'),
  'no-turn-control': t('Interrupting a running turn is not supported for interactive CLIs. ADE offers no pause; use the terminal.'),
})[reason];
const actionLabel = (kind: AttentionAction['kind']) => ({ answer: t('Answer question'), cancel: t('Cancel run'), instruct: t('Further instruction'),
  'take-input': t('Take input'), interrupt: t('Interrupt turn') })[kind];

export function AttentionDecision({ row, id, port, drafts, online, onChanged, onOpen, onClose }: {
  row: AttentionRow; id: string; port: AttentionActionsPort; drafts: AttentionDrafts; online: boolean;
  onChanged(): void; onOpen(): Promise<void>; onClose(): void;
}): JSX.Element {
  useLocale();
  const targetId = row.target?.id ?? '';
  return <div id={id} className="attention-decision" role="region" aria-label={t('Decision options: {{title}}', { title: row.title })}
    onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); onClose(); } }}>
    {row.actions.map(action => <section key={action.kind} data-attention-action={action.kind} aria-label={actionLabel(action.kind)}>
      <h4>{actionLabel(action.kind)}</h4>
      {!action.available ? <p className="attention-blocked">{blockLabel(action.reason)}</p>
        : action.kind === 'answer' ? <AttentionQuestions runId={targetId} rowId={row.id} port={port.questions} drafts={drafts} online={online} onChanged={onChanged} />
          : action.kind === 'cancel' ? <AttentionCancel runId={targetId} title={row.title} port={port} slotKey={`${row.id}:cancel`} drafts={drafts} online={online} onChanged={onChanged} />
            : action.kind === 'instruct' && port.instruct ? <AttentionInstruct send={(text, commandId) => port.instruct!(targetId, text, commandId)} slotKey={`${row.id}:instruct`}
              drafts={drafts} online={online} onOpen={onOpen} onChanged={onChanged} />
              : action.kind === 'instruct' ? <><p>{t('Instructions are sent from the terminal, after you take input there.')}</p>
                <button type="button" disabled={!online} onClick={() => void onOpen()}>{t('Instruct in terminal')}</button></>
                : <TakeInput sessionId={targetId} port={port} online={online} onOpen={onOpen} />}
    </section>)}
  </div>;
}

function AttentionQuestions({ runId, rowId, port, drafts, online, onChanged }: {
  runId: string; rowId: string; port: RunQuestionsPort; drafts: AttentionDrafts; online: boolean; onChanged(): void;
}): JSX.Element {
  useLocale();
  const [view, setView] = useState<RunQuestionsView | null>(null);
  const [error, setError] = useState(''); const [reload, setReload] = useState(0);
  // Loaded once per open decision and on explicit reload: a stale card stays visible
  // until the host rejects it, never silently re-targeted to a newer question.
  useEffect(() => {
    let live = true; if (!online) return;
    port.read(runId).then(value => { if (live) { setView(value); setError(''); } },
      reason => { if (live) setError(reason instanceof Error ? reason.message : t('Questions could not be loaded.')); });
    return () => { live = false; };
  }, [runId, port, online, reload]);
  const slots = useMemo(() => new Map<string, DraftSlot<QuestionDraft>>(), [drafts]);
  const slot = (key: string) => { if (!slots.has(key)) slots.set(key, drafts.slot<QuestionDraft>(key)); return slots.get(key)!; };
  const cards = view?.tasks.flatMap(task => task.questions.map(question => ({ task, question }))) ?? [];
  return <div className="attention-questions">
    {error && <p role="alert">{localizeAppMessage(error)}</p>}
    {!view && !error && <p role="status">{t('Loading questions…')}</p>}
    {view && !cards.length && <p role="status">{t('No open questions.')}</p>}
    {cards.map(({ task, question }) => <QuestionCard key={question.id} question={question} taskId={task.taskId} runId={runId}
      label={`${task.agentName} · ${task.title}`} port={port} online={online} canAnswer
      draft={slot(`${rowId}:${task.taskId}:${question.id}`)} onAnswered={() => { setReload(value => value + 1); onChanged(); }} />)}
    <button type="button" disabled={!online} onClick={() => setReload(value => value + 1)}>{t('Reload questions')}</button>
  </div>;
}

interface CancelDraft { key: string; state: 'confirm' | 'unconfirmed'; message?: string }

function AttentionCancel({ runId, title, port, slotKey, drafts, online, onChanged }: {
  runId: string; title: string; port: AttentionActionsPort; slotKey: string; drafts: AttentionDrafts; online: boolean; onChanged(): void;
}): JSX.Element {
  useLocale();
  const slot = useMemo(() => drafts.slot<CancelDraft>(slotKey), [drafts, slotKey]);
  const [draft, setDraft] = useState<CancelDraft | undefined>(() => slot.read());
  const [busy, setBusy] = useState(false); const [done, setDone] = useState(false);
  const lock = useRef(false);
  const update = (value: CancelDraft | undefined) => { slot.write(value); setDraft(value); };
  const send = async () => {
    if (!draft || lock.current || !online) return;
    lock.current = true; setBusy(true);
    try { await port.cancel(runId, draft.key); update(undefined); setDone(true); onChanged(); }
    catch (reason) { update({ ...draft, state: 'unconfirmed', message: reason instanceof Error ? reason.message : String(reason) }); }
    finally { lock.current = false; setBusy(false); }
  };
  if (done) return <p role="status">{t('Cancellation confirmed. Work already created remains in ADE.')}</p>;
  if (!draft) return <button type="button" className="attention-danger" disabled={!online} onClick={() => update({ key: crypto.randomUUID(), state: 'confirm' })}>{t('Cancel run…')}</button>;
  return <div className="attention-confirm">
    <p>{t('Cancel “{{title}}”? Work already created remains in ADE. Running agents stop.', { title })}</p>
    {draft.state === 'unconfirmed' && <p role="alert">{localizeAppMessage(draft.message ?? '')}{' '}{t('A check repeats the same cancellation; it never cancels twice.')}</p>}
    <button type="button" className="attention-danger" disabled={busy || !online} aria-busy={busy || undefined} onClick={() => void send()}>
      {busy ? t('Confirming cancellation…') : draft.state === 'unconfirmed' ? t('Check cancellation again') : t('Confirm cancellation')}</button>
    {draft.state === 'confirm' && <button type="button" disabled={busy} onClick={() => update(undefined)}>{t('Keep run')}</button>}
  </div>;
}

function AttentionInstruct({ send, slotKey, drafts, online, onOpen, onChanged }: {
  send: InstructSend; slotKey: string; drafts: AttentionDrafts; online: boolean; onOpen(): Promise<void>; onChanged(): void;
}): JSX.Element {
  useLocale();
  const slot = useMemo(() => drafts.slot<InstructDraft>(slotKey), [drafts, slotKey]);
  const [draft, setDraft] = useState<InstructDraft>(() => slot.read() ?? { text: '', status: 'idle' });
  const [busy, setBusy] = useState(false); const lock = useRef(false);
  const mounted = useRef(true); useEffect(() => () => { mounted.current = false; }, []);
  const update = (value: InstructDraft) => { slot.write(value.text || value.attempt ? value : undefined); if (mounted.current) setDraft(value); };
  const submit = async () => {
    if (lock.current || !online || !(draft.attempt?.text ?? draft.text).trim()) return;
    lock.current = true; setBusy(true);
    const next = await deliverInstruction(draft, send, () => crypto.randomUUID());
    update(next); lock.current = false; if (mounted.current) setBusy(false);
    if (next.status === 'delivered') onChanged();
  };
  const locked = !!draft.attempt;
  return <form className="attention-instruct" onSubmit={event => { event.preventDefault(); void submit(); }}>
    <label>{t('Instruction for this session')}
      <textarea rows={3} maxLength={8000} value={draft.text} readOnly={locked || busy}
        onChange={event => update({ text: event.target.value, status: 'idle' })} /></label>
    {draft.status === 'delivered' && <p role="status">{draft.replayed ? t('Already delivered earlier; nothing was sent twice.') : t('Instruction handed to this CLI once.')}</p>}
    {draft.status === 'unconfirmed' && <div role="alert"><p>{localizeAppMessage(draft.message ?? '')}</p>
      <p>{t('Delivery is not confirmed. A check repeats the same delivery and the CLI receives it at most once.')}</p></div>}
    <div className="attention-row-actions">
      <button type="submit" disabled={busy || !online || !(draft.attempt?.text ?? draft.text).trim()} aria-busy={busy || undefined}>
        {busy ? t('Handing over…') : locked ? t('Check delivery') : t('Send instruction')}</button>
      {locked && <><button type="button" disabled={busy} onClick={() => void onOpen()}>{t('Open terminal')}</button>
        <button type="button" disabled={busy} onClick={() => update(releaseInstruction(draft))}>{t('Terminal checked – keep editing')}</button></>}
    </div>
    <p className="attention-note">{t('The draft stays only in this open window and only for this session.')}</p>
  </form>;
}

function TakeInput({ sessionId, port, online, onOpen }: { sessionId: string; port: AttentionActionsPort; online: boolean; onOpen(): Promise<void> }): JSX.Element {
  useLocale();
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  return <>
    {error && <p role="alert">{localizeAppMessage(error)}</p>}
    <button type="button" disabled={!online || busy} onClick={async () => {
      setBusy(true); setError('');
      try { await port.takeInput?.(sessionId); await onOpen(); }
      catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
      finally { setBusy(false); }
    }}>{port.takeInput ? t('Take input and open terminal') : t('Open terminal to take input')}</button>
  </>;
}
