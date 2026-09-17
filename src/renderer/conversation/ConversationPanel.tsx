import { useEffect, useMemo, useRef, useState } from 'react';
import type { ConversationCommand, ConversationDetail, ConversationReceipt, ConversationSummary, ConversationTurnDetail, ConversationTurnStatus } from '../../shared/conversation';
import { ConversationDrafts, type PendingConversationCommand } from './conversationDrafts';
import { ConversationNotAcceptedError } from '../../shared/conversation';
import { QuestionCard, type RunQuestionsPort } from '../graph/RunQuestionsPanel';
import './conversation.css';
import { ConversationVoice } from './ConversationVoice';
import type { ConversationRecordingPort } from './ConversationRecording';

const STATUS: Record<ConversationTurnStatus | 'ready', string> = { ready: 'Bereit', working: 'ADE arbeitet', interrupting: 'Unterbrechung angefragt', completed: 'Antwort abgeschlossen', interrupted: 'Unterbrochen', uncertain: 'Abschluss nicht bestätigt' };
const describe = (error: unknown) => error instanceof Error ? error.message : String(error);
type CommandInput = ConversationCommand extends infer C ? C extends ConversationCommand ? Omit<C, 'commandId'> : never : never;
export interface ConversationDisplayTurn extends Omit<ConversationTurnDetail, 'input' | 'output'> { input: string | { chars: number }; output: string | null; redacted?: boolean; revision?: string }
export interface ConversationDisplayDetail extends Omit<ConversationDetail, 'turns'> { turns: ConversationDisplayTurn[] }
export interface ConversationPort {
  recording?: ConversationRecordingPort;
  list(): Promise<ConversationSummary[]>;
  detail(id: string): Promise<ConversationDisplayDetail>;
  loadTurn?(id: string, turnId: string): Promise<ConversationDisplayTurn>;
  command(value: ConversationCommand): Promise<ConversationReceipt>;
  defaultProfile(): Promise<string | null>;
  subscribe(changed: () => void): () => void;
  describe(error: unknown): string;
}
export function ConversationPanel({ port, profiles, draftScope, online = true, canWrite = true, onClose, onBack }: {
  port: ConversationPort; profiles: Array<{ id: string; name: string }>; draftScope: string;
  online?: boolean; canWrite?: boolean; onClose(): void; onBack(): void;
}) {
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
      const list = await port.list();
      const missing = !!id && !list.some(c => c.id === id);
      const value = id && !missing ? await port.detail(id) : null;
      if (!live.current || gen !== generation.current || selectedRef.current !== id) return;
      setView(list); setDetail(value); setPending(drafts.pending(id) ?? null); setCreation(drafts.pending('create') ?? null);
      if (missing) setError('Das gewählte Gespräch ist in diesem Projektumfang nicht verfügbar. Ein anderes oder ein neues Gespräch auswählen.');
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
    catch { setDraftError('Entwurf bleibt nur in diesem Fenster. Vor dem Schliessen kopieren.'); }
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
    read: async () => { throw new Error('Gesprächsfragen werden mit dem Verlauf geladen.'); },
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
      <p>Projektstände besprechen, Übergaben lesen und Ideen entwickeln. Du kannst deine Nachricht schreiben oder diktieren. Projektaufträge werden in diesem Dialog noch angebunden.</p>
      <div className="conversation-controls"><button type="button" onClick={onBack}>Zur Projektbetreuung</button><button type="button" onClick={onClose}>Dialog schliessen</button></div>
      <div className="conversation-controls">
        <label>Codex-Profil<select aria-label="Gesprächsprofil" value={profileId} onChange={event => { profileChosen.current = true; setProfileId(event.target.value); }}>
          <option value="">Profil auswählen</option>{profiles.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select></label>
        <button type="button" disabled={busy || !online || !canWrite || !!creation || !profileId} onClick={() => void command({ operation: 'create', profileId })}>Neues ADE-Gespräch</button>
      </div>
      {!profiles.length && <p>Zuerst in den Agent-Einstellungen ein natives Codex-Profil mit Modell und Reasoning anlegen.</p>}
      <p className="conversation-note">Für diesen ersten Dialog ist Codex CLI 0.154.0 unter nativem Windows geprüft. Ein neues Gespräch startet das Modell erst beim Senden.</p>
      {!online && <p role="status">PC nicht verbunden. Angezeigter Verlauf kann veraltet sein.</p>}
      {!canWrite && <p>Zum Senden am PC die Run-Schreibrechte für dieses Gerät freigeben.</p>}
      {error && <div role="alert"><p>{error}</p><button type="button" disabled={busy || !online} onClick={() => { setError(''); void reload(); }}>Gespräch aktualisieren</button></div>}
      {creation && <div role="status"><p>Das neue Gespräch wartet auf Bestätigung. Die Prüfung verwendet dieselbe Vorgangs-ID.</p><button type="button" disabled={busy || !online || !canWrite} onClick={() => void command(creation)}>Neues Gespräch erneut prüfen</button></div>}
      {pending && <div role="status"><p>Die Zustellung dieser Nachricht ist noch nicht bestätigt. Die Prüfung verwendet dieselbe Vorgangs-ID.</p><button type="button" disabled={busy || !online || !canWrite} onClick={() => void command(pending)}>Vorgang erneut prüfen</button></div>}
      {!view && !error && <p role="status">Gespräche werden geladen…</p>}
      {view?.length === 0 && <p>Noch kein ADE-Gespräch. Du kannst ohne offenes Projekt oder Terminal beginnen.</p>}
      {!!view?.length && <label>Gespräch auswählen<select aria-label="Gespräch auswählen" value={selected} disabled={busy} onChange={event => select(event.target.value)}>
        <option value="">Gespräch auswählen</option>{view.map((c, index) => <option key={c.id} value={c.id}>{index + 1}. {profiles.find(p => p.id === c.profileId)?.name ?? 'Entferntes Profil'} · {c.closed ? 'Geschlossen' : STATUS[c.status]} · {c.turns} Nachrichten</option>)}
      </select></label>}
      {selected && !detail && !error && <p role="status">Gespräch wird geladen…</p>}
      {detail && <>
        {!detail.available && <p role="status">Profil oder Projektumfang hat sich geändert. Der Verlauf bleibt lesbar; zum Fortsetzen ein neues Gespräch beginnen.</p>}
        {detail.model && <p className="conversation-note">Verbundenes Modell: {detail.model}{detail.reasoningEffort ? ` · ${detail.reasoningEffort}` : ''}</p>}
        <div className="conversation-history" aria-label="Gesprächsverlauf">
          {!detail.turns.length && <p>Womit möchtest du beginnen? Zum Beispiel: „Wo stehen meine Projekte heute?“</p>}
          {detail.turns.map((turn, index) => <article key={turn.id} className="conversation-turn">
            <h3>Du · Nachricht {index + 1}</h3><p className="conversation-text">{typeof turn.input === 'string' ? turn.input : `Private Nachricht · ${turn.input.chars} Zeichen. Der Eingabetext bleibt auf dem PC.`}</p>
            <h3>ADE</h3>{turn.output && <p className="conversation-text">{turn.output}</p>}
            {turn.output === null && <button type="button" disabled={!online || loadingTurnIds.includes(turn.id)} onClick={() => void loadTurn(detail.id, turn)}>{loadingTurnIds.includes(turn.id) ? `Antwort ${index + 1} wird geladen…` : `Antwort ${index + 1} laden`}</button>}
            {turn.redacted && <p className="conversation-note">Pfade und vertrauliche Werte sind in dieser Antwort ausgeblendet.</p>}
            <p role="status">{STATUS[turn.status]}</p>{turn.error && <p role="alert">{turn.error}</p>}
            {turn.questions.filter(q => q.status === 'pending' || q.status === 'answering').map(question => <QuestionCard key={question.id} question={question}
              runId={detail.id} taskId={turn.id} label="ADE-Rückfrage" port={questionPort} online={online} canAnswer={canWrite && detail.available && !detail.closed}
              unavailableReason="Dieses Gespräch kann nach Änderung des Profils oder Projektumfangs nicht weitergeführt werden. Ein neues Gespräch beginnen."
              onAnswered={() => { void reload(); input.current?.focus(); }} />)}
          </article>)}
        </div>
        {last?.status === 'uncertain' && <p>Der letzte Schritt bleibt unbestätigt. Er wird nicht erneut gesendet. Prüfe den Stand und beginne bei Bedarf ein neues Gespräch.</p>}
        <form onSubmit={event => { event.preventDefault(); if (canSend && draft.trim()) void command({ operation: 'send', conversationId: detail.id, afterTurnId: last?.id ?? null, text: draft }); }}>
          <label>Nachricht an ADE<textarea ref={input} aria-label="Nachricht an ADE" rows={4} maxLength={64 * 1024} value={draft} onChange={event => edit(event.target.value)} readOnly={busy || !!pending || detail.closed || !detail.available} /></label>
          <button type="submit" disabled={busy || !canSend || !draft.trim()}>An ADE senden</button>
        </form>
        {port.recording && <ConversationVoice key={`${detail.id}:${online}:${canWrite}:${detail.available}:${detail.closed}:${!!pending}`} id={detail.id} drafts={drafts} port={port.recording}
          enabled={online && canWrite && detail.available && !detail.closed && !pending && last?.status !== 'uncertain'} onApply={text => { setDraft(text); setDraftError(''); input.current?.focus(); }} />}
        <div className="conversation-controls">
          {running && <button type="button" disabled={busy || !online || !canWrite || last.status === 'interrupting'} onClick={() => void command({ operation: 'interrupt', conversationId: detail.id, turnId: last.id })}>Antwort unterbrechen</button>}
          {!detail.closed && <button type="button" disabled={busy || !online || !canWrite} onClick={() => void command({ operation: 'close', conversationId: detail.id })}>Gespräch beenden</button>}
        </div>
      </>}
      {draftError && <p role="alert">{draftError}</p>}
      <p className="conversation-note">Dialog schliessen lässt das Gespräch weiterlaufen. Gespräch beenden trennt diese Modellverbindung; Projektarbeit läuft unabhängig davon.</p>
    </div>
  ;
}
