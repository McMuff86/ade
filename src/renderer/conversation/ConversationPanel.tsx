import { localizeAppMessage } from '../../shared/i18n/appMessages';
import { t as translate } from "../../shared/i18n";
import { localizedLabels } from "../../shared/i18n/labels";
import { useLocale } from "../i18n/language";
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ConversationCommand, ConversationDetail, ConversationReceipt, ConversationSummary, ConversationTurnDetail, ConversationTurnStatus } from '../../shared/conversation';
import { ConversationDrafts, type PendingConversationCommand } from './conversationDrafts';
import { ConversationNotAcceptedError } from '../../shared/conversation';
import { QuestionCard, type RunQuestionsPort } from '../graph/RunQuestionsPanel';
import './conversation.css';
import { ConversationVoice } from './ConversationVoice';
import type { ConversationRecordingPort } from './ConversationRecording';
import { CoordinatorActions, type CoordinatorActionsPort } from './CoordinatorActions';
import type { ConversationMode } from '../../shared/conversation';
import { VoiceStudio, type VoiceStudioPort } from './VoiceStudio';

const STATUS: Record<ConversationTurnStatus | 'ready', string> = localizedLabels(() => ({ ready: translate("Ready"), working: translate("ADE is working"), interrupting: translate("Interruption requested"), completed: translate("Reply completed"), interrupted: translate("Interrupted"), uncertain: translate("Completion not confirmed") }));
const describe = (error: unknown) => error instanceof Error ? error.message : String(error);
type CommandInput = ConversationCommand extends infer C ? C extends ConversationCommand ? Omit<C, 'commandId'> : never : never;
export interface ConversationDisplayTurn extends Omit<ConversationTurnDetail, 'input' | 'output'> { input: string | { chars: number }; output: string | null; redacted?: boolean; revision?: string }
export interface ConversationDisplayDetail extends Omit<ConversationDetail, 'turns'> { turns: ConversationDisplayTurn[] }
export interface ConversationPort {
  speech?: VoiceStudioPort;
  actions?: CoordinatorActionsPort;
  recording?: ConversationRecordingPort;
  list(): Promise<ConversationSummary[]>;
  detail(id: string): Promise<ConversationDisplayDetail>;
  loadTurn?(id: string, turnId: string): Promise<ConversationDisplayTurn>;
  command(value: ConversationCommand): Promise<ConversationReceipt>;
  defaultProfile(): Promise<string | null>;
  subscribe(changed: () => void): () => void;
  describe(error: unknown): string;
}
export function ConversationPanel({ port, profiles, draftScope, online = true, canWrite = true, mode = 'project', onClose, onBack }: {
  port: ConversationPort; profiles: Array<{ id: string; name: string }>; draftScope: string;
  online?: boolean; canWrite?: boolean; mode?: ConversationMode; onClose(): void; onBack(): void;
}) {
  useLocale();
  const drafts = useMemo(() => new ConversationDrafts({ getItem: key => localStorage.getItem(key), setItem: (key, value) => localStorage.setItem(key, value) }, draftScope), [draftScope]);
  const [profileId, setProfileId] = useState(''); const [view, setView] = useState<ConversationSummary[] | null>(null);
  const profileChosen = useRef(false);
  const [selected, setSelected] = useState(''); const selectedRef = useRef(''); selectedRef.current = selected;
  const [detail, setDetail] = useState<ConversationDisplayDetail | null>(null); const [error, setError] = useState('');
  const [busy, setBusy] = useState(false); const [draft, setDraft] = useState(''); const [draftError, setDraftError] = useState('');
  const live = useRef(true); const generation = useRef(0); const locked = useRef(false); const input = useRef<HTMLTextAreaElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [pending, setPending] = useState<PendingConversationCommand | null>(null);
  const [creation, setCreation] = useState<PendingConversationCommand | null>(null);
  const loadingTurns = useRef(new Set<string>());
  const [loadingTurnIds, setLoadingTurnIds] = useState<string[]>([]);
  const refreshing = useRef(false); const refreshAgain = useRef(false);
  const previousQuestions = useRef(0);
  const openQuestions = detail?.turns.at(-1)?.questions.filter(q => q.status === 'pending' || q.status === 'answering').length ?? 0;
  useEffect(() => { if (previousQuestions.current > 0 && openQuestions === 0) input.current?.focus(); previousQuestions.current = openQuestions; }, [openQuestions]);
  const reload = async () => {
    if (refreshing.current) { refreshAgain.current = true; return; }
    refreshing.current = true;
    const gen = ++generation.current; const id = selectedRef.current;
    try {
      const list = (await port.list()).filter(c => (c.mode ?? 'project') === mode);
      const missing = !!id && !list.some(c => c.id === id);
      const value = id && !missing ? await port.detail(id) : null;
      if (!live.current || gen !== generation.current || selectedRef.current !== id) return;
      setView(list); setDetail(value); setPending(drafts.pending(id) ?? null); setCreation(drafts.pending('create') ?? null);
      if (missing) setError(translate("The selected conversation is not available in this project scope. Select another or a new conversation."));
    } catch (reason) { if (live.current && gen === generation.current) { setError(port.describe(reason)); setDetail(null); setView(null); } }
    finally { refreshing.current = false; if (live.current && refreshAgain.current) { refreshAgain.current = false; void reload(); } }
  };
  useEffect(() => {
    live.current = true;
    try { const saved = drafts.read(); selectedRef.current = saved.selected; setSelected(saved.selected); setCreation(drafts.pending('create') ?? null); }
    catch (reason) { setDraftError(describe(reason)); }
    void reload();
    void port.defaultProfile().then(id => { if (live.current && !profileChosen.current && id && profiles.some(p => p.id === id)) setProfileId(id); }).catch(() => undefined);
    const off = port.subscribe(() => { void reload(); });
    return () => { live.current = false; generation.current++; off(); };
  }, []);
  useEffect(() => {
    setDetail(null); setDraftError('');
    try { setDraft(drafts.text(selected)); setPending(drafts.pending(selected) ?? null); }
    catch (reason) { setDraft(''); setDraftError(describe(reason)); }
    void reload();
  }, [selected]);
  const edit = (text: string) => {
    setDraft(text);
    try { drafts.edit(selected, text); setDraftError(''); }
    catch { setDraftError(translate("Draft remains only in this window. Copy before closing.")); }
  };
  const select = (id: string) => { try { drafts.select(id); selectedRef.current = id; setSelected(id); setError(''); } catch (reason) { setDraftError(describe(reason)); } };
  const command = async (value: CommandInput | ConversationCommand) => {
    if (locked.current || !online || !canWrite) return;
    const attempt: ConversationCommand = 'commandId' in value ? value : { ...value, commandId: crypto.randomUUID() } as ConversationCommand;
    try {
      if (attempt.operation === 'create' || attempt.operation === 'send') {
        drafts.reserve(attempt);
        if (attempt.operation === 'create') setCreation(attempt); else setPending(attempt);
      }
    } catch (reason) { setDraftError(describe(reason)); return; }
    // Keep Escape in the dialog while the clicked submit button is disabled.
    (input.current ?? panel.current)?.focus(); locked.current = true; setBusy(true); setError('');
    try {
      const receipt = await port.command(attempt);
      if (attempt.operation === 'create' || attempt.operation === 'send') drafts.acknowledge(attempt, receipt);
      if (!live.current) return;
      if (attempt.operation === 'create') { setCreation(null); select(receipt.conversationId); }
      if (attempt.operation === 'send') { setPending(null); setDraft(drafts.text(attempt.conversationId)); input.current?.focus(); }
      await reload();
      if (value.operation === 'close') input.current?.focus();
    } catch (reason) {
      if (reason instanceof ConversationNotAcceptedError && (attempt.operation === 'create' || attempt.operation === 'send')) {
        try { drafts.rejected(attempt); if (live.current) { if (attempt.operation === 'create') setCreation(null); else setPending(null); } }
        catch (storageError) { if (live.current) setDraftError(describe(storageError)); }
      }
      if (live.current) { setError(port.describe(reason)); await reload(); }
    }
    finally { locked.current = false; if (live.current) setBusy(false); }
  };
  const questionPort: RunQuestionsPort = {
    read: async () => { throw new Error(translate("Conversation questions are loaded with the history.")); },
    answer: async (value, commandId) => { await port.command({ operation: 'answer', commandId, conversationId: value.runId, turnId: value.taskId, questionId: value.questionId, answers: value.answers }); await reload(); },
  };
  const last = detail?.turns.at(-1); const running = last?.status === 'working' || last?.status === 'interrupting';
  const canSend = !!detail && online && canWrite && detail.available && !detail.closed && !running && !pending && last?.status !== 'uncertain';
  const loadTurn = async (id: string, turn: ConversationDisplayTurn) => {
    if (!port.loadTurn || loadingTurns.current.has(turn.id)) return;
    loadingTurns.current.add(turn.id); setLoadingTurnIds([...loadingTurns.current]); setError('');
    try { const loaded = await port.loadTurn(id, turn.id); if (live.current && selectedRef.current === id) setDetail(current => current?.id === id ? { ...current, turns: current.turns.map(t => t.id === turn.id && t.updatedAt === loaded.updatedAt && t.revision === loaded.revision ? loaded : t) } : current); }
    catch (reason) { if (live.current) setError(port.describe(reason)); }
    finally { loadingTurns.current.delete(turn.id); if (live.current) setLoadingTurnIds([...loadingTurns.current]); }
  };
  return <div className="conversation-panel" ref={panel} tabIndex={-1}>
      <p>{mode === 'casual' ? translate('A space for ideas, everyday questions and casual conversation. Type or dictate, and try replies in the voice studio. This conversation has its own history and no project tools.') : translate("Discuss project status, prepare handoffs and plan Codex project jobs. You can type or dictate. Confirm saving or starting each proposal separately.")}</p>
      <div className="conversation-controls"><button type="button" onClick={onBack}>{mode === 'casual' ? translate('Back to conversations') : translate("Go to project supervision")}</button><button type="button" onClick={onClose}>{translate("Close the dialogue")}</button></div>
      <div className="conversation-controls">
        <label>{translate("Codex profile")}<select aria-label={translate("Conversation profile")} value={profileId} onChange={event => { profileChosen.current = true; setProfileId(event.target.value); }}>
          <option value="">{translate("Select profile")}</option>{profiles.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select></label>
        <button type="button" disabled={busy || !online || !canWrite || !!creation || !profileId} onClick={() => void command({ operation: 'create', profileId, ...(mode === 'casual' ? { mode } : {}) })}>{mode === 'casual' ? translate('New casual conversation') : translate("New ADE conversation")}</button>
      </div>
      {!profiles.length && <p>{translate("First create a native Codex profile with model and reasoning in the Agent settings.")}</p>}
      <p className="conversation-note">{translate('Uses a native Codex profile on the PC. The model starts when you send your first message.')}</p>
      {mode === 'casual' && port.speech && <VoiceStudio port={port.speech} scope={draftScope} enabled={online} reply={detail?.turns.slice().reverse().find(turn => !!turn.output)?.output ?? ''} />}
      {!online && <p role="status">{translate("PC not connected. Displayed history may be obsolete.")}</p>}
      {!canWrite && <p>{translate("To send messages, enable run write permissions for this device on the PC.")}</p>}
      {error && <div role="alert"><p>{localizeAppMessage(error)}</p><button type="button" disabled={busy || !online} onClick={() => { setError(''); void reload(); }}>{translate("Update the conversation")}</button></div>}
      {creation && <div role="status"><p>{translate("The new conversation is awaiting confirmation. Checking uses the same operation ID.")}</p><button type="button" disabled={busy || !online || !canWrite} onClick={() => void command(creation)}>{translate("Check new conversation again")}</button></div>}
      {pending && <div role="status"><p>{translate("The delivery of this message has not yet been confirmed; the check uses the same process ID.")}</p><button type="button" disabled={busy || !online || !canWrite} onClick={() => void command(pending)}>{translate("Check operation again")}</button></div>}
      {!view && !error && <p role="status">{translate("Loading conversations…")}</p>}
      {view?.length === 0 && <p>{translate("No ADE conversation yet. You can start without an open project or terminal.")}</p>}
      {!!view?.length && <label>{translate("Choose a conversation")}<select aria-label={translate("Choose a conversation")} value={selected} disabled={busy} onChange={event => select(event.target.value)}>
        <option value="">{translate("Choose a conversation")}</option>{view.map((c, index) => <option key={c.id} value={c.id}>{index + 1}. {profiles.find(p => p.id === c.profileId)?.name ?? translate("Removed profile")} · {c.closed ? translate("Closed") : STATUS[c.status]} · {c.turns}{" "}{translate("Messages")}</option>)}
      </select></label>}
      {selected && !detail && !error && <p role="status">{translate("Loading conversation…")}</p>}
      {detail && <>
        {!detail.available && <p role="status">{translate("Profile or project scope has changed. The history remains legible; to continue, start a new conversation.")}</p>}
        {detail.model && <p className="conversation-note">{translate("Connected model:")}{" "}{detail.model}{detail.reasoningEffort ? ` · ${detail.reasoningEffort}` : ''}</p>}
        <div className="conversation-history" aria-label={translate("Conversation history")}>
          {!detail.turns.length && <p>{mode === 'casual' ? translate('What would you like to talk about?') : translate("What do you want to start with? For example, \"Where are my projects today?\"")}</p>}
          {detail.turns.map((turn, index) => <article key={turn.id} className="conversation-turn">
            <h3>{translate("You · Message")}{" "}{index + 1}</h3><p className="conversation-text">{typeof turn.input === 'string' ? turn.input : translate("Private message · {{value1}} characters. The input text stays on the PC.", { value1: turn.input.chars })}</p>
            <h3>ADE</h3>{turn.output && <p className="conversation-text">{turn.output}</p>}
            {turn.output === null && <button type="button" disabled={!online || loadingTurnIds.includes(turn.id)} onClick={() => void loadTurn(detail.id, turn)}>{loadingTurnIds.includes(turn.id) ? translate("Loading reply {{value1}}…", { value1: index + 1 }) : translate("Load reply {{value1}}", { value1: index + 1 })}</button>}
            {turn.redacted && <p className="conversation-note">{translate("Paths and confidential values are hidden in this answer.")}</p>}
            <p role="status">{STATUS[turn.status]}</p>{turn.error && <p role="alert">{localizeAppMessage(turn.error)}</p>}
            {turn.questions.filter(q => q.status === 'pending' || q.status === 'answering').map(question => <QuestionCard key={question.id} question={question}
              runId={detail.id} taskId={turn.id} label={translate("ADE follow-up question")} port={questionPort} online={online} canAnswer={canWrite && detail.available && !detail.closed}
              unavailableReason={translate("This conversation cannot continue after its profile or project scope changes. Start a new conversation.")}
              onAnswered={() => { void reload(); input.current?.focus(); }} />)}
          </article>)}
        </div>
        {last?.status === 'uncertain' && <p>{translate("The last step is unconfirmed. It's not re-sent. Check the status and start a new conversation if necessary.")}</p>}
        {mode === 'project' && port.actions && <CoordinatorActions key={detail.id} conversationId={detail.id} port={port.actions} online={online && detail.available}
          canWrite={canWrite && detail.available} canConfirm={detail.available && !detail.closed && !running} />}
        <form onSubmit={event => { event.preventDefault(); if (canSend && draft.trim()) void command({ operation: 'send', conversationId: detail.id, afterTurnId: last?.id ?? null, text: draft }); }}>
          <label>{translate("Message to ADE")}<textarea ref={input} aria-label={translate("Message to ADE")} rows={4} maxLength={64 * 1024} value={draft} onChange={event => edit(event.target.value)} readOnly={busy || !!pending || detail.closed || !detail.available} /></label>
          <button type="submit" disabled={busy || !canSend || !draft.trim()}>{translate("Send to ADE")}</button>
        </form>
        {port.recording && <ConversationVoice key={`${detail.id}:${online}:${canWrite}:${detail.available}:${detail.closed}:${!!pending}`} id={detail.id} drafts={drafts} port={port.recording}
          enabled={online && canWrite && detail.available && !detail.closed && !pending && last?.status !== 'uncertain'} onApply={text => { setDraft(text); setDraftError(''); input.current?.focus(); }} />}
        <div className="conversation-controls">
          {running && <button type="button" disabled={busy || !online || !canWrite || last.status === 'interrupting'} onClick={() => void command({ operation: 'interrupt', conversationId: detail.id, turnId: last.id })}>{translate("Interrupt reply")}</button>}
          {!detail.closed && <button type="button" disabled={busy || !online || !canWrite} onClick={() => void command({ operation: 'close', conversationId: detail.id })}>{translate("End conversation")}</button>}
        </div>
      </>}
      {draftError && <p role="alert">{draftError}</p>}
      <p className="conversation-note">{translate("Closing the dialog leaves the conversation running. Ending the conversation disconnects this model session; project work continues independently.")}</p>
    </div>
  ;
}
