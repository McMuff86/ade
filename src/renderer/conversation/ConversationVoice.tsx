import { useEffect, useRef, useState } from 'react';
import { ConversationRecording, type ConversationRecordingPort, type ConversationRecordingView } from './ConversationRecording';
import type { ConversationDrafts } from './conversationDrafts';
import { LiveDictationRecorder } from '../terminal/LiveDictationRecorder';

export function ConversationVoice({ id, drafts, port, enabled, onApply, purpose = 'conversation', maxApplyChars = Infinity }: {
  id: string; drafts: ConversationDrafts; port: ConversationRecordingPort; enabled: boolean; onApply(text: string): void | Promise<void>; purpose?: 'conversation' | 'organizer'; maxApplyChars?: number;
}) {
  const controller = useRef<ConversationRecording | null>(null);
  const [view, setView] = useState<ConversationRecordingView>({ phase: 'idle', error: '' });
  const region = useRef<HTMLDivElement>(null);
  const [applying, setApplying] = useState(false); const [applyError, setApplyError] = useState(''); const applyingRef = useRef(false);
  useEffect(() => {
    const recording = new ConversationRecording(id, drafts, port, () => new LiveDictationRecorder(), setView);
    controller.current = recording; setView(recording.snapshot());
    return () => { controller.current = null; recording.dispose(); };
  }, [id, drafts, port, enabled]);
  // A lost connection/authority must release the microphone immediately. A new
  // mount on restoration exposes its saved preview and never restarts capture.
  useEffect(() => { if (!enabled) { controller.current?.dispose(); controller.current = null; } }, [enabled]);
  const act = (action: () => void) => { region.current?.focus(); action(); };
  const active = ['preparing', 'recording', 'transcribing', 'checking'].includes(view.phase);
  const apply = async () => {
    const recording = controller.current; const preview = recording?.snapshot().value;
    if (!recording || !preview || applyingRef.current || preview.text.length > maxApplyChars) return;
    applyingRef.current = true; setApplying(true); setApplyError('');
    try {
      if (purpose === 'organizer') { await onApply(preview.text); recording.discard(); }
      else { const text = recording.apply(); if (text !== undefined) await onApply(text); }
    }
    catch (reason) { setApplyError(reason instanceof Error ? reason.message : 'Text konnte nicht gespeichert werden. Die Diktatvorschau bleibt erhalten.'); }
    finally { applyingRef.current = false; setApplying(false); }
  };
  return <div className="conversation-voice" role="group" aria-label="Diktat für ADE" ref={region} tabIndex={-1}>
    <p className="conversation-note">{purpose === 'organizer' ? 'Diktieren über ElevenLabs. Den Text prüfen und in die Aufgabe oder Notiz übernehmen. Beim Wechsel endet die Aufnahme. Bis zu fünf Minuten je Diktat.' : 'Diktieren über ElevenLabs. Der Text bleibt zur Prüfung hier; „An ADE senden“ startet die Nachricht. Beim Wechsel endet die Aufnahme. Bis zu fünf Minuten je Diktat.'}</p>
    {view.phase === 'idle' && <button type="button" disabled={!enabled} onClick={() => act(() => { void controller.current?.start(); })}>{purpose === 'organizer' ? 'Text diktieren' : 'Nachricht diktieren'}</button>}
    {view.phase === 'preparing' && <p role="status">Mikrofon und Diktat werden vorbereitet…</p>}
    {view.phase === 'recording' && <><p role="status">Mikrofon nimmt auf…</p><button type="button" onClick={() => act(() => controller.current?.stop())}>Aufnahme stoppen</button></>}
    {view.phase === 'transcribing' && <p role="status">Diktat wird abgeschlossen…</p>}
    {view.phase === 'checking' && <p role="status">Vorheriges Diktat wird geprüft…</p>}
    {view.value && <>
      <label>Diktatvorschau<textarea aria-label="Diktatvorschau" readOnly rows={3} value={view.value.text} /></label>
      {!active && <p role="status">{view.value.complete ? 'Diktat abgeschlossen. Text prüfen und übernehmen.' : 'Unvollständiges Diktat. Bisherigen Teil prüfen; fehlende Wörter ergänzen.'}</p>}
      {!active && <div className="conversation-controls">
        <button type="button" disabled={!enabled || applying || !view.value.text.trim() || view.value.text.length > maxApplyChars} onClick={() => act(() => { void apply(); })}>{applying ? 'Text wird gespeichert…' : purpose === 'organizer' ? 'Diktat übernehmen' : 'Diktat in Nachricht übernehmen'}</button>
        <button type="button" disabled={!enabled || applying} onClick={() => act(() => { void controller.current?.recover(); })}>Vorheriges Diktat prüfen</button>
        <button type="button" disabled={!enabled || applying} onClick={() => act(() => controller.current?.discard())}>Diktat verwerfen</button>
      </div>}
    </>}
    {view.error && <p role="alert">{view.error}</p>}
    {view.value && view.value.text.length > maxApplyChars && <p role="status">Für dieses Diktat reicht der Platz im Textfeld nicht. Text kürzen oder die Vorschau in eine neue Notiz kopieren.</p>}
    {applyError && <p role="alert">{applyError}</p>}
  </div>;
}
